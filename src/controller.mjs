import {createVault} from './storage/vault.mjs';
import {McpOAuth,createOAuthRuntime} from './mcp/oauth.mjs';
import {createMcpStore} from './mcp/store.mjs';
import {isMcpAuthReply} from './commands/mcp-auth-reply.mjs';
import {WebSocketManager} from './websocket/manager.mjs';
import { messageTriggers } from './telegram/triggers.mjs';
import { browserRead } from './readers/browser.mjs';
import { pdfRead } from './readers/pdf.mjs';
import { filterChatInfo } from './telegram/chat-info.mjs';
import { richHelp } from './messages/rich-help.mjs';
import { BotGate } from './service/bot-gate.mjs';
import { generatedSource } from './files/generated-source.mjs';
import { recordReaction, projectReaction } from './messages/reactions.mjs';
import { shortMessage, serviceFields } from './telegram/short-message.mjs';
import { AgentQueue } from './agents/queue.mjs';
import { Lifecycle } from './agents/lifecycle.mjs';
import { createAccess, roles } from './access/scope.mjs';
import { createHistory, readableDates } from './agents/history.mjs';
import { createMessages } from './messages/actions.mjs';
import { buttons, buttonText, closeButtons, parseCallback, permitsAllow, richInput } from './messages/callbacks.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { BotFiles } from './files/paths.mjs';
import { createDownload } from './files/download.mjs';
import { createCustomEmojiDownload } from './files/custom-emoji.mjs';
import { createStickerSets } from './stickers/service.mjs';
import { Scheduler } from './scheduler/tasks.mjs';
import { createCommands } from './commands/router.mjs';
import {isEphemeral} from './commands/replies.mjs';
import { createMaster } from './commands/master.mjs';
import { createFileCommands } from './commands/files.mjs';
import { gitSetup } from './git/setup.mjs';
import { gitChanges, gitSync, gitAuth } from './git/operations.mjs';
import { AlbumCollector } from './telegram/albums.mjs';
import {topicIdOf} from './telegram/topics.mjs';
import {createTopicStore} from './storage/topics.mjs';
import {createWidgetService} from './widgets/service.mjs';
import {createWidgetEvents} from './widgets/events.mjs';
import {createInlineRequests} from './inline/requests.mjs';
import {createInlineService} from './inline/service.mjs';
import {createInlineAvatars} from './inline/avatars.mjs';
import {createInlineStore} from './inline/store.mjs';
import {createInlineEvents} from './inline/events.mjs';
import {createInlineMessages} from './inline/messages.mjs';
import {normalizeInlineResults} from './inline/results.mjs';
import {inlinePolicy} from './inline/contract.mjs';
import {createGuestStore} from './guest/store.mjs';
import {createGuestEvents} from './guest/events.mjs';
import {createGuestReceipts} from './guest/receipts.mjs';
import {createGuestService} from './guest/service.mjs';
import {createEphemeralStore} from './ephemeral/store.mjs';
import {createEphemeralMessages} from './ephemeral/messages.mjs';
import {createSayEvents} from './ephemeral/events.mjs';
import {createBrowse} from './browse/service.mjs';
import {createDocumentFetcher} from './files/document.mjs';
import {createAgentControl} from './agents/control.mjs';
import {updateControlReply} from './commands/replies.mjs';
import {createMessageSerial} from './messages/serial.mjs';
import {createButtonRollback} from './messages/button-rollback.mjs';
export function createController({ db, telegram, agent, onError = () => {}, cursorKey, clock = Date.now, config,widgetService,fileSignal }) {
  let widgets,widgetEvents;
  const inlineStore=createInlineStore(db,{now:clock}),inlineRequests=createInlineRequests({now:clock,policy:inlinePolicy(config?.inline)});
  const inlineAvatars=createInlineAvatars({telegram,getBot:id=>db.getBot(id),getMasterId:()=>config?.masterTelegramId,now:clock});
  let inline,inlineEvents,inlineMessages,guestEvents,guest;
  const guestStore=createGuestStore(db,{now:clock});
  const ephemeralStore=createEphemeralStore(db,{now:clock});
  let sayEvents,control;
  const lifecycle = new Lifecycle(), scopes = new Map(), gate = new BotGate(), deleting = new Set(), stopping = new Set();
  const isStopping = (botId, chatId) => stopping.has(`${botId}:${chatId}`);
  const assertCurrent = scope => { if(scope.widgetRef)widgets.authorize(scope.widgetRef);else lifecycle.assertCurrent(scope);if(scope.workId){const unit=control?.work.get(scope.workId),state=control?.store.read(scope.agentId);if(unit?.state==='cancelled'||state?.notice?.workIds?.includes(scope.workId))throw Object.assign(new Error('Work was cancelled.'),{code:'agent_cancelled'});} if (isStopping(scope.botId, scope.chatId)) throw new Error("Chat is stopping."); };
  let closing;
  const messageSerial=createMessageSerial();
  const buttonRollback=createButtonRollback({db,telegram,serial:messageSerial,assertCurrent});buttonRollback.recover();
  const mcpOAuth=new McpOAuth({...createOAuthRuntime({config}),onChanged:botId=>requestMcpRefresh(botId),notify:async(scope,text)=>{
    if(!lifecycle.closed&&!deleting.has(scope.botId)&&['admin','owner'].includes(db.role(scope.botId,scope.userId)))await telegram.call(scope.botId,'sendMessage',{chat_id:scope.chatId,text,reply_parameters:{message_id:scope.messageId}});
  },notifyOwner:async(botId,text)=>{const bot=db.getBot(botId);if(bot&&!lifecycle.closed&&!deleting.has(botId))await telegram.call(botId,'sendMessage',{chat_id:bot.ownerId,text});}});
  agent.onMcpStatus=(botId,rows)=>mcpOAuth.reportStatus(botId,createMcpStore(db).list(botId),rows);
  const loud = new Map(), historyGaps = new Set();
  const gapKey = (botId, chatId, topicId) => `${botId}:${chatId}:${topicId??0}`;
  const markGap = (botId, chatId, topicId) => { const chat=db.getChat(botId,chatId);if(chat)historyGaps.add(gapKey(botId,chatId,JSON.parse(chat.json).is_forum?(topicId??1):null)); };
  const clearChatActivity=(botId,chatId)=>{const prefix=`${botId}:${chatId}:`;for(const key of loud.keys())if(key.startsWith(prefix))loud.delete(key);for(const key of historyGaps)if(key.startsWith(prefix))historyGaps.delete(key);};
  const observeMode=(botId,chat)=>{
    const old=db.getChat(botId,chat.id);if(!old)return;
    const before=!!JSON.parse(old.json).is_forum,after=!!chat.is_forum;if(before===after)return;
    const prefix=`${botId}:${chat.id}:`,ordinary=gapKey(botId,chat.id),general=gapKey(botId,chat.id,1);
    if(after){if(loud.has(ordinary)){loud.set(general,loud.get(ordinary));loud.delete(ordinary);}if(historyGaps.delete(ordinary))historyGaps.add(general);}
    else{const gap=[...historyGaps].some(key=>key.startsWith(prefix));clearChatActivity(botId,chat.id);if(gap)historyGaps.add(ordinary);}
  };
  const addGapHint = (id, events) => { const scope=scopes.get(id);return events.map(event=>{if(!scope||event.ephemeralMessageId!==undefined||!['message','message_edited','button'].includes(event.eventType))return event;const chat=db.getChat(scope.botId,scope.chatId),topic=chat&&JSON.parse(chat.json).is_forum?(event.topicId??1):null;return historyGaps.delete(gapKey(scope.botId,scope.chatId,topic))?{...event,historyGap:true}:event;}); };
  const activeMessages = new Map();
  const unobserveChat=db.onChatObserved?.(observeMode);
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
  const ephemeralMessages=createEphemeralMessages({db,store:ephemeralStore,telegram,access,assertCurrent,uploads:async(scope,local)=>Object.entries(local??{}).map(([name,filename])=>({name,filename:path.basename(filename),bytes:filesFor(scope).read(filename)}))});
  const download = createDownload({ db, telegram, access, filesFor, getToken: telegram.getToken });
  const downloadCustomEmoji = createCustomEmojiDownload({ telegram, download, assertCurrent });
  const stickerSets = createStickerSets({ db, telegram, filesFor, assertCurrent });
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
    if(accessible&&db.getChat(scope.botId,chatId))db.saveChat(scope.botId,chat);
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
    if(name==='context_status'){assertCurrent(scope);if(Object.keys(args??{}).length)throw new Error('No arguments allowed.');return agent.context?.snapshot(scope.agentId)??{usedTokens:null,maxTokens:null,measuredAt:null};}
    if(name==='compact_context'){assertCurrent(scope);if(Object.keys(args??{}).some(k=>k!=='continuation'))throw new Error('Invalid compact arguments.');return control.requestCompact(scope,{kind:'agent',...args});}
    if(control?.suspended(scope)&&!['time','read','history','search','context_status'].includes(name))throw Object.assign(new Error('Compaction accepted. Finish this turn.'),{code:'finish_turn'});
    assertCurrent(scope);
    if (deleting.has(scope.botId)) throw new Error('Bot is being deleted.');
    if (db.getChat(scope.botId, scope.chatId)?.chatType === 'private' && !db.role(scope.botId, scope.chatId)) throw new Error('Private user is no longer authorized');
    if(name==='set_inline_results')return inline.setResults(scope,args);
    if(args.ephemeralMessageId!==undefined){
      if(!['read','edit','delete'].includes(name))throw Object.assign(new Error('This tool does not support ephemeral addresses.'),{code:'invalid_argument'});
      return ephemeralMessages[name](scope,args);
    }
    if(name==='send'&&(args.ephemeral_message_parameters!==undefined||args.reply_parameters?.ephemeral_message_id!==undefined))return ephemeralMessages.send(scope,args);
    if(name==='read'&&args.guestRequestId!==undefined)return guest.read(scope,args);
    if(name==='send'&&args.guestRequestId!==undefined)return guest.send(scope,args);
    if(name==='read'&&args.inlineMessageId!==undefined)return inlineMessages.read(scope,args);
    if(name==='read'&&(!Array.isArray(args.messageIds)||args.messageIds.some(id=>!Number.isSafeInteger(id)||id<=0)))throw Object.assign(new Error('Use messageIds as an array of positive integers, or inlineMessageId alone.'),{code:'invalid_argument'});
    if(name==='edit'&&args.inlineMessageId!==undefined)return inlineMessages.edit(scope,args);
    if(['create_widget','update_widget','set_widget_view','delete_widget_view','delete_widget','list_widgets','get_widget','widget_event'].includes(name)){
      if(!widgets)throw new Error('Widget storage is not configured.');
      if(name==='list_widgets')return widgets.list(scope);if(name==='get_widget')return widgets.get(scope,args);
      if(name==='create_widget')return widgets.create(scope,args);if(name==='update_widget')return widgets.update(scope,args);if(name==='set_widget_view')return widgets.setView(scope,args);
      if(name==='delete_widget_view'){await widgets.deleteView(scope,args);return {};}if(name==='delete_widget'){await widgets.delete(scope,args);return {};}
      await widgets.event(scope,args);return {};
    }
    if (name === 'rich_help') return richHelp();
    if (name === 'time') return { now: new Date().toISOString() };
    if (name === 'user_roles') {
      if (!Array.isArray(args.userIds) || args.userIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
        throw Object.assign(new Error('userIds must be an array of positive safe integers.'), { code: 'invalid_argument' });
      }
      return { users: args.userIds.map(userId => ({ userId, role: db.role(scope.botId, userId) })) };
    }
    if (name === 'browser_read') return browserRead(args, { files: filesFor(scope) });
    if (name === 'pdf_read') return pdfRead(filesFor(scope), args);
    if (name === 'schedule') return scheduler.schedule(scope, args);
    if (name === 'tasks') return scheduler.list(scope, args.taskIds);
    if (name === 'cancel_tasks') return scheduler.cancel(scope, args.taskIds);
    if (name === 'vault_get') return createVault(db).get(scope.botId, args.name);
    if (name === 'git_changes' || name === 'git_sync') { const settings = db.sql.prepare('SELECT * FROM git_settings WHERE botId=?').get(scope.botId); const options = { configured: Boolean(settings), root: path.join(config.botsDir, scope.botId), branch: settings?.branch, env: gitAuth(settings?.secretRef) }; return name === 'git_changes' ? gitChanges(options) : gitSync(options, args.message); }
    if (name.startsWith('ws_')) { if(!config?.botsDir) throw new Error('File storage is not configured'); const method=name.slice(3); if(!['open','list','pull','send','close','delete'].includes(method)) throw new Error('Unknown WebSocket tool'); const result=await websockets[method](scope, ['close','delete'].includes(method)?args.connectionId:args); assertCurrent(scope); return result; }
    if (name === 'download') return download(scope, args);
    if (name === 'download_custom_emoji') return downloadCustomEmoji(scope, args);
    if (['sticker_sets','sticker_set_get','sticker_set_create','sticker_set_edit','sticker_set_delete'].includes(name)) return stickerSets(scope, name, args);
    if (name === 'save_image') return filesFor(scope).saveImage(scope.threadId, args.savedPath, args.dir);
    if (['read', 'history', 'search'].includes(name)) {const result=history[name](scope,args);if(name==='read'&&widgets)result.messages=result.messages.map((m,i)=>m.error==='message_not_found'?readableDates(widgets.store.byMessage(scope.botId,args.chatId??scope.chatId,args.messageIds[i])?.view?.message??m):m);return result;}
    if(name==='topics'){const chatId=args.chatId??scope.chatId;access.assertRead(scope,chatId);return createTopicStore(db).list(scope.botId,chatId);}
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
    if (name === 'send' || name === 'edit') {const owned=name==='edit'&&widgets?.store.byMessage(scope.botId,args.chatId??scope.chatId,args.messageId);if(owned)throw Object.assign(new Error('Use widget_event, update_widget or set_widget_view for an owned widget message.'),{code:'widget_owned',ownerAgentId:owned.agentId,widgetId:owned.widgetId,viewId:owned.view.id});return name==='edit'?messageSerial.run({botId:scope.botId,chatId:args.chatId??scope.chatId,messageId:args.messageId},async()=>{const result=await messages.edit(scope,args);if(result.unknown?.length)buttonRollback.invalidate({botId:scope.botId,chatId:args.chatId??scope.chatId,messageId:args.messageId});return result;}):messages.send(scope,args);}
    if (name === 'forward' || name === 'copy') return messages.transfer(scope, name, args);
    if (['delete', 'pin', 'unpin', 'react'].includes(name)) {
      const target = args.chatId ?? scope.chatId; if (name === 'delete' && target !== scope.chatId) throw new Error('Deletion is allowed only in the current chat.'); if (isStopping(scope.botId, target)) throw new Error('Target chat is stopping.'); access.assertWrite(scope, target); assertCurrent(scope);
      const method = { delete: 'deleteMessage', pin: 'pinChatMessage', unpin: 'unpinChatMessage', react: 'setMessageReaction' }[name];
      await telegram.call(scope.botId, method, { chat_id: target, message_id: args.messageId, ...(name === 'react' ? { reaction: args.reaction } : {}) });
      if (name === 'react') {
        const event={chat:{id:target},message_id:args.messageId,date:clock()/1000};
        recordReaction(db,scope.botId,event,args.reaction);
        const w=widgets?.store.byMessage(scope.botId,target,args.messageId);
        if(w){const message=projectReaction(structuredClone(w.view.message),event,args.reaction);if(message)widgets.store.patchView(w,w.view.id,{message});}
      }
      if (name === 'delete') {const w=widgets?.store.byMessage(scope.botId,target,args.messageId);if(w)await widgets.deleteView(w,{viewId:w.view.id});db.sql.prepare('DELETE FROM messages WHERE botId=? AND chatId=? AND messageId=?').run(scope.botId, target, args.messageId);}
      return { status: 'done' };
    }
    throw new Error('Unknown or invalid tool');
  };
  const invokeRaw = (scope, name, args) => ['create_widget','update_widget','set_widget_view','delete_widget_view','delete_widget'].includes(name)?invokeTool(scope,name,args):gate.run(scope.botId, () => invokeTool(scope, name, args), scope.agentId).finally(()=>{control?.kick(scope.agentId);});
  const invoke=(scope,name,args)=>{
    const target=name==='set_widget_view'?args.target:name==='delete'&&args.messageId!==undefined?{chatId:args.chatId??scope.chatId,messageId:args.messageId}:null;
    if(!target?.messageId)return invokeRaw(scope,name,args);
    const address={botId:scope.botId,chatId:target.chatId??scope.chatId,messageId:target.messageId};
    return messageSerial.run(address,async()=>{try{const result=await invokeRaw(scope,name,args);if(name==='set_widget_view')buttonRollback.invalidate(address);return result;}catch(e){if(name==='set_widget_view'&&!e.noEffect)buttonRollback.invalidate(address);throw e;}});
  };
  const scheduled = new Map();
  const trackConsumed = (id, events) => { if (!consumed.has(id)) consumed.set(id, new Map()); const count = consumed.get(id); for (const e of events) if (e.eventType === 'agent_message') count.set(e.from.agentId, (count.get(e.from.agentId) ?? 0) + 1); };
  const prepare = (id, events) => addGapHint(id, events.map(e => { if (e.eventType !== 'scheduled') { if (e.eventType === 'message' || e.eventType === 'message_edited') { if (!activeMessages.has(id)) activeMessages.set(id, { messages: new Set(), edits: new Set() }); if(e.ephemeralMessageId!==undefined)activeMessages.get(id).private=true;else activeMessages.get(id).messages.add(e.messageId); if (e.eventType === 'message_edited') activeMessages.get(id).edits.add(e.messageId); } return e; } const full = scheduler.take(e.taskId); if (full) { if (!scheduled.has(id)) scheduled.set(id, new Set()); scheduled.get(id).add(e.taskId); } return full; }).filter(Boolean));
  const releaseOrigins = (id, count) => {
    const outstanding = requests.get(id);
    for (const [sender, n] of count ?? []) { const remaining = (outstanding?.get(sender) ?? 0) - n; if (remaining > 0) outstanding.set(sender, remaining); else outstanding?.delete(sender); }
  };
  const completeScheduled = (id, success) => { const ids = [...(scheduled.get(id) ?? [])]; scheduled.delete(id); for (const taskId of ids) scheduler.complete(taskId, success); };
  const eventCurrent=(scope,event)=>event.eventType==='guest_message'?Boolean(guestEvents?.isCurrent(scope,event.guestRequestId)):event.eventType!=='inline'||inlineRequests.get(event.requestId)?.agentId===scope.agentId&&Boolean(resolveInlineOwner(scope.botId,scope.agentId));
  const queue = new AgentQueue({
    onStateChanged:id=>{updateAction(id);control?.kick(id);},
    onAdmitted:(id,item)=>control?.admitted(id,item),
    onDropped:(id,events,source)=>{const scope=scopes.get(id);if(scope&&source==='chat')for(const event of [events].flat())if(['message','message_edited'].includes(event.eventType)&&event.ephemeralMessageId===undefined)markGap(scope.botId,scope.chatId,event.topicId);},
    onEvicted:(id,events,source,meta)=>{const scope=scopes.get(id);if(!scope)return;for(const event of [events].flat()){
      if(event.ephemeralMessageId!==undefined&&sayEvents)queue.track(sayEvents.evicted(lifecycle.scope(scope),event),id);
      else if(['message','message_edited'].includes(event.eventType))markGap(scope.botId,scope.chatId,event.topicId);
      else if(event.eventType==='button')queue.track(buttonRollback.restore(meta.id),id);
    }},
    onDispatched:(_id,item)=>buttonRollback.handled(item.id),
    dispatch:async(id,events)=>{
      let scope=lifecycle.scope(scopes.get(id));scopes.set(id,scope);
      const record=db.agent(scope.botId,scope.chatId);
      if(record.threadId&&record.threadRulesVersion!==db.getBot(scope.botId).rulesVersion){await agent.waitBackground?.(id).catch(()=>{});control.invalidate(id,'rules');lifecycle.invalidate(id);db.sql.prepare('UPDATE agents SET threadId=NULL,threadRulesVersion=NULL WHERE agentId=?').run(id);await agent.deleteSession?.(id,record.threadId);scope=lifecycle.scope(record);scopes.set(id,scope);}
      events=events.filter(e=>eventCurrent(scope,e));const batch=prepare(id,events);if(!batch.length)return;
      const unit=control.beforeWork(scope,batch);scope={...scope,workId:unit.workId};
      try{
        const result=await agent.run(scope,unit.events,(name,args,threadId)=>invoke({...scope,threadId},name,args),{workId:unit.workId});
        const privateOrigin=!!activeMessages.get(id)?.private;
        const settlement=control.afterWork(unit.workId,{settled:Promise.resolve(result?.settled).then(()=>{try{assertCurrent(scope);}catch{throw Object.assign(new Error('Work scope retired.'),{code:'rules_replaced'});}})});
        queue.track(settlement.catch(error=>queue.onError(id,error,privateOrigin)),id);
      }catch(error){
        const cancelled=['cancelling','paused','unknown'].includes(control.status(id).phase)||error.code==='agent_cancelled';
        await control.afterWork(unit.workId,{outcome:cancelled?'cancelled':'failed'});
        if(cancelled)throw Object.assign(new Error('Work cancelled.'),{code:'agent_cancelled'});error.privateOrigin=!!activeMessages.get(id)?.private;throw error;
      }finally{scheduled.delete(id);consumed.delete(id);activeMessages.delete(id);}
    },
    steer:(id,events)=>{if(agent.canSteer&&!agent.canSteer(id))throw Object.assign(new Error('The root turn has already finished.'),{code:'steer_expired'});const scope=scopes.get(id),batch=prepare(id,events);if(!batch.length)return;control.beforeWork(scope,batch,{activeWorkId:control.activeWork(id)});return agent.steer(id,batch);},
    onError:async(id,error,privateOrigin=false)=>{
      privateOrigin ||= !!error.privateOrigin;
      if(error.code==='agent_cancelled'||['cancelling','paused','unknown'].includes(control?.status(id).phase))return;
      if(lifecycle.closed||deleting.has(scopes.get(id)?.botId)||isStopping(scopes.get(id)?.botId,scopes.get(id)?.chatId))return;
      completeScheduled(id,false);const privateFailure=privateOrigin||!!activeMessages.get(id)?.private;activeMessages.delete(id);
      if(error.code==='rules_replaced')return;scheduler.failQueued(id);
      if(actions.has(id))clearInterval(actions.get(id).timer);actions.delete(id);availability.delete(id);images.delete(id);agent.detach?.(id);
      for(const sender of requests.get(id)?.keys()??[]){const a=db.sql.prepare('SELECT * FROM agents WHERE agentId=?').get(sender);if(!a)continue;scopes.set(sender,lifecycle.scope(a));queue.enqueue(sender,{eventType:'agent_error',agentId:id,error:'agent_failed',description:'The target agent failed while processing messages. Your request may not have been completed.'},'agent');}
      requests.delete(id);consumed.delete(id);const scope=scopes.get(id);lifecycle.invalidate(id);onError(error);
      if(!privateFailure)try{await telegram.call(scope.botId,'sendMessage',{chat_id:scope.chatId,text:`Agent ${id} failed. Queue cleared.`});}catch{}
    }
  });
  const scheduler = new Scheduler({ db, clock, enqueue: (id, event) => { const target = db.sql.prepare('SELECT * FROM agents WHERE agentId=?').get(id); if (!target || !db.getChat(target.botId,target.chatId)?.agentEnabled || isStopping(target.botId, target.chatId)) return; scopes.set(id, lifecycle.scope({ botId: target.botId, chatId: target.chatId, agentId: id })); if (gate.held.has(target.botId)) queue.setPaused(id, true); queue.enqueue(id,event,'schedule',undefined,{recovery:scheduler.recovering}); }, notify: async (task, description) => { const a = db.sql.prepare('SELECT * FROM agents WHERE agentId=?').get(task.agentId); if (!a) return; try { await telegram.call(a.botId, 'sendMessage', { chat_id: a.chatId, text: [`Ошибка задачи ${task.taskId}; агент ${a.agentId}.`, task.description, task.at ?? `${task.cron} (${task.timezone})`, (() => { const pending = db.sql.prepare("SELECT * FROM task_firings WHERE taskId=? AND state='pending'").get(task.taskId); return pending ? `Пропущено ${pending.count} срабатываний с ${new Date(pending.firstAt).toISOString()}` : ''; })(), description, `/task retry ${task.taskId}`, `/task delete ${task.taskId}`].filter(Boolean).join('\n').slice(0, 4000) }); } catch {} } });
  // Cancel fences compute work; queued admissions and persistent resources retain their lifecycle.
  control=createAgentControl({db,queue,agent,clock,idleEffects:id=>gate.idleScope(id),effectsActive:id=>!!gate.scoped.get(id)?.size,
    notify:async(op,text)=>{if(op.replyTarget){const replyId=op.replyTarget.replyId,prior=replyId&&control.store.reply(replyId);if(prior&&prior.phase!=='prepared')return;if(replyId)control.store.updateReply(replyId,'updating');try{await updateControlReply({telegram,db},op.replyTarget,text);if(replyId)control.store.updateReply(replyId,'done');}catch{if(replyId)control.store.updateReply(replyId,'unknown');}}},
    onResume:(id,op)=>{const a=db.sql.prepare('SELECT * FROM agents WHERE agentId=?').get(id);if(!a)return;scopes.set(id,lifecycle.scope(a));queue.enqueue(id,{eventType:'context_status',_compactOperation:op.operationId},'control',()=>control.store.operation(op.operationId)?.continuationPhase==='pending');},
    settle:(unit,outcome)=>{
      const counts=new Map();for(const origin of unit.origins){if(origin.taskId){if(outcome==='cancelled')scheduler.interrupt(origin.taskId);else scheduler.complete(origin.taskId,outcome==='completed');}if(origin.senderId)counts.set(origin.senderId,(counts.get(origin.senderId)??0)+1);}
      if(outcome!=='failed')releaseOrigins(unit.agentId,counts);
      if(outcome==='cancelled')for(const sender of counts.keys()){const a=db.sql.prepare('SELECT * FROM agents WHERE agentId=?').get(sender);if(a){scopes.set(sender,lifecycle.scope(a));queue.enqueue(sender,{eventType:'agent_error',agentId:unit.agentId,error:'agent_cancelled',description:'The target work was cancelled. Earlier effects may have completed.'},'agent');}}
    }
  });
  agent.onTurnBound=(id,workId,identity)=>control.bound(id,workId,identity);
  const updateAction = id => {
    const action = queue.canStart(id) ? null : images.get(id)?.size ? 'upload_photo' : 'typing';
    const scope = scopes.get(id), previous = actions.get(id);
    let current = false;
    try { if (scope) { assertCurrent(scope); current = Boolean(db.getChat(scope.botId,scope.chatId)?.agentEnabled)&&!['paused','unknown'].includes(control?.status(id).phase); } } catch {}
    if (current && action && previous?.action === action && previous.scope.botId === scope.botId && previous.scope.chatId === scope.chatId && previous.scope.generation === scope.generation) return;
    if (previous) clearInterval(previous.timer); actions.delete(id);
    if (!action || !current) return;
    const sendAction = async () => { try { assertCurrent(scope); await telegram.call(scope.botId, 'sendChatAction', { chat_id: scope.chatId, action }); } catch {} };
    sendAction(); const timer = setInterval(sendAction, 4000); timer.unref(); actions.set(id, {timer,action,scope});
  };
  agent.onAvailability = (id, status) => { availability.set(id, status); queue.setWaiting(id, status === 'waiting'); };
  agent.onImageStatus = (id, image, active) => { if (!images.has(id)) images.set(id, new Set()); active ? images.get(id).add(image) : images.get(id).delete(image); updateAction(id); };
  agent.assertCurrent = scope => assertCurrent(scope);
  agent.filterEvents=(scope,events)=>events.filter(event=>eventCurrent(scope,event));
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
    const m = list[0], key = gapKey(botId,m.chat.id,topicIdOf(m));
    if (m.chat.type !== 'private') { if (trigger) loud.set(key, { until: clock() + 120000, remaining: 10 }); else if (!activatedAlbum) { const listen = loud.get(key); if (!listen || listen.until <= clock() || listen.remaining <= 0) { markGap(botId, m.chat.id,topicIdOf(m)); return false; } listen.remaining--; } }
    const a = db.ensureAgent(botId, m.chat.id); scopes.set(a.agentId, lifecycle.scope({ botId, chatId: m.chat.id, agentId: a.agentId }));
    if (gate.held.has(botId)) queue.setPaused(a.agentId, true);
    const deadline = m.chat.type !== 'private' && !trigger && !activatedAlbum ? loud.get(key)?.until : null;
    const events=list.map(message=>({...shortMessage(message),...(triggersById.get(message.message_id)?.length?{triggers:triggersById.get(message.message_id)}:{})}));
    const accepted = queue.enqueue(a.agentId, list.length === 1 ? events[0] : events, 'chat', deadline !== null ? () => clock() < deadline : undefined) === 'accepted';
    if (!accepted) markGap(botId, m.chat.id,topicIdOf(m));
    return accepted;
  };
  const albums = new AlbumCollector({ clock, onReady: (messages, trigger, active) => deliver(messages[0].__botId, messages, trigger, active) });
  const stopAgent = async (botId, chatId, { leave = true } = {}) => {
    const key = `${botId}:${chatId}`; if (stopping.has(key)) throw new Error("Chat is already stopping.");
    const a = db.agent(botId, chatId), chat = db.getChat(botId, chatId); if (!chat) return;
    if(a){control.invalidate(a.agentId,'delete');}if(a)inline?.disableOwner(botId,a.agentId,'agent_removed');
    stopping.add(key); albums.clearChat(botId,chatId);
    try {
    await widgets?.removeChat(botId,chatId);
    if (a) {
      await widgets?.removeOwner(a);
      websockets.deleteAgent(a.agentId);
      queue.setPaused(a.agentId, true); lifecycle.invalidate(a.agentId); queue.clear(a.agentId);
      for (const t of scheduler.list(a).tasks) scheduler.cancel(a, [t.taskId]);
      if (actions.has(a.agentId)) clearInterval(actions.get(a.agentId).timer); actions.delete(a.agentId); availability.delete(a.agentId); images.delete(a.agentId);
      await agent.deleteSession?.(a.agentId, a.threadId); websockets.closeAgent(a.agentId,'context_reset');
      await gate.idleScope(a.agentId); await queue.idleAgent(a.agentId);
      db.sql.prepare('DELETE FROM agent_messages WHERE botId=? AND (fromAgentId=? OR toAgentId=?)').run(botId, a.agentId, a.agentId);
      if (config?.botsDir && fs.existsSync(path.join(config.botsDir, botId, '.temp', a.agentId))) new BotFiles(path.join(config.botsDir, botId), a.agentId).remove(`.temp/${a.agentId}`);
      stores.delete(a.agentId); requests.delete(a.agentId); consumed.delete(a.agentId); activeMessages.delete(a.agentId);
    }
    clearChatActivity(botId,chatId);albums.clearChat(botId,chatId);
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
      await queue.idleAgent(id);await control.idleAgent(id);
      await agent.waitBackground?.(id).catch(() => {});
      await gate.idleScope(id);
      if (lifecycle.closed || isStopping(record.botId, record.chatId) || deleting.has(record.botId)) return;
      await gate.run(record.botId, async () => {
        const current = db.sql.prepare('SELECT * FROM agents WHERE agentId=?').get(id);
        if (!current?.contextResetPending || lifecycle.closed || isStopping(record.botId, record.chatId)) return;
        lifecycle.invalidate(id);
        websockets.closeAgent(id,'context_reset');
        await agent.deleteSession?.(id, current.threadId);control.retired(id);
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
    if (!records.length) throw Object.assign(new Error('Agent not found.'), {safe:true});
    if (gate.held.has(botId) || deleting.has(botId) || records.some(a => isStopping(botId,a.chatId))) throw Object.assign(new Error('Bot maintenance or agent shutdown is in progress. Try again later.'), {safe:true});
    const items = records.map(a => {
      const busy = Boolean(queue.agentJobs.get(a.agentId)?.size || agent.hasBackground?.(a.agentId) || resets.has(a.agentId));
      control.invalidate(a.agentId,'clear');db.sql.prepare('UPDATE agents SET contextResetPending=1 WHERE agentId=?').run(a.agentId);
      return {a,busy,work:resetContext(a)};
    });
    await Promise.all(items.filter(x=>!x.busy).map(x=>x.work));
    return items.map(({a,busy}) => `${busy ? 'Context reset scheduled after current work' : db.sql.prepare('SELECT contextResetPending FROM agents WHERE agentId=?').get(a.agentId)?.contextResetPending ? 'Context reset failed; retry the command' : 'Context cleared'}: ${a.agentId}`).join('\n');
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
    if(enabled && chat.chatType==='channel')throw new Error('This chat does not support an agent.');
    let a=db.agent(botId,chatId);
    if(enabled){if(a?.stopPending)throw new Error('Agent is stopping. Retry after completion.');if(chat.agentEnabled){return a&&control.start(a)?'Queue resumed':'Already enabled';}db.sql.prepare('UPDATE chats SET agentEnabled=1 WHERE botId=? AND chatId=?').run(botId,chatId);a=db.ensureAgent(botId,chatId);control.start(a);scopes.set(a.agentId,lifecycle.scope({botId,chatId,agentId:a.agentId}));queue.setHeld(a.agentId,'disabled',false);return `Agent enabled. Missed tasks: ${scheduler.resume(a.agentId)}`;}
    if(!chat.agentEnabled && !a?.stopPending)return 'Already disabled';
    if(a){control.invalidate(a.agentId,'stop');inline?.disableOwner(botId,a.agentId,'agent_disabled');await widgets?.disableOwner(a,'agent_disabled');}
    db.sql.prepare('UPDATE chats SET agentEnabled=0 WHERE botId=? AND chatId=?').run(botId,chatId);clearChatActivity(botId,chatId);albums.clearChat(botId,chatId);
    if(a){db.sql.prepare('UPDATE agents SET stopPending=1,contextResetPending=1 WHERE agentId=?').run(a.agentId);queue.setHeld(a.agentId,'disabled',true);scheduler.disable(a.agentId);queue.clear(a.agentId);const busy=Boolean(queue.agentJobs.get(a.agentId)?.size || agent.hasBackground?.(a.agentId));const work=finishStop(a);if(!busy)await work;}
    return a && db.agent(botId,chatId)?.stopPending ? 'Agent is stopping' : 'Agent disabled';
  };
  const fileAbort=new AbortController();
  const fetchDocument=createDocumentFetcher({telegram,signal:fileSignal?AbortSignal.any([fileSignal,fileAbort.signal]):fileAbort.signal});
  const browse=createBrowse({db,config,telegram,fetchDocument,now:clock,onError,run:(botId,fn)=>gate.run(botId,fn)});
  const updateRules = async (botId, document, force) => {
    const bytes = typeof document.text === 'string' ? Buffer.from(document.text, 'utf8') : await fetchDocument(botId, document); new TextDecoder('utf8', { fatal: true }).decode(bytes);
    const rulesDir = path.join(config.dataDir, 'rules', botId); fs.mkdirSync(rulesDir, { recursive: true }); fs.writeFileSync(path.join(rulesDir, 'AGENTS.md'), bytes);
    db.sql.prepare('UPDATE bots SET rulesVersion=rulesVersion+1 WHERE botId=?').run(botId);
    for (const a of db.sql.prepare('SELECT * FROM agents WHERE botId=?').all(botId)) {
      control.invalidate(a.agentId,'rules');
      if (!force && (queue.state(a.agentId).busy || agent.hasBackground?.(a.agentId))) continue;
      await control.idleAgent(a.agentId);lifecycle.invalidate(a.agentId); db.sql.prepare('UPDATE agents SET threadId=NULL,threadRulesVersion=NULL WHERE agentId=?').run(a.agentId); await agent.deleteSession?.(a.agentId, a.threadId);control.retired(a.agentId);websockets.closeAgent(a.agentId,'context_reset');
    }
  };
  const masterCommands = config ? createMaster({ db, config,
    onBotAdded: id => { deleting.delete(id); mcpOAuth.allowBot(id); gate.held.delete(id); config.onBotAdded?.(id); },
    onBotRemoved: async id => {
      commands.close(id);
      browse.close(id);
      inlineAvatars.forget(id);
      for(const a of db.sql.prepare('SELECT agentId FROM agents WHERE botId=?').all(id))inline?.disableOwner(id,a.agentId,'bot_removed');
      for(const a of db.sql.prepare('SELECT * FROM agents WHERE botId=?').all(id))await widgets?.removeOwner(a);
      await mcpOAuth.deleteBot(id,()=>createMcpStore(db).list(id));
      deleting.add(id); websockets.deleteBot(id);
      for (const a of db.sql.prepare('SELECT * FROM agents WHERE botId=?').all(id)) { control.invalidate(a.agentId,'delete');queue.setPaused(a.agentId, true); lifecycle.invalidate(a.agentId); agent.detach?.(a.agentId); }
      await config.onBotRemoved?.(id);
      await pauseBot(id);
      for (const a of db.sql.prepare('SELECT * FROM agents WHERE botId=?').all(id)) {
        queue.clear(a.agentId); scheduler.cancel(a, scheduler.list(a).tasks.map(t => t.taskId));
        if (actions.has(a.agentId)) clearInterval(actions.get(a.agentId).timer); actions.delete(a.agentId);
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
  guest=createGuestService({db,access,store:guestStore,inlineStore,telegram,assertCurrent,now:clock,onError,
    receipts:createGuestReceipts({directory:config?.dataDir?path.join(config.dataDir,'guest-publications'):undefined,now:clock}),
    resolveActor:(botId,userId)=>{const a=db.agent(botId,userId);return a?resolveInlineOwner(botId,a.agentId):null;},
    isKnownMember:(botId,chat)=>chat.type!=='private'&&Boolean(db.getChat(botId,chat.id))});
  widgets=widgetService??(config?.dataDir&&config?.botsDir?createWidgetService({db,config,telegram,invoke,filesFor,inlineStore,guest,notify:async(owner,event)=>{const a=db.sql.prepare('SELECT * FROM agents WHERE botId=? AND agentId=?').get(owner.botId,owner.agentId);if(!a||!db.getChat(a.botId,a.chatId)?.agentEnabled||lifecycle.closed)return;scopes.set(a.agentId,lifecycle.scope(a));queue.enqueue(a.agentId,event,'widget');},isUnavailable:(botId,agentId)=>lifecycle.closed||deleting.has(botId)||isStopping(botId,db.sql.prepare('SELECT chatId FROM agents WHERE agentId=?').get(agentId)?.chatId)}):null);
  if(widgets)widgetEvents=createWidgetEvents({db,manager:widgets,telegram});
  function resolveInlineOwner(botId,agentId) {
    const a=db.sql.prepare('SELECT * FROM agents WHERE botId=? AND agentId=?').get(botId,agentId),chat=a&&db.getChat(botId,a.chatId);
    if(!a||!chat||chat.chatType!=='private'||!chat.agentEnabled||a.stopPending||!db.role(botId,a.chatId)||deleting.has(botId)||isStopping(botId,a.chatId)||lifecycle.closed)return null;
    const scope=lifecycle.scope(a);scopes.set(a.agentId,scope);return scope;
  }
  inline=createInlineService({requests:inlineRequests,clock:{now:clock,setTimeout,clearTimeout},
    getPromptPhoto:botId=>inlineAvatars.get(botId),
    resolveActor:(botId,userId)=>{if(botId==='master')return null;const a=db.agent(botId,userId);return a?resolveInlineOwner(botId,a.agentId):null;},
    enqueue:(scope,event,admit)=>{scopes.set(scope.agentId,lifecycle.scope(scope));if(gate.held.has(scope.botId))queue.setPaused(scope.agentId,true);return queue.enqueue(scope.agentId,event,'inline',admit);},
    cancelPending:requestId=>{for(const id of queue.states.keys())queue.cancelWhere(id,event=>event.eventType==='inline'&&event.requestId===requestId);},
    normalizeResults:(scope,results)=>normalizeInlineResults(scope,results,{db,access}),registerPage:(scope,page)=>inlineStore.registerPage(scope,page),
    answer:(botId,body)=>telegram.call(botId,'answerInlineQuery',body)});
  inlineMessages=createInlineMessages({db,store:inlineStore,access,telegram,assertCurrent,withTarget:widgets?widgets.withTarget:undefined});
  inlineEvents=createInlineEvents({store:inlineStore,widgets,queue,resolveOwner:resolveInlineOwner,telegram,onError});
  guestEvents=createGuestEvents({store:guestStore,getBot:id=>db.getBot(id),
    resolveActor:(botId,userId)=>{const a=db.agent(botId,userId);return a?resolveInlineOwner(botId,a.agentId):null;},
    isKnownMember:(botId,chat)=>chat.type!=='private'&&Boolean(db.getChat(botId,chat.id)),
    enqueue:(scope,event,admit)=>{scopes.set(scope.agentId,lifecycle.scope(scope));if(gate.held.has(scope.botId))queue.setPaused(scope.agentId,true);return queue.enqueue(scope.agentId,event,'guest',admit);}});
  const widgetReady=guest.recover().catch(onError).then(()=>widgets?.recover().catch(onError)).then(()=>inlineEvents.drain());
  sayEvents=createSayEvents({db,store:ephemeralStore,messages:ephemeralMessages,telegram,queue,assertCurrent,onError,isUnavailable:(botId,chatId)=>lifecycle.closed||deleting.has(botId)||isStopping(botId,chatId),resolveScope:record=>{const scope=lifecycle.scope(record);scopes.set(record.agentId,scope);if(gate.held.has(record.botId))queue.setPaused(record.agentId,true);return scope;}});
  const commands = createCommands({ db, config: config ?? {}, telegram, clock, onError, browse, say:(botId,message)=>sayEvents.receive(botId,message), scheduler, agentControl:control,controlReply:(target,text)=>control.reply(target,text),contextStatus:id=>agent.context?.snapshot(id)??{usedTokens:null,maxTokens:null,measuredAt:null},stopAgent, setAgentState, agentStatus: id => ({status:db.sql.prepare('SELECT stopPending FROM agents WHERE agentId=?').get(id)?.stopPending ? 'stopping' : (control.status(id).phase!=='running'&&control.status(id).phase?control.status(id).phase:availability.get(id)??'idle'),queue:queue.state(id).events.length}), updateRules, clearContext, models: () => agent.models(), websockets,widgets,mcpOAuth, requestMcpRefresh, testMcp:(botId,entry)=>agent.testMcp(botId,entry), masterCommands, fileCommands });
  for (const record of db.sql.prepare('SELECT * FROM agents').all()) {if(!db.getChat(record.botId,record.chatId).agentEnabled)queue.setHeld(record.agentId,'disabled',true);if(record.stopPending)finishStop(record);else if(record.contextResetPending)resetContext(record);}
  const ready=control.recover().then(()=>widgetReady);
  return {
    control,queue, lifecycle, invoke, scheduler, stopAgent, websockets,widgets,inline:{service:inline,requests:inlineRequests,store:inlineStore,events:inlineEvents},guest:{service:guest,store:guestStore,events:guestEvents},ready,
    async receive(botId, update) {
      await ready;
      if(update.guest_message){guestEvents.receive(botId,update);return;}
      if(update.inline_query){if(botId!=='master')inline.receive(botId,update.inline_query);return;}
      const route = update.message?.chat?.id ?? update.edited_message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? update.my_chat_member?.chat?.id;
      if (isStopping(botId, route)) { if (update.callback_query) await telegram.call(botId, "answerCallbackQuery", { callback_query_id: update.callback_query.id, text: "Бот занят" }); return; }
      if (deleting.has(botId)) return;
      const observedChat=update.message?.chat??update.edited_message?.chat??update.channel_post?.chat??update.edited_channel_post?.chat;
      if(botId!=='master'&&observedChat&&db.getChat(botId,observedChat.id))db.saveChat(botId,observedChat);
      const commandMessage = update.message;
      const privateRoute=m=>isEphemeral(m)||isEphemeral(m?.reply_to_message);
      if(privateRoute(update.edited_message)||privateRoute(update.edited_channel_post))return;
      if(update.edited_message&&isMcpAuthReply(update.edited_message,mcpOAuth,botId)){await commands.handle(botId,update.edited_message);return;}
      if (commandMessage && await commands.handle(botId, commandMessage)) return;
      if(update.callback_query&&await browse.callback(botId,update.callback_query))return;
      if(privateRoute(commandMessage)||privateRoute(update.channel_post))return;
      if(privateRoute(update.callback_query?.message)){await telegram.call(botId,'answerCallbackQuery',{callback_query_id:update.callback_query.id,text:'Ephemeral agent and widget callbacks are not supported yet.'}).catch(()=>{});return;}
      if (botId === 'master') return;
      if(update.callback_query?.inline_message_id&&guest.hasPending(botId)){
        await telegram.call(botId,'answerCallbackQuery',{callback_query_id:update.callback_query.id}).catch(()=>{});
        await guest.waitRegistrations(botId,update.callback_query.inline_message_id,update.callback_query.data);
      }
      if(widgetEvents&&(update.callback_query||update.poll||update.poll_answer||update.message_reaction||update.message_reaction_count)&&await widgetEvents(botId,update))return;
      if(update.callback_query?.inline_message_id&&await inlineEvents.receive(botId,update.callback_query))return;
      const reaction = update.message_reaction ?? update.message_reaction_count;
      if (reaction) { recordReaction(db, botId, reaction); return; }
      if (update.callback_query) {
        const cb = update.callback_query, m = cb.message;
        const ack = text => telegram.call(botId, 'answerCallbackQuery', { callback_query_id: cb.id, ...(text ? { text, show_alert: true } : {}) });
        if (!m || !db.getChat(botId, m.chat.id) || m.chat.type === 'channel' || m.chat.type === 'private' && !db.role(botId, cb.from.id)) { await ack('Кнопка недоступна'); return; }
        const stored = db.getMessage(botId, m.chat.id, m.message_id), a = db.agent(botId, m.chat.id);
        const storedTopic=db.messageRecord(botId,m.chat.id,m.message_id)?.topicId;
        const isForum=!!JSON.parse(db.getChat(botId,m.chat.id).json).is_forum;
        const buttonTopic=storedTopic??(isForum?1:null);
        const button = buttons({ rich: stored?.rich_message, keyboard: stored?.reply_markup }).find(b => b.callback_data === cb.data);
        if (!button || button.disabled || !a || !db.getChat(botId,m.chat.id)?.agentEnabled) { await ack('Кнопка недоступна'); return; }
        const state = db.sql.prepare('SELECT * FROM button_state WHERE botId=? AND chatId=? AND messageId=?').get(botId, m.chat.id, m.message_id);
        if (m.chat.type !== 'private' && !permitsAllow(state?.permits ? JSON.parse(state.permits) : null, cb.data, cb.from.id)) { await ack('Нет доступа'); return; }
        let parsed; try { parsed = parseCallback(cb.data); } catch { await ack('Кнопка недоступна'); return; }
        const closed = JSON.parse(state?.closed ?? '[]');
        if (parsed.group && closed.includes(parsed.group)) { await ack('Выбор уже сделан'); return; }
        if (!queue.canAccept(a.agentId)) { await ack('Бот занят, попробуйте позже'); return; }
        const scope=lifecycle.scope({botId,agentId:a.agentId,chatId:m.chat.id});scopes.set(a.agentId,scope);
        const event={eventType:'button',messageId:m.message_id,...(buttonTopic===null?{}:{topicId:buttonTopic}),from:{userId:cb.from.id,name:[cb.from.first_name,cb.from.last_name].filter(Boolean).join(' '),...(cb.from.username?{username:cb.from.username}:{})},key:parsed.key,...(parsed.group?{btnGroup:parsed.group}:{}),text:buttonText(button.text).replace(/^(⬜️?|⬛️?|✅)\s*/u,'')};
        let eventId;const receipt=parsed.group?buttonRollback.prepare(scope,stored,parsed.group,cb.data):null;
        const holdKey=`button:${cb.id}`;if(receipt)queue.setHeld(a.agentId,holdKey,true);
        try{
          const accepted=queue.enqueueCommitted(a.agentId,event,'chat',()=>!!db.getChat(botId,m.chat.id)?.agentEnabled,meta=>{eventId=meta.id;if(receipt)db.transaction(()=>buttonRollback.commit(receipt,eventId));});
          if(accepted!=='accepted'){await ack('Button unavailable.');return;}
          if(['group','supergroup'].includes(m.chat.type))loud.set(gapKey(botId,m.chat.id,isForum?buttonTopic:null),{until:clock()+120000,remaining:10});
          await ack(queue.state(a.agentId).busy?'Accepted, waiting for processing.':undefined);
          if(receipt)await buttonRollback.close(eventId);
        }finally{if(receipt)queue.setHeld(a.agentId,holdKey,false);}
        return;
      }
      if (update.my_chat_member) {
        const { chat, from, new_chat_member: member } = update.my_chat_member;
        if (['left', 'kicked'].includes(member.status)) { await stopAgent(botId, chat.id, { leave: false }); return; }
        if (chat.type === 'private' || !['member', 'administrator'].includes(member.status)) return;
        if ((roles[db.role(botId, from.id)] ?? 0) < roles.manager) { await telegram.call(botId, 'leaveChat', { chat_id: chat.id }); return; }
        db.saveChat(botId, chat); return;
      }
      const edited = Boolean(update.edited_message || update.edited_channel_post);
      const m = update.message ?? update.channel_post ?? update.edited_message ?? update.edited_channel_post;
      if (!m) return;
      if (m.migrate_to_chat_id || m.migrate_from_chat_id) {
        const oldId=m.migrate_from_chat_id??m.chat.id,newChat=m.migrate_to_chat_id?{...m.chat,id:m.migrate_to_chat_id,type:'supergroup'}:m.chat;
        const a=db.agent(botId,oldId);
        if(a)queue.setHeld(a.agentId,'migration',true);
        try{if(a){await queue.idleAgent(a.agentId);await agent.waitBackground?.(a.agentId);await gate.idleScope(a.agentId);}db.migrateChat(botId,oldId,newChat);clearChatActivity(botId,oldId);albums.clearChat(botId,oldId);if(a){agent.detach?.(a.agentId);lifecycle.invalidate(a.agentId);scopes.set(a.agentId,lifecycle.scope({botId,chatId:newChat.id,agentId:a.agentId}));}}
        finally{if(a)queue.setHeld(a.agentId,'migration',false);}return;
      }
      if (m.chat.type === 'private' ? !db.role(botId, m.from?.id) : !db.getChat(botId, m.chat.id)) return;
      db.saveMessage(botId, m);
      if(!edited&&widgetEvents&&await widgetEvents(botId,update))return;
      if (serviceFields.some(field => m[field] !== undefined)) return;
      if (edited) {
        const a = db.agent(botId, m.chat.id); if (!a || !db.getChat(botId,m.chat.id)?.agentEnabled || m.location?.live_period) return;
        const state = queue.state(a.agentId), active = activeMessages.get(a.agentId), pending = state.events.find(e => Array.isArray(e.event) ? e.event.some(item => item.messageId === m.message_id) : e.event.messageId === m.message_id);
        const replacement=item=>({...shortMessage(m,item.eventType),...(item.triggers?{triggers:item.triggers}:{})});
        if(pending)control.admitted(a.agentId,{source:'chat'});
        if (pending) pending.event = Array.isArray(pending.event) ? pending.event.map(item => item.messageId === m.message_id ? replacement(item) : item) : replacement(pending.event);
        else if (active?.messages.has(m.message_id) && !active.edits.has(m.message_id)) queue.enqueue(a.agentId, shortMessage(m, 'message_edited'), 'chat');
        return;
      }
      if (m.chat.type === 'channel') return;
      if(!db.getChat(botId,m.chat.id)?.agentEnabled){markGap(botId,m.chat.id,topicIdOf(m));return;}
      const triggers=messageTriggers(m,db.getBot(botId),JSON.parse(db.getChat(botId,m.chat.id).triggers)),trigger=triggers.length>0;
      if (m.media_group_id) albums.add(`${botId}:${m.chat.id}:${topicIdOf(m)??0}:${m.media_group_id}`, { ...m, __botId: botId, __triggers:triggers }, trigger);
      else deliver(botId, [{...m,__triggers:triggers}], trigger);
    },
    idle: async () => { do { await sayEvents.idle();await queue.idle();await control.idle(); await Promise.allSettled([...resets.values(),...stateStops.values(),...mcpRefreshes.values()]); } while (queue.jobs.size || resets.size || stateStops.size || mcpRefreshes.size); await sayEvents.idle();await browse.idle();await messageSerial.idle();await gate.idle();await widgetReady;await inline.idle();await widgets?.idle();await closing; },
    close() { fileAbort.abort();browse.close();sayEvents.close();commands.close();inline.close();inlineAvatars.close();unobserveChat?.();websockets.shutdown(); for (const {timer} of actions.values()) clearInterval(timer); actions.clear(); albums.close(); scheduler.close(); queue.close(); lifecycle.close(); closing ??= Promise.allSettled([mcpOAuth.close(),agent.close?.(),widgets?.close(),control.close()]); },
  };
}
