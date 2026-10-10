import {createVault} from './storage/vault.mjs';
import {WebSocketManager} from './websocket/manager.mjs';
import { messageTriggers } from './telegram/triggers.mjs';
import { browserRead } from './readers/browser.mjs';
import { pdfRead } from './readers/pdf.mjs';
import { filterChatInfo } from './telegram/chat-info.mjs';
import { richHelp } from './messages/rich-help.mjs';
import { BotGate } from './service/bot-gate.mjs';
import { generatedSource } from './files/generated-source.mjs';
import { recordReaction } from './messages/reactions.mjs';
import { shortMessage, serviceFields } from './telegram/short-message.mjs';
import { AgentQueue } from './agents/queue.mjs';
import { Lifecycle } from './agents/lifecycle.mjs';
import { createAccess, roles } from './access/scope.mjs';
import { createHistory, readableDates } from './agents/history.mjs';
import { createMessages } from './messages/actions.mjs';
import { buttons, closeButtons, parseCallback, permitsAllow, richInput } from './messages/callbacks.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { BotFiles } from './files/paths.mjs';
import { createDownload } from './files/download.mjs';
import { Scheduler } from './scheduler/tasks.mjs';
import { createCommands } from './commands/router.mjs';
import { createMaster } from './commands/master.mjs';
import { createFileCommands } from './commands/files.mjs';
import { gitSetup } from './git/setup.mjs';
import { gitChanges, gitSync, gitAuth } from './git/operations.mjs';
import { AlbumCollector } from './telegram/albums.mjs';
export function createController({ db, telegram, agent, onError = () => {}, cursorKey, clock = Date.now, config }) {
  const lifecycle = new Lifecycle(), scopes = new Map(), gate = new BotGate(), deleting = new Set(), stopping = new Set();
  const isStopping = (botId, chatId) => stopping.has(`${botId}:${chatId}`);
  const assertCurrent = scope => { lifecycle.assertCurrent(scope); if (isStopping(scope.botId, scope.chatId)) throw new Error("Chat is stopping."); };
  let closing;
  const loud = new Map(), historyGaps = new Set();
  const gapKey = (botId, chatId) => `${botId}:${chatId}`;
  const markGap = (botId, chatId) => { if (db.getChat(botId, chatId)?.chatType && ['group','supergroup'].includes(db.getChat(botId, chatId).chatType)) historyGaps.add(gapKey(botId, chatId)); };
  const addGapHint = (id, events) => { const scope = scopes.get(id), index = events.findIndex(e => ['message', 'message_edited', 'button'].includes(e.eventType)); const key = scope && gapKey(scope.botId, scope.chatId); if (index >= 0 && historyGaps.delete(key)) events[index] = { ...events[index], historyGap: true }; return events; };
  const activeMessages = new Map();
  const requests = new Map(), consumed = new Map();
  const actions = new Map(), images = new Map(), availability = new Map();
  const access = createAccess(db);
  const history = createHistory({ db, access, key: cursorKey ?? randomBytes(32), now: clock });
  const stores = new Map();
  const filesFor = scope => { if (!config?.botsDir) throw new Error('File storage is not configured'); if (!stores.has(scope.agentId)) {
    const store = new BotFiles(path.join(config.botsDir, scope.botId), scope.agentId);
    for (const image of db.sql.prepare('SELECT * FROM generated_images WHERE botId=? AND agentId=?').all(scope.botId, scope.agentId)) store.registerImage(image.threadId, image.path);
    stores.set(scope.agentId, store);
  } return stores.get(scope.agentId); };
  const messages = createMessages({ db, telegram, access, assertCurrent, assertTarget: (s, id) => { if (isStopping(s.botId, id)) throw new Error("Target chat is stopping."); }, uploads: async (scope, local) => Object.entries(local ?? {}).map(([name, filename]) => ({ name, filename: path.basename(filename), bytes: filesFor(scope).read(filename) })) });
  const download = createDownload({ db, telegram, access, filesFor, getToken: telegram.getToken });
  agent.botProfile = async scope => {
    const [me, description, shortDescription] = await Promise.all([
      telegram.call(scope.botId, 'getMe'),
      telegram.call(scope.botId, 'getMyDescription'),
      telegram.call(scope.botId, 'getMyShortDescription'),
    ]);
    return { userId: me.id, username: me.username, name: [me.first_name, me.last_name].filter(Boolean).join(' '), description: description.description ?? '', shortDescription: shortDescription.short_description ?? '' };
  };
  agent.onImage = (scope, threadId, source) => { generatedSource(config ?? {}, source); assertCurrent(scope); filesFor(scope).registerImage(threadId, source); db.sql.prepare('INSERT OR IGNORE INTO generated_images VALUES(?,?,?,?)').run(source, scope.botId, scope.agentId, threadId); };
  const chatDetails = async (scope, chatId) => {
    if (!Number.isSafeInteger(chatId) || chatId === 0) throw new Error('chatId must be a non-zero safe integer.');
    let accessible = false;
    try { access.assertRead(scope, chatId); accessible = true; } catch {}
    const chat = await telegram.call(scope.botId, 'getChat', { chat_id: chatId });
    if (chat.id !== chatId) throw new Error('Telegram returned a different chat.');
    const result = filterChatInfo(chat, accessible);
    if (result.pinned_message) result.pinned_message = readableDates(result.pinned_message);
    if (accessible && chat.type !== 'private') {
      const [count, member] = await Promise.allSettled([
        telegram.call(scope.botId, 'getChatMemberCount', { chat_id: chatId }),
        telegram.call(scope.botId, 'getChatMember', { chat_id: chatId, user_id: db.getBot(scope.botId).telegramId }),
      ]);
      if (count.status === 'fulfilled' && Number.isSafeInteger(count.value)) result.memberCount = count.value;
      if (member.status === 'fulfilled' && member.value?.status) result.botStatus = member.value.status;
    }
    return result;
  };
  const invokeTool = async (scope, name, args) => {
    assertCurrent(scope);
    if (deleting.has(scope.botId)) throw new Error('Bot is being deleted.');
    if (db.getChat(scope.botId, scope.chatId)?.chatType === 'private' && !db.role(scope.botId, scope.chatId)) throw new Error('Private user is no longer authorized');
    if (name === 'rich_help') return richHelp();
    if (name === 'time') return { now: new Date().toISOString() };
    if (name === 'browser_read') return browserRead(args, { files: filesFor(scope) });
    if (name === 'pdf_read') return pdfRead(filesFor(scope), args);
    if (name === 'schedule') return scheduler.schedule(scope, args);
    if (name === 'tasks') return scheduler.list(scope, args.taskIds);
    if (name === 'cancel_tasks') return scheduler.cancel(scope, args.taskIds);
    if (name === 'vault_get') return createVault(db).get(scope.botId, args.name);
    if (name === 'git_changes' || name === 'git_sync') { const settings = db.sql.prepare('SELECT * FROM git_settings WHERE botId=?').get(scope.botId); const options = { configured: Boolean(settings), root: path.join(config.botsDir, scope.botId), branch: settings?.branch, env: gitAuth(settings?.secretRef) }; return name === 'git_changes' ? gitChanges(options) : gitSync(options, args.message); }
    if (name.startsWith('ws_')) { if(!config?.botsDir) throw new Error('File storage is not configured'); const method=name.slice(3); if(!['open','list','pull','send','close','delete'].includes(method)) throw new Error('Unknown WebSocket tool'); const result=await websockets[method](scope, ['close','delete'].includes(method)?args.connectionId:args); assertCurrent(scope); return result; }
    if (name === 'download') return download(scope, args);
    if (name === 'save_image') return filesFor(scope).saveImage(scope.threadId, args.savedPath, args.dir);
    if (['read', 'history', 'search'].includes(name)) return history[name](scope, args);
    if (name === 'note_get') return { text: db.agent(scope.botId, scope.chatId).notes };
    if (name === 'note_set') { if (typeof args.text !== 'string' || [...args.text].length > 4000) throw new Error('Note exceeds 4000 code points'); db.sql.prepare('UPDATE agents SET notes=? WHERE agentId=?').run(args.text, scope.agentId); return { status: 'saved' }; }
    if (name === 'chats') return { chats: db.sql.prepare("SELECT * FROM chats WHERE botId=? AND (chatType!='private' OR chatId=?) ORDER BY chatId").all(scope.botId, scope.chatId).map(c => ({ chatId: c.chatId, chatType: c.chatType, name: c.name, ...(db.agent(scope.botId, c.chatId) ? { agentId: db.agent(scope.botId, c.chatId).agentId } : {}) })) };
    if (name === 'user_photos') {
      if (!Number.isSafeInteger(args.userId) || args.userId <= 0 || args.offset !== undefined && (!Number.isSafeInteger(args.offset) || args.offset < 0) || args.limit !== undefined && (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 100)) return { error: 'invalid_argument', description: 'Use a positive userId, non-negative offset and limit between 1 and 100.' };
      try { return await telegram.call(scope.botId, 'getUserProfilePhotos', { user_id: args.userId, offset: args.offset ?? 0, limit: args.limit ?? 10 }); }
      catch { return { error: 'profile_photos_unavailable', description: 'Telegram could not return photos for this user. Check the user ID and photo availability.' }; }
    }
    if (name === 'chat_info') return { chats: await Promise.all(args.chatIds.map(async chatId => { try { return await chatDetails(scope, chatId); } catch { return { chatId, error: 'chat_unavailable', description: 'Chat is inaccessible or current Telegram information could not be read.' }; } })) };
    if (name === 'agent_info') return { agents: await Promise.all(args.agentIds.map(async agentId => {
      const a = db.sql.prepare('SELECT * FROM agents WHERE botId=? AND agentId=?').get(scope.botId, agentId);
      if (!a) return { agentId, error: 'agent_not_found', description: 'Agent is unavailable in this bot.' };
      const chat = db.getChat(scope.botId, a.chatId);
      if (chat.chatType === 'private') { const native = JSON.parse(chat.json); return { agentId, chatType: 'private', name: chat.name, ...(native.username ? { username: native.username } : {}), ...(a.agentId === scope.agentId ? { chatId: a.chatId } : {}) }; }
      try { const info = await chatDetails(scope, a.chatId); return { agentId, ...info, chatId: info.id, chatType: info.type, name: info.title ?? [info.first_name, info.last_name].filter(Boolean).join(' '), ...(info.linked_chat_id ? { linkedChatId: info.linked_chat_id } : {}) }; } catch { return { agentId, error: 'chat_unavailable', description: 'Current Telegram information could not be read.' }; }
    })) };
    if (name === 'members') { if (db.getChat(scope.botId, scope.chatId).chatType && !['group','supergroup'].includes(db.getChat(scope.botId,scope.chatId).chatType)) throw new Error('members requires current group'); return { members: await Promise.all(args.userIds.map(async userId => { try { const m = await telegram.call(scope.botId, 'getChatMember', { chat_id: scope.chatId, user_id: userId }); return { userId, name: [m.user.first_name, m.user.last_name].filter(Boolean).join(' '), ...(m.user.username ? { username: m.user.username } : {}), status: m.status, ...(m.custom_title ? { customTitle: m.custom_title } : {}), ...(m.until_date > 0 ? { untilDate: new Date(m.until_date * 1000).toISOString() } : {}) }; } catch { return { userId, error: 'member_unavailable', description: 'Telegram member information could not be obtained.' }; } })) }; }
    if (name === 'agents') return { agents: db.sql.prepare('SELECT agents.*,chats.name,chats.chatType FROM agents JOIN chats USING(botId,chatId) WHERE botId=? ORDER BY createdAt,agentId').all(scope.botId).map(a => ({ agentId: a.agentId, chatType: a.chatType, name: a.name, ...(a.chatType !== 'private' || a.agentId === scope.agentId ? { chatId: a.chatId } : {}) })) };
    if (name === 'agent_message') {
      if (typeof args.text !== 'string' || [...args.text].length > 8000) throw new Error('Agent message exceeds 8000 Unicode code points');
      const target = db.sql.prepare('SELECT * FROM agents WHERE botId=? AND agentId=?').get(scope.botId, args.agentId);
      if (!target || !db.getChat(target.botId,target.chatId)?.agentEnabled || isStopping(target.botId, target.chatId) || db.getChat(scope.botId, target.chatId)?.chatType === 'private' && !db.role(scope.botId, target.chatId)) throw Object.assign(new Error('The target agent is unavailable. The message was not queued.'), { code: 'agent_unavailable' });
      db.sql.prepare('INSERT INTO agent_messages(botId,fromAgentId,toAgentId,date,text) VALUES(?,?,?,?,?)').run(scope.botId, scope.agentId, target.agentId, clock(), args.text);
      if (!requests.has(target.agentId)) requests.set(target.agentId, new Map()); const req = requests.get(target.agentId); req.set(scope.agentId, (req.get(scope.agentId) ?? 0) + 1);
      scopes.set(target.agentId, lifecycle.scope({ botId: target.botId, agentId: target.agentId, chatId: target.chatId }));
      queue.enqueue(target.agentId, { eventType: 'agent_message', from: { agentId: scope.agentId, ...(db.getChat(scope.botId, scope.chatId).chatType !== 'private' ? { chatId: scope.chatId } : {}) }, text: args.text }, 'agent');
      return { status: 'queued' };
    }
    if (name === 'send' || name === 'edit') return messages[name](scope, args);
    if (name === 'forward' || name === 'copy') return messages.transfer(scope, name, args);
    if (['delete', 'pin', 'unpin', 'react'].includes(name)) {
      const target = args.chatId ?? scope.chatId; if (name === 'delete' && target !== scope.chatId) throw new Error('Deletion is allowed only in the current chat.'); if (isStopping(scope.botId, target)) throw new Error('Target chat is stopping.'); access.assertWrite(scope, target); assertCurrent(scope);
      const method = { delete: 'deleteMessage', pin: 'pinChatMessage', unpin: 'unpinChatMessage', react: 'setMessageReaction' }[name];
      await telegram.call(scope.botId, method, { chat_id: target, message_id: args.messageId, ...(name === 'react' ? { reaction: args.reaction } : {}) });
      if (name === 'react') recordReaction(db, scope.botId, { chat: { id: target }, message_id: args.messageId, date: clock() / 1000 }, args.reaction);
      if (name === 'delete') db.sql.prepare('DELETE FROM messages WHERE botId=? AND chatId=? AND messageId=?').run(scope.botId, target, args.messageId);
      return { status: 'done' };
    }
    throw new Error('Unknown or invalid tool');
  };
  const invoke = (scope, name, args) => gate.run(scope.botId, () => invokeTool(scope, name, args), scope.agentId);
  const scheduled = new Map();
  const trackConsumed = (id, events) => { if (!consumed.has(id)) consumed.set(id, new Map()); const count = consumed.get(id); for (const e of events) if (e.eventType === 'agent_message') count.set(e.from.agentId, (count.get(e.from.agentId) ?? 0) + 1); };
  const prepare = (id, events) => addGapHint(id, events.map(e => { if (e.eventType !== 'scheduled') { if (e.eventType === 'message' || e.eventType === 'message_edited') { if (!activeMessages.has(id)) activeMessages.set(id, { messages: new Set(), edits: new Set() }); activeMessages.get(id).messages.add(e.messageId); if (e.eventType === 'message_edited') activeMessages.get(id).edits.add(e.messageId); } return e; } const full = scheduler.take(e.taskId); if (full) { if (!scheduled.has(id)) scheduled.set(id, new Set()); scheduled.get(id).add(e.taskId); } return full; }).filter(Boolean));
  const releaseOrigins = (id, count) => {
    const outstanding = requests.get(id);
    for (const [sender, n] of count ?? []) { const remaining = (outstanding?.get(sender) ?? 0) - n; if (remaining > 0) outstanding.set(sender, remaining); else outstanding?.delete(sender); }
  };
  const completeScheduled = (id, success) => { const ids = [...(scheduled.get(id) ?? [])]; scheduled.delete(id); for (const taskId of ids) scheduler.complete(taskId, success); };
  const queue = new AgentQueue({ onDropped: (id, events, source) => { const scope = scopes.get(id); if (scope && source === 'chat' && (Array.isArray(events) ? events : [events]).some(e => ['message', 'message_edited'].includes(e.eventType))) markGap(scope.botId, scope.chatId); }, dispatch: async (id, events) => { let scope = lifecycle.scope(scopes.get(id)); scopes.set(id, scope); const record = db.agent(scope.botId, scope.chatId); if (record.threadId && record.threadRulesVersion !== db.getBot(scope.botId).rulesVersion) { await agent.waitBackground?.(id).catch(() => {}); lifecycle.invalidate(id); db.sql.prepare('UPDATE agents SET threadId=NULL,threadRulesVersion=NULL WHERE agentId=?').run(id); await agent.deleteSession?.(id, record.threadId); scope = lifecycle.scope({ botId: scope.botId, chatId: scope.chatId, agentId: id }); scopes.set(id, scope); } trackConsumed(id, events); const batch = prepare(id, events); const result = batch.length ? await agent.run(scope, batch, (name, args, threadId) => invoke({ ...scope, threadId }, name, args)) : undefined;
    const batchOrigins = consumed.get(id); consumed.delete(id);
    if (result?.settled) {
      const ids = [...(scheduled.get(id) ?? [])]; scheduled.delete(id);
      queue.track(result.settled.then(() => {
        if (lifecycle.closed) return;
        let current = true; try { assertCurrent(scope); } catch { current = false; }
        for (const taskId of ids) scheduler.complete(taskId, current); if (current) releaseOrigins(id, batchOrigins);
      }).catch(async error => {
        if (lifecycle.closed) return;
        for (const taskId of ids) scheduler.complete(taskId, false);
        try { assertCurrent(scope); } catch { return; }
        queue.clear(id); await queue.onError(id, error);
      }), id);
    } else { completeScheduled(id, true); releaseOrigins(id, batchOrigins); } activeMessages.delete(id); }, steer: (id, events) => { if (agent.canSteer && !agent.canSteer(id)) throw Object.assign(new Error('The root turn has already finished.'), { code: 'steer_expired' }); trackConsumed(id, events); return agent.steer(id, prepare(id, events)); }, onError: async (id, error) => {
    if (lifecycle.closed || deleting.has(scopes.get(id)?.botId) || isStopping(scopes.get(id)?.botId, scopes.get(id)?.chatId)) return;
    completeScheduled(id, false);
    activeMessages.delete(id);
    if (error.code === 'rules_replaced') return;
    scheduler.failQueued(id);
    if (actions.has(id)) clearInterval(actions.get(id)); actions.delete(id); availability.delete(id); images.delete(id);
    agent.detach?.(id);
    for (const sender of requests.get(id)?.keys() ?? []) { const a = db.sql.prepare('SELECT * FROM agents WHERE agentId=?').get(sender); if (!a) continue; scopes.set(sender, lifecycle.scope({ botId: a.botId, chatId: a.chatId, agentId: sender })); queue.enqueue(sender, { eventType: 'agent_error', agentId: id, error: 'agent_failed', description: 'The target agent failed while processing messages. Your request may not have been completed.' }, 'agent'); }
    requests.delete(id); consumed.delete(id);
    const scope = scopes.get(id); lifecycle.invalidate(id); onError(error);
    try { await telegram.call(scope.botId, 'sendMessage', { chat_id: scope.chatId, text: `Ошибка агента ${id}. Очередь очищена.` }); } catch {}
  } });
  const scheduler = new Scheduler({ db, clock, enqueue: (id, event) => { const target = db.sql.prepare('SELECT * FROM agents WHERE agentId=?').get(id); if (!target || !db.getChat(target.botId,target.chatId)?.agentEnabled || isStopping(target.botId, target.chatId)) return; scopes.set(id, lifecycle.scope({ botId: target.botId, chatId: target.chatId, agentId: id })); if (gate.held.has(target.botId)) queue.setPaused(id, true); queue.enqueue(id, event, 'schedule'); }, notify: async (task, description) => { const a = db.sql.prepare('SELECT * FROM agents WHERE agentId=?').get(task.agentId); if (!a) return; try { await telegram.call(a.botId, 'sendMessage', { chat_id: a.chatId, text: [`Ошибка задачи ${task.taskId}; агент ${a.agentId}.`, task.description, task.at ?? `${task.cron} (${task.timezone})`, (() => { const pending = db.sql.prepare("SELECT * FROM task_firings WHERE taskId=? AND state='pending'").get(task.taskId); return pending ? `Пропущено ${pending.count} срабатываний с ${new Date(pending.firstAt).toISOString()}` : ''; })(), description, `/task retry ${task.taskId}`, `/task delete ${task.taskId}`].filter(Boolean).join('\n').slice(0, 4000) }); } catch {} } });
  const updateAction = id => {
    if (actions.has(id)) clearInterval(actions.get(id)); actions.delete(id);
    const action = availability.get(id) === 'working' ? 'typing' : images.get(id)?.size ? 'upload_photo' : null;
    const scope = scopes.get(id); if (!action || !scope) return;
    const sendAction = async () => { try { assertCurrent(scope); await telegram.call(scope.botId, 'sendChatAction', { chat_id: scope.chatId, action }); } catch {} };
    sendAction(); const timer = setInterval(sendAction, 4000); timer.unref(); actions.set(id, timer);
  };
  agent.onAvailability = (id, status) => { availability.set(id, status); queue.setWaiting(id, status === 'waiting'); updateAction(id); };
  agent.onImageStatus = (id, image, active) => { if (!images.has(id)) images.set(id, new Set()); active ? images.get(id).add(image) : images.get(id).delete(image); updateAction(id); };
  agent.assertCurrent = scope => assertCurrent(scope);
  if(config?.botsDir)for(const a of db.sql.prepare('SELECT botId,agentId FROM agents').all()){
    try{new BotFiles(path.join(config.botsDir,a.botId),a.agentId).remove(`.temp/${a.agentId}/websocket`);}catch(e){if(e.code!=='ENOENT')onError(Object.assign(new Error('Old WebSocket files could not be removed.'),{code:'websocket_cleanup_failed'}));}
  }
  const websockets = new WebSocketManager({botsDir:config?.botsDir,clock,onError,onEvent:(owner,event)=>{
    const a=db.sql.prepare('SELECT * FROM agents WHERE botId=? AND agentId=?').get(owner.botId,owner.agentId);
    if(!a||!db.getChat(a.botId,a.chatId)?.agentEnabled||deleting.has(a.botId)||isStopping(a.botId,a.chatId)||lifecycle.closed)return;
    const scope=lifecycle.scope({botId:a.botId,chatId:a.chatId,agentId:a.agentId});scopes.set(a.agentId,scope);
    if(event.eventType==='websocket_ready' && queue.state(a.agentId).events.some(x=>x.source==='websocket'&&x.event.eventType===event.eventType&&x.event.connectionId===event.connectionId))return;
    queue.enqueue(a.agentId,event,'websocket',()=>{try{lifecycle.assertCurrent(scope);return Boolean(db.getChat(a.botId,a.chatId)?.agentEnabled)&&(event.eventType!=='websocket_ready'||Boolean(websockets.records.get(event.connectionId)?.buffer.length));}catch{return false;}});
  }});
  const deliver = (botId, list, trigger, activatedAlbum = false) => {
    if (isStopping(botId, list[0].chat.id) || deleting.has(botId) || !db.getBot(botId) || !db.getChat(botId, list[0].chat.id)) return false;
    const triggersById=new Map(list.map(m=>[m.message_id,m.__triggers]));
    list = list.map(message => db.getMessage(botId, message.chat.id, message.message_id)).filter(Boolean);
    if (!list.length || list[0].chat.type === 'private' && !db.role(botId, list[0].chat.id)) return false;
    if (!db.getChat(botId,list[0].chat.id)?.agentEnabled) return false;
    const m = list[0], key = `${botId}:${m.chat.id}`;
    if (m.chat.type !== 'private') { if (trigger) loud.set(key, { until: clock() + 120000, remaining: 10 }); else if (!activatedAlbum) { const listen = loud.get(key); if (!listen || listen.until <= clock() || listen.remaining <= 0) { markGap(botId, m.chat.id); return false; } listen.remaining--; } }
    const a = db.ensureAgent(botId, m.chat.id); scopes.set(a.agentId, lifecycle.scope({ botId, chatId: m.chat.id, agentId: a.agentId }));
    if (gate.held.has(botId)) queue.setPaused(a.agentId, true);
    const deadline = m.chat.type !== 'private' && !trigger && !activatedAlbum ? loud.get(key)?.until : null;
    const events=list.map(message=>({...shortMessage(message),...(triggersById.get(message.message_id)?.length?{triggers:triggersById.get(message.message_id)}:{})}));
    const accepted = queue.enqueue(a.agentId, list.length === 1 ? events[0] : events, 'chat', deadline !== null ? () => clock() < deadline : undefined) === 'accepted';
    if (!accepted) markGap(botId, m.chat.id);
    return accepted;
  };
  const albums = new AlbumCollector({ clock, onReady: (messages, trigger, active) => deliver(messages[0].__botId, messages, trigger, active) });
  const stopAgent = async (botId, chatId, { leave = true } = {}) => {
    const key = `${botId}:${chatId}`; if (stopping.has(key)) throw new Error("Chat is already stopping.");
    const a = db.agent(botId, chatId), chat = db.getChat(botId, chatId); if (!chat) return;
    stopping.add(key); albums.clearChat(botId,chatId);
    try {
    if (a) {
      websockets.deleteAgent(a.agentId);
      queue.setPaused(a.agentId, true); lifecycle.invalidate(a.agentId); queue.clear(a.agentId);
      for (const t of scheduler.list(a).tasks) scheduler.cancel(a, [t.taskId]);
      if (actions.has(a.agentId)) clearInterval(actions.get(a.agentId)); actions.delete(a.agentId); availability.delete(a.agentId); images.delete(a.agentId);
      await agent.deleteSession?.(a.agentId, a.threadId); websockets.closeAgent(a.agentId,'context_reset');
      await gate.idleScope(a.agentId); await queue.idleAgent(a.agentId);
      db.sql.prepare('DELETE FROM agent_messages WHERE botId=? AND (fromAgentId=? OR toAgentId=?)').run(botId, a.agentId, a.agentId);
      if (config?.botsDir && fs.existsSync(path.join(config.botsDir, botId, '.temp', a.agentId))) new BotFiles(path.join(config.botsDir, botId), a.agentId).remove(`.temp/${a.agentId}`);
      stores.delete(a.agentId); requests.delete(a.agentId); consumed.delete(a.agentId); activeMessages.delete(a.agentId);
    }
    loud.delete(`${botId}:${chatId}`);albums.clearChat(botId,chatId); historyGaps.delete(gapKey(botId, chatId));
    if (leave && chat.chatType !== 'private') await telegram.call(botId, 'leaveChat', { chat_id: chatId });
    db.sql.prepare('DELETE FROM chats WHERE botId=? AND chatId=?').run(botId, chatId);
    } finally { stopping.delete(key); }
  };
  const resets = new Map();
  const resetContext = record => {
    const id = record.agentId;
    if (resets.has(id)) return resets.get(id);
    queue.setHeld(id, 'context-reset', true);
    const work = Promise.resolve().then(async () => {
      await queue.idleAgent(id);
      await agent.waitBackground?.(id).catch(() => {});
      await gate.idleScope(id);
      if (lifecycle.closed || isStopping(record.botId, record.chatId) || deleting.has(record.botId)) return;
      await gate.run(record.botId, async () => {
        const current = db.sql.prepare('SELECT * FROM agents WHERE agentId=?').get(id);
        if (!current?.contextResetPending || lifecycle.closed || isStopping(record.botId, record.chatId)) return;
        lifecycle.invalidate(id);
        websockets.closeAgent(id,'context_reset');
        await agent.deleteSession?.(id, current.threadId);
        db.sql.prepare('UPDATE agents SET threadId=NULL,threadRulesVersion=NULL,contextResetPending=0,stopPending=0 WHERE agentId=?').run(id);
        activeMessages.delete(id);
      }, id);
    }).catch(async error => {
      onError(error);
      if (!lifecycle.closed && !deleting.has(record.botId) && !isStopping(record.botId, record.chatId)) try { await telegram.call(record.botId, 'sendMessage', {chat_id:record.chatId,text:`Не удалось очистить контекст ${id}. Повторите /agent clear ${id}.`}); } catch {}
    }).finally(() => {
      resets.delete(id);
      if (!lifecycle.closed && !db.sql.prepare('SELECT contextResetPending FROM agents WHERE agentId=?').get(id)?.contextResetPending) queue.setHeld(id, 'context-reset', false);
    });
    resets.set(id, work); return work;
  };
  const clearContext = async (botId, chatId, target) => {
    const records = target === '*' ? db.sql.prepare('SELECT * FROM agents WHERE botId=?').all(botId) : [target ? db.sql.prepare('SELECT * FROM agents WHERE botId=? AND agentId=?').get(botId,target) : db.agent(botId,chatId)].filter(Boolean);
    if (!records.length) throw Object.assign(new Error('Агент не найден.'), {safe:true});
    if (gate.held.has(botId) || deleting.has(botId) || records.some(a => isStopping(botId,a.chatId))) throw Object.assign(new Error('Идёт обслуживание бота или остановка агента. Повторите позже.'), {safe:true});
    const items = records.map(a => {
      const busy = Boolean(queue.agentJobs.get(a.agentId)?.size || agent.hasBackground?.(a.agentId) || resets.has(a.agentId));
      db.sql.prepare('UPDATE agents SET contextResetPending=1 WHERE agentId=?').run(a.agentId);
      return {a,busy,work:resetContext(a)};
    });
    await Promise.all(items.filter(x=>!x.busy).map(x=>x.work));
    return items.map(({a,busy}) => `${busy ? 'Очистка запланирована после завершения работы' : db.sql.prepare('SELECT contextResetPending FROM agents WHERE agentId=?').get(a.agentId)?.contextResetPending ? 'Очистка не выполнена; повторите команду' : 'Контекст очищен'}: ${a.agentId}`).join('\n');
  };
  const stateStops = new Map();
  const finishStop = record => {
    if(stateStops.has(record.agentId)) return stateStops.get(record.agentId);
    queue.setHeld(record.agentId,'disabled',true);
    const work=Promise.resolve().then(async()=>{
      await queue.idleAgent(record.agentId); await agent.waitBackground?.(record.agentId); await gate.idleScope(record.agentId);
      if(lifecycle.closed) return;
      await resetContext(record);
      const current=db.sql.prepare('SELECT contextResetPending FROM agents WHERE agentId=?').get(record.agentId);
      if(current && !current.contextResetPending) db.sql.prepare('UPDATE agents SET stopPending=0 WHERE agentId=?').run(record.agentId);
    }).catch(onError).finally(()=>stateStops.delete(record.agentId)); stateStops.set(record.agentId,work);return work;
  };
  const setAgentState = async (botId,chatId,enabled) => {
    const chat=db.getChat(botId,chatId);if(!chat)throw new Error('Chat is not connected.');
    if(enabled && (chat.chatType==='channel' || JSON.parse(chat.json).is_forum))throw new Error('This chat does not support an agent.');
    let a=db.agent(botId,chatId);
    if(enabled){if(a?.stopPending)throw new Error('Agent is stopping. Retry after completion.');if(chat.agentEnabled)return 'Уже включён';db.sql.prepare('UPDATE chats SET agentEnabled=1 WHERE botId=? AND chatId=?').run(botId,chatId);a=db.ensureAgent(botId,chatId);scopes.set(a.agentId,lifecycle.scope({botId,chatId,agentId:a.agentId}));queue.setHeld(a.agentId,'disabled',false);return `Агент включён. Пропущенных задач: ${scheduler.resume(a.agentId)}`;}
    if(!chat.agentEnabled && !a?.stopPending)return 'Уже выключен';
    db.sql.prepare('UPDATE chats SET agentEnabled=0 WHERE botId=? AND chatId=?').run(botId,chatId);loud.delete(`${botId}:${chatId}`);albums.clearChat(botId,chatId);
    if(a){db.sql.prepare('UPDATE agents SET stopPending=1,contextResetPending=1 WHERE agentId=?').run(a.agentId);queue.setHeld(a.agentId,'disabled',true);scheduler.disable(a.agentId);queue.clear(a.agentId);const busy=Boolean(queue.agentJobs.get(a.agentId)?.size || agent.hasBackground?.(a.agentId));const work=finishStop(a);if(!busy)await work;}
    return a && db.agent(botId,chatId)?.stopPending ? 'Агент выключается' : 'Агент выключен';
  };
  const fetchDocument = async (botId, document) => { const f = await telegram.call(botId, 'getFile', { file_id: document.file_id }); const response = await fetch(`https://api.telegram.org/file/bot${await telegram.getToken(botId)}/${f.file_path}`); if (!response.ok) throw new Error('Download failed'); return Buffer.from(await response.arrayBuffer()); };
  const updateRules = async (botId, document, force) => {
    const bytes = typeof document.text === 'string' ? Buffer.from(document.text, 'utf8') : await fetchDocument(botId, document); new TextDecoder('utf8', { fatal: true }).decode(bytes);
    const rulesDir = path.join(config.dataDir, 'rules', botId); fs.mkdirSync(rulesDir, { recursive: true }); fs.writeFileSync(path.join(rulesDir, 'AGENTS.md'), bytes);
    db.sql.prepare('UPDATE bots SET rulesVersion=rulesVersion+1 WHERE botId=?').run(botId);
    for (const a of db.sql.prepare('SELECT * FROM agents WHERE botId=?').all(botId)) {
      if (!force && (queue.state(a.agentId).busy || agent.hasBackground?.(a.agentId))) continue;
      lifecycle.invalidate(a.agentId); db.sql.prepare('UPDATE agents SET threadId=NULL,threadRulesVersion=NULL WHERE agentId=?').run(a.agentId); await agent.deleteSession?.(a.agentId, a.threadId); websockets.closeAgent(a.agentId,'context_reset');
    }
  };
  const masterCommands = config ? createMaster({ db, config,
    onBotAdded: id => { deleting.delete(id); gate.held.delete(id); config.onBotAdded?.(id); },
    onBotRemoved: async id => {
      deleting.add(id); websockets.deleteBot(id);
      for (const a of db.sql.prepare('SELECT * FROM agents WHERE botId=?').all(id)) { queue.setPaused(a.agentId, true); lifecycle.invalidate(a.agentId); agent.detach?.(a.agentId); }
      await config.onBotRemoved?.(id);
      await pauseBot(id);
      for (const a of db.sql.prepare('SELECT * FROM agents WHERE botId=?').all(id)) {
        queue.clear(a.agentId); scheduler.cancel(a, scheduler.list(a).tasks.map(t => t.taskId));
        if (actions.has(a.agentId)) clearInterval(actions.get(a.agentId)); actions.delete(a.agentId);
        scopes.delete(a.agentId); stores.delete(a.agentId); requests.delete(a.agentId); consumed.delete(a.agentId); activeMessages.delete(a.agentId); scheduled.delete(a.agentId); availability.delete(a.agentId); images.delete(a.agentId);
      }
    },
  }) : undefined;
  const resumeBot = botId => { for (const a of db.sql.prepare('SELECT * FROM agents WHERE botId=?').all(botId)) { scopes.set(a.agentId, lifecycle.scope({ botId, chatId: a.chatId, agentId: a.agentId })); queue.setPaused(a.agentId, false); } };
  const pauseBot = async botId => {
    let release;
    try {
      release = await gate.acquire(botId, async () => {
        const agents = db.sql.prepare('SELECT * FROM agents WHERE botId=?').all(botId);
        for (const a of agents) { queue.setPaused(a.agentId, true); lifecycle.invalidate(a.agentId); }
        for (const a of agents) {
          await agent.deleteSession?.(a.agentId, a.threadId); websockets.closeAgent(a.agentId,'context_reset');
          db.sql.prepare('UPDATE agents SET threadId=NULL,threadRulesVersion=NULL WHERE agentId=?').run(a.agentId);
          await queue.idleAgent(a.agentId);
        }
      });
    } catch (error) { if (!gate.held.has(botId)) resumeBot(botId); throw error; }
    return () => { release(); resumeBot(botId); };
  };
  const rawFileCommands = config ? createFileCommands({ db, config, telegram, fetchDocument, gitSetup: (botId, args, old) => gitSetup({ db, config, pauseBot }, botId, args, old) }) : undefined;
  const mcpRefreshes=new Map();
  const requestMcpRefresh=botId=>{
    for(const a of db.sql.prepare('SELECT * FROM agents WHERE botId=?').all(botId)){
      const id=a.agentId;if(mcpRefreshes.has(id))continue;
      queue.setHeld(id,'mcp-refresh',true);
      const work=Promise.resolve().then(async()=>{
        await queue.idleAgent(id);await agent.waitBackground?.(id);await gate.idleScope(id);
        if(!lifecycle.closed&&!deleting.has(botId)&&db.sql.prepare('SELECT 1 FROM agents WHERE botId=? AND agentId=?').get(botId,id))await agent.refreshSession?.(id);
      }).catch(async e=>{onError(e);if(!lifecycle.closed&&db.getChat(botId,a.chatId))try{await telegram.call(botId,'sendMessage',{chat_id:a.chatId,text:`MCP refresh failed for agent ${id}. The next request will retry loading configuration.`});}catch{}})
      .finally(()=>{mcpRefreshes.delete(id);queue.setHeld(id,'mcp-refresh',false);});
      mcpRefreshes.set(id,work);
    }
  };
  const fileCommands = rawFileCommands ? (botId, name, ...args) => name === 'git_setup' ? rawFileCommands(botId, name, ...args) : gate.run(botId, () => rawFileCommands(botId, name, ...args)) : undefined;
  const commands = createCommands({ db, config: config ?? {}, telegram, scheduler, stopAgent, setAgentState, agentStatus: id => ({status:db.sql.prepare('SELECT stopPending FROM agents WHERE agentId=?').get(id)?.stopPending ? 'выключается' : availability.get(id) ?? 'свободен',queue:queue.state(id).events.length}), updateRules, clearContext, models: () => agent.models(), websockets, requestMcpRefresh, testMcp:(botId,entry)=>agent.testMcp(botId,entry), masterCommands, fileCommands });
  for (const record of db.sql.prepare('SELECT * FROM agents').all()) {if(!db.getChat(record.botId,record.chatId).agentEnabled)queue.setHeld(record.agentId,'disabled',true);if(record.stopPending)finishStop(record);else if(record.contextResetPending)resetContext(record);}
  return {
    queue, lifecycle, invoke, scheduler, stopAgent, websockets,
    async receive(botId, update) {
      const route = update.message?.chat?.id ?? update.edited_message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? update.my_chat_member?.chat?.id;
      if (isStopping(botId, route)) { if (update.callback_query) await telegram.call(botId, "answerCallbackQuery", { callback_query_id: update.callback_query.id, text: "Бот занят" }); return; }
      if (deleting.has(botId)) return;
      const observedChat=update.message?.chat??update.edited_message?.chat??update.callback_query?.message?.chat;
      if(botId!=='master'&&observedChat?.is_forum){if(db.getChat(botId,observedChat.id))await stopAgent(botId,observedChat.id);else await telegram.call(botId,'leaveChat',{chat_id:observedChat.id});return;}
      const commandMessage = update.message;
      if (commandMessage && await commands.handle(botId, commandMessage)) return;
      if (botId === 'master') return;
      const reaction = update.message_reaction ?? update.message_reaction_count;
      if (reaction) { recordReaction(db, botId, reaction); return; }
      if (update.callback_query) {
        const cb = update.callback_query, m = cb.message;
        const ack = text => telegram.call(botId, 'answerCallbackQuery', { callback_query_id: cb.id, ...(text ? { text, show_alert: true } : {}) });
        if (!m || !db.getChat(botId, m.chat.id) || m.chat.type === 'channel' || m.chat.type === 'private' && !db.role(botId, cb.from.id)) { await ack('Кнопка недоступна'); return; }
        const stored = db.getMessage(botId, m.chat.id, m.message_id), a = db.agent(botId, m.chat.id);
        const button = buttons({ rich: stored?.rich_message, keyboard: stored?.reply_markup }).find(b => b.callback_data === cb.data);
        if (!button || button.disabled || !a || !db.getChat(botId,m.chat.id)?.agentEnabled) { await ack('Кнопка недоступна'); return; }
        const state = db.sql.prepare('SELECT * FROM button_state WHERE botId=? AND chatId=? AND messageId=?').get(botId, m.chat.id, m.message_id);
        if (m.chat.type !== 'private' && !permitsAllow(state?.permits ? JSON.parse(state.permits) : null, cb.data, cb.from.id)) { await ack('Нет доступа'); return; }
        let parsed; try { parsed = parseCallback(cb.data); } catch { await ack('Кнопка недоступна'); return; }
        const closed = JSON.parse(state?.closed ?? '[]');
        if (parsed.group && closed.includes(parsed.group)) { await ack('Выбор уже сделан'); return; }
        if (!queue.canAccept(a.agentId)) { await ack('Бот занят, попробуйте позже'); return; }
        if (parsed.group) db.sql.prepare('INSERT INTO button_state(botId,chatId,messageId,closed) VALUES(?,?,?,?) ON CONFLICT(botId,chatId,messageId) DO UPDATE SET closed=excluded.closed').run(botId, m.chat.id, m.message_id, JSON.stringify([...closed, parsed.group]));
        scopes.set(a.agentId, lifecycle.scope({ botId, agentId: a.agentId, chatId: m.chat.id }));
        const busy = queue.state(a.agentId).busy;
        if (['group','supergroup'].includes(m.chat.type)) loud.set(`${botId}:${m.chat.id}`, { until: clock() + 120000, remaining: 10 });
        await ack(busy ? 'Принято, ожидает обработки' : undefined);
        if (parsed.group) {
          const changed = closeButtons(stored, parsed.group, cb.data);
          try {
            const result = changed.rich_message
              ? await telegram.call(botId, 'editMessageText', { chat_id: m.chat.id, message_id: m.message_id, rich_message: richInput(changed.rich_message), ...(changed.reply_markup ? { reply_markup: changed.reply_markup } : {}) })
              : await telegram.call(botId, 'editMessageReplyMarkup', { chat_id: m.chat.id, message_id: m.message_id, reply_markup: changed.reply_markup });
            db.saveMessage(botId, typeof result === 'object' ? result : changed);
          } catch (error) { onError(error); }
        }
        queue.enqueue(a.agentId, { eventType: 'button', messageId: m.message_id, from: { userId: cb.from.id, name: [cb.from.first_name, cb.from.last_name].filter(Boolean).join(' '), ...(cb.from.username ? { username: cb.from.username } : {}) }, key: parsed.key, ...(parsed.group ? { btnGroup: parsed.group } : {}), text: (button.text ?? '').replace(/^(⬜️?|⬛️?|✅)\s*/u, '') }, 'chat');
        return;
      }
      if (update.my_chat_member) {
        const { chat, from, new_chat_member: member } = update.my_chat_member;
        if (['left', 'kicked'].includes(member.status)) { await stopAgent(botId, chat.id, { leave: false }); return; }
        if (chat.type === 'private' || !['member', 'administrator'].includes(member.status)) return;
        if (chat.is_forum) { if(db.getChat(botId,chat.id))await stopAgent(botId,chat.id);else await telegram.call(botId,'leaveChat',{chat_id:chat.id});return; }
        if ((roles[db.role(botId, from.id)] ?? 0) < roles.manager) { await telegram.call(botId, 'leaveChat', { chat_id: chat.id }); return; }
        db.saveChat(botId, chat); return;
      }
      const edited = Boolean(update.edited_message || update.edited_channel_post);
      const m = update.message ?? update.channel_post ?? update.edited_message ?? update.edited_channel_post;
      if (!m) return;
      if (m.migrate_to_chat_id || m.migrate_from_chat_id) {
        const oldId=m.migrate_from_chat_id??m.chat.id,newChat=m.migrate_to_chat_id?{...m.chat,id:m.migrate_to_chat_id,type:'supergroup'}:m.chat;
        if(newChat.is_forum){await stopAgent(botId,oldId,{leave:false});if(db.getChat(botId,newChat.id))await stopAgent(botId,newChat.id);else await telegram.call(botId,'leaveChat',{chat_id:newChat.id});return;}
        const a=db.agent(botId,oldId);
        if(a)queue.setHeld(a.agentId,'migration',true);
        try{if(a){await queue.idleAgent(a.agentId);await agent.waitBackground?.(a.agentId);await gate.idleScope(a.agentId);}db.migrateChat(botId,oldId,newChat);loud.delete(`${botId}:${oldId}`);historyGaps.delete(gapKey(botId,oldId));if(a){agent.detach?.(a.agentId);lifecycle.invalidate(a.agentId);scopes.set(a.agentId,lifecycle.scope({botId,chatId:newChat.id,agentId:a.agentId}));}}
        finally{if(a)queue.setHeld(a.agentId,'migration',false);}return;
      }
      if (m.chat.is_forum) { await stopAgent(botId, m.chat.id); return; }
      if (m.chat.type === 'private' ? !db.role(botId, m.from?.id) : !db.getChat(botId, m.chat.id)) return;
      db.saveMessage(botId, m);
      if (serviceFields.some(field => m[field] !== undefined)) return;
      if (edited) {
        const a = db.agent(botId, m.chat.id); if (!a || !db.getChat(botId,m.chat.id)?.agentEnabled || m.location?.live_period) return;
        const state = queue.state(a.agentId), active = activeMessages.get(a.agentId), pending = state.events.find(e => Array.isArray(e.event) ? e.event.some(item => item.messageId === m.message_id) : e.event.messageId === m.message_id);
        const replacement=item=>({...shortMessage(m,item.eventType),...(item.triggers?{triggers:item.triggers}:{})});
        if (pending) pending.event = Array.isArray(pending.event) ? pending.event.map(item => item.messageId === m.message_id ? replacement(item) : item) : replacement(pending.event);
        else if (active?.messages.has(m.message_id) && !active.edits.has(m.message_id)) queue.enqueue(a.agentId, shortMessage(m, 'message_edited'), 'chat');
        return;
      }
      if (m.chat.type === 'channel') return;
      if(!db.getChat(botId,m.chat.id)?.agentEnabled){markGap(botId,m.chat.id);return;}
      const triggers=messageTriggers(m,db.getBot(botId),JSON.parse(db.getChat(botId,m.chat.id).triggers)),trigger=triggers.length>0;
      if (m.media_group_id) albums.add(`${botId}:${m.chat.id}:${m.media_group_id}`, { ...m, __botId: botId, __triggers:triggers }, trigger);
      else deliver(botId, [{...m,__triggers:triggers}], trigger);
    },
    idle: async () => { do { await queue.idle(); await Promise.allSettled([...resets.values(),...stateStops.values(),...mcpRefreshes.values()]); } while (queue.jobs.size || resets.size || stateStops.size || mcpRefreshes.size); await gate.idle(); await closing; },
    close() { websockets.shutdown(); for (const timer of actions.values()) clearInterval(timer); actions.clear(); albums.close(); scheduler.close(); queue.close(); lifecycle.close(); closing ??= agent.close?.(); },
  };
}
