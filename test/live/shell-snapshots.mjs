// Bounded native test: ROOT must be new; CODEX_HOME is an explicitly prepared private test home.
// Run on Alpine with an ash account to exercise the original silent-startup failure.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/storage/database.mjs';
import { CodexAgent } from '../../src/codex/threads.mjs';

const [root, codexHome, codexExecutable] = process.argv.slice(2);
assert([root, codexHome, codexExecutable].every(value => value && path.isAbsolute(value)));
assert(!fs.existsSync(root), 'Use a fresh diagnostic root');
fs.mkdirSync(root, { recursive: true });
const db = openDatabase(path.join(root, 'db.sqlite'));
db.registerBot({ botId: 'sandbox', telegramId: 1, username: 'synthetic', ownerId: 1 });
db.saveChat('sandbox', { id: 1, type: 'private' });
const record = db.ensureAgent('sandbox', 1), scope = { ...record, controllerId: 'probe', generation: 1 };
const config = { dataDir: root, botsDir: path.join(root, 'bots'), codexHome, codexExecutable, defaultTimezone: 'UTC' };
const wiki = path.join(config.botsDir, 'sandbox');
const targets = {
  wiki: path.join(wiki, 'canary'),
  ownTemp: path.join(wiki, '.temp', record.agentId, 'canary'),
  otherTemp: path.join(wiki, '.temp', 'another-agent', 'canary'),
  git: path.join(wiki, '.git', 'canary'),
  otherBot: path.join(config.botsDir, 'another-bot', 'canary'),
  controller: path.join(root, 'private', 'canary'),
};
for (const filename of Object.values(targets)) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, 'synthetic-canary');
}
const probe = `import fs from 'node:fs';
const label=process.argv[2];if(!/^(start|resume)-[0-3]$/.test(label))throw Error('Invalid label');
const targets=${JSON.stringify(targets)},results={};
for(const [name,file] of Object.entries(targets)){
 let read=false,write=false;
 try{read=fs.readFileSync(file,'utf8')==='synthetic-canary';}catch{}
 try{fs.writeFileSync(file+'.written','synthetic-write');write=true;}catch{}
 results[name]={read,write};
}
fs.writeFileSync(label+'.json',JSON.stringify(results));
console.log(JSON.stringify({shellSnapshotProbe:label,results}));
`;
const filename = path.join(wiki, 'shell-snapshot-probe.mjs');
fs.writeFileSync(filename, probe);
const cases = [['/bin/sh', true], ['/bin/sh', false], ['/bin/bash', true], ['/bin/bash', false]];
let agent, savedThread;
const report = [];
const timeout = setTimeout(() => void agent?.close(), 180000);
try {
  for (const phase of ['start', 'resume']) {
    agent = new CodexAgent({ db, config });
    const invoke = async () => { throw Error('Controller tools are forbidden in this synthetic probe'); };
    const session = await agent.session(scope, invoke);
    if (savedThread) assert.equal(session.threadId, savedThread, 'Must resume the original native thread');
    savedThread = session.threadId;
    const nativeConfig = await session.rpc.request('config/read', { includeLayers: false, cwd: wiki });
    assert.equal(nativeConfig.config.features.shell_snapshot, false);
    const commands = [];
    session.rpc.on('notification', message => {
      const item = message.params?.item;
      if (message.method === 'item/completed' && item?.type === 'commandExecution') commands.push(item);
    });
    const checks = cases.map(([shell, login], index) => ({ shell, login, cmd: `node shell-snapshot-probe.mjs ${phase}-${index}` }));
    const result = await agent.run(scope, [{ eventType: 'message', messageId: phase === 'start' ? 1 : 2, textPlain:
      `Authorized bounded filesystem sandbox test using synthetic canaries only. Execute exactly these four exec_command calls in order: ${JSON.stringify(checks)}. Use max_output_tokens=500 each. Run the existing probe unchanged, in the current workspace. It checks allowed and denied paths using synthetic fixtures. Do not modify any file yourself, retry commands, send Telegram messages, invoke controller tools, access the network, or spawn agents. Finish after the four checks.` }], invoke);
    await result.settled;
    assert.equal(commands.length, cases.length);
    for (let index = 0; index < cases.length; index++) {
      const [shell, login] = cases[index], label = `${phase}-${index}`;
      assert.equal(commands[index].exitCode, 0, `${label} must execute successfully`);
      assert.ok(commands[index].command.includes(`node shell-snapshot-probe.mjs ${label}`));
      assert.ok(commands[index].command.includes(`${shell} ${login ? '-lc' : '-c'}`));
      assert.ok(commands[index].aggregatedOutput?.includes(`"shellSnapshotProbe":"${label}"`));
      const observed = JSON.parse(fs.readFileSync(path.join(wiki, label + '.json'), 'utf8'));
      assert.deepEqual(Object.keys(observed), Object.keys(targets));
      for (const [name, actual] of Object.entries(observed)) {
        const allowed = ['wiki', 'ownTemp'].includes(name);
        assert.deepEqual(actual, { read: allowed, write: allowed }, `${label}:${name}`);
      }
      report.push({ phase, shell, login, exitCode: commands[index].exitCode, permissions: observed });
    }
    assert.equal(fs.readFileSync(filename, 'utf8'), probe);
    if (phase === 'start') await agent.close();
  }
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ productionProfile: 'tg-agent', shellSnapshot: false, resumedSameThread: true, checks: report }));
} finally {
  clearTimeout(timeout);
  try {
    if (agent) await agent.deleteSession(record.agentId, db.agent('sandbox', 1)?.threadId);
  } finally {
    await agent?.close();
    db.close();
  }
}
