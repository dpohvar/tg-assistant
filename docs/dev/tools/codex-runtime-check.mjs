// Isolated App Server probe. Start only after the filesystem canary has passed.
// No Telegram calls, API keys, or changes to the user's Codex configuration.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createImageSaver } from './save-image-probe.mjs';

const [mode, executable, home, cwd, output] = process.argv.slice(2);
if (!mode || !executable || !home || !cwd || !output) {
  throw new Error('Usage: node codex-runtime-check.mjs MODE CODEX CONTROL_HOME AGENT_CWD OUTPUT');
}
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, CODEX_HOME: home };
for (const key of Object.keys(env)) {
  if (/TOKEN|SECRET|PASSWORD|API_KEY/i.test(key)) delete env[key];
}
const child = spawn(executable, ['app-server', '--stdio', '--strict-config'], {
  cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
});
const raw = fs.createWriteStream(path.join(output, 'events.jsonl'));
const stderr = fs.createWriteStream(path.join(output, 'stderr.log'));
child.stderr.pipe(stderr);
let serial = 0;
const pending = new Map();
const events = [];
const imageSaver = createImageSaver(cwd, 'a1');
const imageExports = [];
const ownedThreads = new Set();
const exportMode = mode === 'image-export' || mode === 'image-export-subagent';
const activeDeleteMode = mode === 'delete-active' || mode === 'delete-interrupt';
function sessionFiles(id) {
  const matches = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.includes(id)) matches.push(p);
    }
  }
  walk(path.join(home, 'sessions'));
  walk(path.join(home, 'archived_sessions'));
  return matches;
}
let failure;
child.on('error', error => { failure = error; });
child.on('exit', (code, signal) => {
  failure = new Error(`App Server exited: ${code}/${signal}`);
  for (const request of pending.values()) request.reject(failure);
  pending.clear();
});
readline.createInterface({ input: child.stdout }).on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  // This harness never requests login tokens or account/profile details.
  raw.write(JSON.stringify({ time: new Date().toISOString(), message }) + '\n');
  if (message.method === 'item/started' && message.params?.item?.type === 'subAgentActivity' && message.params.item.kind === 'started' && ownedThreads.has(message.params.threadId)) {
    ownedThreads.add(message.params.item.agentThreadId);
  }
  if (message.method === 'item/completed' && message.params?.item?.type === 'imageGeneration' && message.params.item.savedPath && ownedThreads.has(message.params.threadId)) {
    imageSaver.register(message.params.threadId, message.params.item.savedPath);
  }
  if (message.id !== undefined && pending.has(message.id)) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  } else if (message.id !== undefined && message.method) {
    if (exportMode && message.method === 'item/tool/call' && message.params.tool === 'save_image') {
      let result;
      try {
        const args = message.params.arguments;
        if (!ownedThreads.has(message.params.threadId)) throw new Error('unowned thread');
        const saved = imageSaver.save(message.params.threadId, args.savedPath, args.dir);
        imageExports.push({ threadId: message.params.threadId, ...args, ...saved });
        result = { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(saved) }] };
      } catch (error) {
        result = { success: false, contentItems: [{ type: 'inputText', text: JSON.stringify({ error: error.message }) }] };
      }
      child.stdin.write(JSON.stringify({ id: message.id, result }) + '\n');
      return;
    }
    // Approvals or user input must not widen unattended test permissions.
    child.stdin.write(JSON.stringify({ id: message.id, error: {
      code: -32000, message: 'Unattended test does not grant permissions or user input.',
    } }) + '\n');
  } else events.push(message);
});
function rpc(method, params = {}) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout: ${method}`)); }, 30000);
    pending.set(id, {
      resolve: result => { clearTimeout(timer); resolve(result); },
      reject: error => { clearTimeout(timer); reject(error); },
    });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
async function waitFor(predicate, start = 0, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const match = events.slice(start).find(predicate);
    if (match) return match;
    if (failure) throw failure;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Event timeout');
}
const textInput = text => [{ type: 'text', text, text_elements: [] }];
const report = { mode, startedAt: new Date().toISOString(), cwd, observations: [] };
let threadId;
let turnId;
try {
  await rpc('initialize', { clientInfo: { name: 'tg_assistant_runtime_check', version: '0.1' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  if (mode === 'catalog') {
    report.models = await rpc('model/list', {});
    report.features = await rpc('experimentalFeature/list', {});
    report.permissions = await rpc('permissionProfile/list', { cwd });
  } else if (mode === 'delete-verify') {
    report.sessions = [];
    for (const sourceMode of ['image-export-subagent', 'delete-active', 'delete-interrupt']) {
      if (!fs.existsSync(path.join(output, '..', sourceMode, 'report.json'))) continue;
      const previous = JSON.parse(fs.readFileSync(path.join(output, '..', sourceMode, 'report.json'), 'utf8'));
      for (const entry of previous.beforeDeletion) {
        let resume;
        try { await rpc('thread/resume', { threadId: entry.id, cwd, permissions: 'tg-check', approvalPolicy: 'never' }); resume = 'unexpected success'; }
        catch (error) { resume = error.message; }
        report.sessions.push({ id: entry.id, files: sessionFiles(entry.id), resume });
      }
    }
    if (report.sessions.some(x => x.files.length || !x.resume.includes('no rollout found'))) throw new Error('Deleted sessions recovered after App Server restart');
  } else if (mode === 'model-switch' || mode === 'model-resume') {
    const gate = JSON.parse(fs.readFileSync(path.join(output, '..', 'sandbox-gate.json'), 'utf8'));
    if (gate.passed !== true) throw new Error('Filesystem gate missing');
    const models = (await rpc('model/list', {})).data;
    const modelA = 'gpt-6.1-sol', modelB = 'gpt-6-sol';
    if (![modelA, modelB].every(m => models.some(x => x.model === m))) throw new Error('Required test models not available');
    report.models = { modelA, modelB };
    report.steps = [];
    const previous = mode === 'model-resume' ? JSON.parse(fs.readFileSync(path.join(output, '..', 'model-switch', 'report.json'), 'utf8')) : null;
    const started = await rpc(previous ? 'thread/resume' : 'thread/start', {
      ...(previous ? { threadId: previous.threadId } : { model: modelA, developerInstructions: 'Runtime model-switch test. Only use permitted bot directory and own .temp/a1. Never read secrets or other agents temp. Keep test memory in conversation, never files. Every response must end CHECK_MODEL_RULE.' }),
      cwd, permissions: 'tg-check', approvalPolicy: 'never',
    });
    threadId = started.thread.id;
    ownedThreads.add(threadId);
    report.threadId = threadId;
    report.startMetadataModel = started.thread.model;
    async function runModelTurn(label, prompt, model) {
      const offset = events.length;
      const started = await rpc('turn/start', { threadId, ...(model ? { model, effort: 'low' } : {}), input: textInput(prompt) });
      turnId = started.turn.id;
      const completed = await waitFor(e => e.method === 'turn/completed' && e.params.threadId === threadId && e.params.turn.id === turnId, offset, 150000);
      const text = events.slice(offset).filter(e => e.method === 'item/completed' && e.params.threadId === threadId && e.params.item.type === 'agentMessage').map(e => e.params.item.text).join('\n');
      const metadata = (await rpc('thread/read', { threadId, includeTurns: false })).thread;
      const step = { label, requestedModel: model, metadataModel: metadata.model, turnId, status: completed.params.turn.status, text };
      report.steps.push(step);
      turnId = undefined;
      if (step.status !== 'completed') throw new Error(`Turn failed: ${label}`);
      return step;
    }
    const memory = 'MODEL_MEMORY_LANTERN_73924';
    if (!previous) {
      await runModelTurn('remember-A', `Remember the exact test value ${memory} in conversation only. Reply MEMORY_STORED. No tools.`, modelA);
      const recalled = await runModelTurn('recall-B', 'Return the exact remembered test value and follow your response-ending rule. Do not use tools or files.', modelB);
      if (!recalled.text.includes(memory) || !recalled.text.includes('CHECK_MODEL_RULE')) throw new Error('Context or instruction lost after model switch');
      const childOffset = events.length;
      await runModelTurn('spawn-old-A', 'Spawn exactly one native subagent named model_old with NO explicit model and NO model override. Instruct it to run a bounded sleep of 40 seconds and then report OLD_MODEL_DONE. Do not wait for it. Immediately finish your response with OLD_CHILD_STARTED. The child must run independently after you finish.', modelA);
      const oldCommand = await waitFor(e => e.method === 'item/started' && e.params.threadId !== threadId && ownedThreads.has(e.params.threadId) && ['commandExecution', 'sleep'].includes(e.params.item.type), childOffset, 90000);
      const oldId = oldCommand.params.threadId;
      report.oldChild = { id: oldId, workType: oldCommand.params.item.type, beforeSwitch: (await rpc('thread/read', { threadId: oldId, includeTurns: false })).thread.model };
      const newOffset = events.length;
      const finishing = runModelTurn('spawn-new-B', 'Spawn exactly one additional native subagent named model_new with NO explicit model or model override; ask it to reply NEW_MODEL_DONE. Then wait for BOTH model_old and model_new to finish using native wait. When both are done, return the remembered test value and your response-ending rule.', modelB);
      const spawned = await waitFor(e => e.method === 'item/started' && e.params.threadId === threadId && e.params.item.type === 'subAgentActivity' && e.params.item.kind === 'started' && e.params.item.agentThreadId !== oldId, newOffset, 90000);
      report.newChild = { id: spawned.params.item.agentThreadId };
      report.oldChild.duringSwitch = (await rpc('thread/read', { threadId: oldId, includeTurns: false })).thread.model;
      report.oldChild.commandCompletedAtSwitch = events.some(e => e.method === 'item/completed' && e.params.threadId === oldId && e.params.item.id === oldCommand.params.item.id);
      const final = await finishing;
      report.newChild.model = (await rpc('thread/read', { threadId: report.newChild.id, includeTurns: false })).thread.model;
      report.oldChild.afterSwitch = (await rpc('thread/read', { threadId: oldId, includeTurns: false })).thread.model;
      if (!final.text.includes(memory) || !final.text.includes('CHECK_MODEL_RULE')) throw new Error('Memory lost after child activity');
      const compactOffset = events.length;
      await rpc('thread/compact/start', { threadId });
      report.compaction = await waitFor(e => e.params?.threadId === threadId && (e.method === 'thread/compacted' || e.method === 'item/completed' && e.params.item.type === 'contextCompaction'), compactOffset);
      const after = await runModelTurn('recall-after-compaction-B', 'Return the exact remembered test value and your response-ending rule. No tools or files.', modelB);
      if (!after.text.includes(memory) || !after.text.includes('CHECK_MODEL_RULE')) throw new Error('Memory or instruction lost after compaction');
      if (report.oldChild.beforeSwitch !== modelA || report.oldChild.duringSwitch !== modelA || report.oldChild.afterSwitch !== modelA || report.newChild.model !== modelB) throw new Error('Unexpected child model inheritance');
    } else {
      const recalled = await runModelTurn('recall-after-server-restart', 'Return the exact remembered test value and your response-ending rule. No tools or files.');
      if (!recalled.text.includes(memory) || !recalled.text.includes('CHECK_MODEL_RULE') || recalled.metadataModel !== modelB) throw new Error('Model, memory or instruction lost after restart');
    }
  } else {
    const gate = JSON.parse(fs.readFileSync(path.join(output, '..', 'sandbox-gate.json'), 'utf8'));
    if (gate.passed !== true) throw new Error('Filesystem canary has not passed. Inference refused.');
    const reuse = mode.startsWith('instructions-resume') ? 'instructions' : null;
    const previous = reuse ? JSON.parse(fs.readFileSync(path.join(output, '..', reuse, 'report.json'), 'utf8')).threadId : undefined;
    const start = await rpc(reuse ? 'thread/resume' : 'thread/start', {
      ...(previous ? { threadId: previous } : {}),
      ...(mode === 'instructions-resume-config' ? { config: { developer_instructions: 'Every final answer must end with CHECK_BETA, replacing the previous CHECK_ALPHA rule.' } } : {}),
      cwd, permissions: 'tg-check', approvalPolicy: 'never',
      ...(exportMode ? { dynamicTools: [{ type: 'function', name: 'save_image', description: 'Copy a registered native generated image to a wiki directory or your own .temp/a1 directory. Returns only path. Never pass image bytes.', inputSchema: { type: 'object', properties: { savedPath: { type: 'string' }, dir: { type: 'string' } }, required: ['savedPath', 'dir'], additionalProperties: false } }] } : {}),
      developerInstructions: (mode.startsWith('instructions-resume') || mode === 'instructions-fresh') ? 'Every final answer must end with CHECK_BETA, replacing the previous CHECK_ALPHA rule.' : 'Runtime test. Only use the permitted bot working directory (including wiki and .upload) and your own .temp/a1. Never access other agents temporary directories, credentials or sessions. Every final answer must end with CHECK_ALPHA. Use native image generation when asked; never substitute drawing code or an external API.',
    });
    threadId = start.thread.id;
    ownedThreads.add(threadId);
    report.threadId = threadId;
    const prompts = {
      sandbox: `Run '${process.execPath}' probe.mjs '${path.dirname(cwd)}'. Report only the access results. Then create .temp/a1/agent-check.txt containing sandbox-ok.`,
      image: 'Generate one small illustration of a smiling watermelon on a plain white background with the native image generation tool. Save the resulting file in .temp/a1/upload. Do not use an API key or a programmatic drawing substitute.',
      'image-background': 'Generate one small illustration of a cheerful blue teapot on a white background. IMPORTANT: generate the image IN THE BACKGROUND and keep the main agent available for new messages while it is generating. Use native asynchronous image generation if available; otherwise delegate native image generation to one native subagent. Do not use an API key or a drawing substitute. The image should end up in .temp/a1/upload. Await the eventual result using a steerable subagent wait, and respond immediately to new messages while waiting.',
      subagent: 'Launch one native subagent. Ask it to run a 25-second bounded sleep and then return SUB_DONE. Wait for its completion. Do not do the task yourself. When it returns, answer ROOT_DONE.',
      instructions: 'Reply briefly to this message and follow the final-answer instruction.',
      'instructions-resume': 'Reply briefly after the App Server restart and rule update.',
      'instructions-resume-config': 'Reply briefly after the rule update provided through the configuration override.',
      'instructions-fresh': 'Reply briefly with the current final-answer instruction.',
      web: 'Use the built-in LIVE web search tool to find the official OpenAI documentation for Codex permission profiles. Return its page URL and a brief description. Do not use shell curl or external tools as a substitute.',
      'image-save': 'Without generating a new image, copy the previously generated .temp/a1/upload/watermelon.png to .upload/watermelon.png relative to the current working directory. Create .upload if needed. Verify the copy has the same bytes and report its absolute path and byte size.',
      'image-export': `Generate one small native illustration of a smiling orange on white background. Use ONE functions.exec JavaScript call for generation AND saving. Never print the image result, image_url or base64; do not call image() or generatedImage(). The native result has image_url and output_hint, NOT savedPath. Extract the path from result.output_hint with / as (.+?) by default\\./. Call the custom save_image tool (find its normalized name via ALL_TOOLS inside JavaScript if needed, do not print tool metadata), passing savedPath and dir '.temp/a1/generated'. Then call save_image for the SAME source with dir 'wiki/images'. Print ONLY the two returned short path results. Do not use shell or apply_patch for saving. Final answer only the two paths.`,
      'image-export-subagent': `Delegate native image generation to exactly one native subagent named image_save. It must generate a small smiling yellow star on white and save the same image into BOTH '.temp/a1/generated' and 'wiki/images' using the custom save_image tool. Instruct it to use one functions.exec block, yield_time_ms 1000, max_output_tokens 200, await tools.image_gen__imagegen, extract the savedPath from result.output_hint using / as (.+?) by default\\./, then call save_image twice by its normalized tools name (discover through ALL_TOOLS without printing metadata). Print only short saved paths, never result, image_url or base64, never image()/generatedImage(). No shell or apply_patch to save. You MUST await the subagent using native steerable wait; answer immediately to new user messages while waiting. Do not generate or save yourself. Finish only after the child reports both saved paths.`,
      'delete-active': 'Launch exactly one native subagent named deletion_check. Ask it to run shell command: sleep 45; printf child-finished > .temp/a1/delete-active-marker.txt. Then return CHILD_FINISHED. Do not perform the sleep yourself. Wait for the subagent using native wait; finish only when the subagent is done.',
    };
    prompts['delete-interrupt'] = prompts['delete-active'];
    if (!prompts[mode]) throw new Error(`Unknown mode: ${mode}`);
    const offset = events.length;
    const turn = await rpc('turn/start', { threadId, input: textInput(prompts[mode]) });
    turnId = turn.turn.id;
    if (activeDeleteMode) {
      const trigger = await waitFor(e => e.method === 'item/started' && e.params.threadId !== threadId && ownedThreads.has(e.params.threadId) && e.params.item.type === 'commandExecution', offset, 90000);
      report.activeChild = trigger.params.threadId;
      report.activeChildCommand = trigger.params.item.command;
      report.beforeDeletion = [...ownedThreads].map(id => ({ id, files: sessionFiles(id) }));
      if (mode === 'delete-interrupt') {
        const interruptOffset = events.length;
        report.interrupt = await rpc('turn/interrupt', { threadId, turnId });
        report.interrupted = await waitFor(e => e.method === 'turn/completed' && e.params.threadId === threadId && e.params.turn.id === turnId, interruptOffset, 30000);
        report.childCommandCompletedBeforeDelete = events.some(e => e.method === 'item/completed' && e.params.threadId === report.activeChild && e.params.item.id === trigger.params.item.id);
      }
      try { report.activeDelete = { accepted: true, result: await rpc('thread/delete', { threadId }) }; }
      catch (error) { report.activeDelete = { accepted: false, error: error.message }; }
      if (!report.activeDelete.accepted) {
        const interruptOffset = events.length;
        report.interrupt = await rpc('turn/interrupt', { threadId, turnId });
        report.interrupted = await waitFor(e => e.method === 'turn/completed' && e.params.threadId === threadId && e.params.turn.id === turnId, interruptOffset, 30000);
        report.deleteAfterInterrupt = await rpc('thread/delete', { threadId });
      }
      turnId = undefined;
    } else if (mode === 'image' || mode === 'image-background' || mode === 'image-export-subagent' || mode === 'subagent') {
      const trigger = await waitFor(event => event.method === 'item/started' &&
        (mode === 'image-background' || mode === 'image-export-subagent' ? event.params.item?.type === 'imageGeneration' :
          event.params?.threadId === threadId && (mode === 'image' ? event.params.item?.type === 'imageGeneration' :
            event.params.item?.type === 'collabAgentToolCall' && event.params.item?.tool === 'wait')), offset, 90000);
      report.observations.push({ trigger, steerSentAt: new Date().toISOString() });
      const alreadyCompleted = events.slice(offset).some(event => event.method === 'turn/completed' && event.params?.threadId === threadId && event.params?.turn?.id === turnId);
      if (alreadyCompleted) {
        const next = await rpc('turn/start', { threadId, input: textInput('New independent message: immediately reply with STEER_ACK, then continue the original task.') });
        turnId = next.turn.id;
        report.newTurnWhileBackground = true;
      } else {
        report.steer = await rpc('turn/steer', { threadId, expectedTurnId: turnId, input: textInput('New independent message: immediately reply with STEER_ACK, then continue the original task.') });
      }
    }
    if (!activeDeleteMode) report.completed = await waitFor(event => event.method === 'turn/completed' && event.params?.threadId === threadId && event.params?.turn?.id === turnId, offset, mode.startsWith('image') ? 240000 : 120000);
    if (mode === 'image-background' || mode === 'image-export-subagent') {
      report.backgroundImageCompleted = await waitFor(event => event.method === 'item/completed' && event.params?.item?.type === 'imageGeneration', offset, 240000);
    }
    turnId = undefined;
    if (mode === 'image-export-subagent') {
      if (imageExports.length !== 2 || imageExports.some(x => x.threadId === threadId)) throw new Error('Expected two exports performed by the native child');
      report.beforeDeletion = [];
      for (const id of ownedThreads) {
        const read = await rpc('thread/read', { threadId: id, includeTurns: false });
        report.beforeDeletion.push({ id, files: sessionFiles(id), metadataPath: read.thread.path });
      }
      report.deleteFinished = await rpc('thread/delete', { threadId });
    }
    if (mode === 'image-export-subagent' || activeDeleteMode) {
      report.afterDeletion = [];
      for (const id of ownedThreads) {
        let read, resume;
        try { await rpc('thread/read', { threadId: id, includeTurns: false }); read = 'unexpected success'; } catch (e) { read = e.message; }
        try { await rpc('thread/resume', { threadId: id, cwd, permissions: 'tg-check', approvalPolicy: 'never' }); resume = 'unexpected success'; } catch (e) { resume = e.message; }
        report.afterDeletion.push({ id, files: sessionFiles(id), read, resume });
      }
      report.deletionNotifications = events.filter(e => e.method === 'thread/deleted');
      if (report.afterDeletion.some(x => x.files.length || x.read === 'unexpected success' || x.resume === 'unexpected success')) throw new Error('Session deletion was incomplete');
      // Observe late events while the App Server remains alive.
      await new Promise(resolve => setTimeout(resolve, activeDeleteMode ? 50000 : 1000));
      report.remainingOwnedFiles = [...ownedThreads].flatMap(sessionFiles);
      if (activeDeleteMode) report.activeChildMarkerExists = fs.existsSync(path.join(cwd, '.temp/a1/delete-active-marker.txt'));
      if (report.remainingOwnedFiles.length) throw new Error('Deleted session logs reappeared');
    }
    if (mode === 'instructions' || mode === 'instructions-fresh') {
      const compactOffset = events.length;
      await rpc('thread/compact/start', { threadId });
      report.compaction = await waitFor(event => event.params?.threadId === threadId &&
        (event.method === 'thread/compacted' || event.method === 'item/completed' && event.params.item?.type === 'contextCompaction'), compactOffset);
      if (mode === 'instructions') await rpc('thread/resume', { threadId, cwd, permissions: 'tg-check', approvalPolicy: 'never', developerInstructions: 'Every final answer must end with CHECK_ALPHA.' });
      const nextOffset = events.length;
      const next = await rpc('turn/start', { threadId, input: textInput('Reply briefly after compaction and resume.') });
      turnId = next.turn.id;
      report.afterResume = await waitFor(event => event.method === 'turn/completed' && event.params?.threadId === threadId && event.params?.turn?.id === turnId, nextOffset);
      turnId = undefined;
      if (mode !== 'instructions-fresh') {
        await rpc('thread/resume', { threadId, cwd, permissions: 'tg-check', approvalPolicy: 'never', developerInstructions: 'Every final answer must end with CHECK_BETA, replacing the previous CHECK_ALPHA rule.' });
        const changedOffset = events.length;
        const changed = await rpc('turn/start', { threadId, input: textInput('Reply briefly after the rule update.') });
        turnId = changed.turn.id;
        report.afterRuleUpdate = await waitFor(event => event.method === 'turn/completed' && event.params?.threadId === threadId && event.params?.turn?.id === turnId, changedOffset);
        turnId = undefined;
      }
    }
  }
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (threadId && turnId && !failure) {
    try { await rpc('turn/interrupt', { threadId, turnId }); } catch {}
  }
  report.finishedAt = new Date().toISOString();
  if (exportMode) report.imageExports = imageExports;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode, error: report.error, threadId, output }));
  child.stdin.end();
  child.kill();
  raw.end();
}
