import { formatAgents } from './agents-format.mjs';
import { parseArguments, validateArguments } from './arguments.mjs';
import { formatTasks } from './tasks-format.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createAccess, roles } from '../access/scope.mjs';
export function range(value) { if (!value) return [0, 10]; const m = /^(\d+)(?:-(\d+))?$/.exec(value); if (!m || Number(m[1]) < 1 || Number(m[2] ?? m[1]) < Number(m[1]) || !Number.isSafeInteger(Number(m[2] ?? m[1]))) throw new Error('Укажите позицию N или диапазон FROM-TO.'); return [Number(m[1]) - 1, Number(m[2] ?? m[1])]; }
export function createCommands({ db, config, telegram, scheduler, stopAgent, updateRules, models, fileCommands, masterCommands }) {
  const access = createAccess(db);
  const privateCommands = new Set(['newbot', 'bots', 'set_owner', 'delete_bot', 'set_user', 'remove_user', 'transfer_owner', 'users', 'agents', 'chats', 'agent_messages', 'stop_agent', 'leave_chat', 'rules', 'set_rules', 'ls', 'cat', 'download', 'rm', 'mv', 'edit', 'upload', 'cleanup_temp', 'git_setup', 'git_changes', 'git_sync']);
  const reply = (botId, m, text) => telegram.call(botId, 'sendMessage', { chat_id: m.chat.id, text: [...text].slice(0, 4000).join('') + ([...text].length > 4000 ? '\n[обрезано]' : ''), reply_parameters: { message_id: m.message_id } });
  const list = (values, arg) => { const [a, b] = range(arg); const page = values.slice(a, b); return page.length ? `${a + 1}–${a + page.length} / ${values.length}\n` + page.join('\n') : 'Записей нет'; };
  return {
    async handle(botId, m) {
      const text = m.text ?? '', match = /^\/([a-z_]+)(?:@([\w]+))?(?:\s|$)/i.exec(text);
      const uploadReply = Boolean(m.document && /^\/(set_rules|upload)(?:\s|$)/.test(m.reply_to_message?.text ?? ''));
      if (!match && !uploadReply) return false;
      const rawArgs = match ? text.slice(match[0].length).trim() : '', name = (match?.[1] ?? m.reply_to_message.text.slice(1).split(/\s/)[0]).toLowerCase();
      if (match?.[2] && match[2].toLowerCase() !== db.getBot(botId)?.username.toLowerCase()) return false;
      const sensitive = name === 'newbot' && Boolean(rawArgs) || name === 'git_setup' && Boolean(rawArgs);
      if (['supergroup', 'channel'].includes(m.chat.type)) return Boolean(sensitive);
      try {
        if (botId === 'master') { if (m.chat.type === 'private' && m.from.id === config.serviceOwnerId) { const parsed = parseArguments(text, m.entities, match[0].trimEnd().length); validateArguments(name, parsed); await masterCommands(name, parsed.map(a => a.value), m, reply); } return true; }
        if (m.chat.type === 'private' && !db.role(botId, m.from.id)) return true;
        if (name === 'start' && m.chat.type === 'private') return false;
        const taskCommand = ['tasks', 'task', 'retry_task', 'cancel_task'].includes(name);
        const modelCommand = ['get_model', 'set_model', 'models'].includes(name);
        if (m.chat.type === 'group' && !taskCommand && !modelCommand && name !== 'leave') { if (privateCommands.has(name)) { await reply(botId, m, 'Команда доступна только в ЛС.'); return true; } return false; }
        access.requireRole(botId, m.from.id, taskCommand ? m.chat.type === 'private' ? 'user' : 'manager' : 'admin');
        const role = db.role(botId, m.from.id), owner = role === 'owner', bot = db.getBot(botId);
        if (['set_rules', 'upload'].includes(name) && m.reply_to_message) {
          const quoted = m.reply_to_message;
          const reject = message => { throw Object.assign(new Error(message), { safe: true }); };
          if (quoted.chat?.id !== m.chat.id) reject('Нужно ответить на сообщение в текущем чате.');
          if (!Number.isSafeInteger(m.from?.id) || quoted.from?.id !== m.from.id || quoted.sender_chat) reject('Нужно ответить на своё собственное сообщение.');
          if (quoted.edit_date !== undefined) reject('Нельзя загружать файл ответом на отредактированное сообщение. Отправьте новое сообщение.');
        }
        const source = uploadReply ? m.reply_to_message : m;
        const commandEnd = /^\/[a-z_]+(?:@[\w]+)?/i.exec(source.text ?? '')?.[0].length ?? 0;
        const parsed = parseArguments(source.text ?? '', source.entities, commandEnd);
        validateArguments(name, parsed);
        const parts = parsed.map(a => a.value);
        let result;
        if (name === 'set_user' || name === 'remove_user') {
          const userId = Number(parts[0]), targetRole = db.role(botId, userId), newRole = parts[1] ?? 'user';
          if (!Number.isSafeInteger(userId) || userId <= 0 || (name === 'set_user' ? parts.length > 2 : parts.length !== 1) || targetRole === 'owner' || !owner && (targetRole === 'admin' || newRole === 'admin' || userId === m.from.id) || !['user', 'manager', 'admin'].includes(newRole)) throw new Error('Недопустимый пользователь или роль. Admin управляет только user/manager.');
          if (name === 'set_user') db.setRole(botId, userId, newRole); else { db.sql.prepare('DELETE FROM roles WHERE botId=? AND userId=?').run(botId, userId); await stopAgent(botId, userId, { leave: false }); }
          result = 'Сохранено';
        } else if (name === 'transfer_owner') {
          if (!owner || parts.length !== 1 || !Number.isSafeInteger(Number(parts[0])) || Number(parts[0]) <= 0) throw new Error('Владелец может указать один положительный USER_ID.');
          db.sql.prepare('UPDATE bots SET ownerId=? WHERE botId=?').run(Number(parts[0]), botId); result = 'Владелец изменён';
        } else if (['users', 'agents', 'chats', 'agent_messages'].includes(name)) {
          let values;
          if (name === 'users') values = [{ userId: bot.ownerId, role: 'owner' }, ...db.sql.prepare('SELECT userId,role FROM roles WHERE botId=? AND userId!=? ORDER BY userId').all(botId, bot.ownerId)].sort((a, b) => a.userId - b.userId).map(v => `${v.userId} ${v.role}`);
          if (name === 'agents') values = db.sql.prepare('SELECT agents.*,chats.name,chats.chatType,chats.json FROM agents JOIN chats USING(botId,chatId) WHERE botId=? ORDER BY createdAt,agentId').all(botId);
          if (name === 'chats') values = db.sql.prepare('SELECT * FROM chats WHERE botId=? ORDER BY chatId').all(botId).map(v => `${v.chatId} ${v.chatType} ${v.name}`);
          if (name === 'agent_messages') { if (!parts[0] || parts.length > 2) throw new Error('/agent_messages AGENT_ID [FROM-TO или N]'); values = db.sql.prepare('SELECT * FROM agent_messages WHERE botId=? AND (fromAgentId=? OR toAgentId=?) ORDER BY date DESC,id DESC').all(botId, parts[0], parts[0]).map(v => `${v.fromAgentId} -> ${v.toAgentId} ${new Date(v.date).toISOString()}\n${v.text}`); }
          else if (parts.length > 1) throw new Error('Список принимает один диапазон или позицию.');
          if (name === 'agents') { const [from,to] = range(parts[0]); result = formatAgents(values.slice(from,to),from,values.length); }
          else result = list(values, parts[name === 'agent_messages' ? 1 : 0]);
        } else if (taskCommand) {
          const a = db.agent(botId, m.chat.id); if (!a) throw new Error('Агент не создан.');
          if (name === 'tasks') { if (parts.length > 1) throw new Error('/tasks [FROM-TO или N]'); const tasks = scheduler.list(a).tasks, [from, to] = range(parts[0]); result = formatTasks(tasks.slice(from, to).map(t => scheduler.task(t.taskId)), from, tasks.length); }
          else { if (parts.length !== 1 || scheduler.task(parts[0])?.agentId !== a.agentId) throw new Error('Задача недоступна.'); if (name === 'task') result = JSON.stringify(scheduler.list(a, parts).tasks[0], null, 2); if (name === 'cancel_task') result = JSON.stringify(scheduler.cancel(a, parts)); if (name === 'retry_task') { scheduler.retry(parts[0]); result = 'Передано в очередь'; } }
        } else if (modelCommand) {
          if (name === 'models') { if (parts.length) throw new Error('/models без аргументов'); result = (await models()).map(v => v.model).join('\n'); }
          else { const set = name === 'set_model', target = parts[set ? 1 : 0], record = target === 'default' ? null : target ? db.sql.prepare('SELECT * FROM agents WHERE botId=? AND agentId=?').get(botId, target) : db.agent(botId, m.chat.id); if (parts.length > (set ? 2 : 1) || target !== 'default' && !record) throw new Error('Укажите доступного агента или default.'); if (set) { if (!(await models()).some(v => v.model === parts[0])) throw new Error('Модель отсутствует в /models.'); if (target === 'default') db.sql.prepare('UPDATE bots SET defaultModel=? WHERE botId=?').run(parts[0], botId); else db.sql.prepare('UPDATE agents SET model=? WHERE agentId=?').run(parts[0], record.agentId); result = 'Модель сохранена для следующего хода'; } else result = record?.model ?? bot.defaultModel; }
        } else if (['stop_agent', 'leave', 'leave_chat'].includes(name)) {
          const target = name === 'leave' ? db.agent(botId, m.chat.id) : name === 'leave_chat' ? { chatId: Number(parts[0]) } : db.sql.prepare('SELECT * FROM agents WHERE botId=? AND agentId=?').get(botId, parts[0]);
          if (!target || name === 'leave' && parts.length || name !== 'leave' && parts.length !== 1 || !db.getChat(botId, target.chatId)) throw new Error('Укажите доступного агента/чат.');
          if (target.chatId === m.chat.id && m.chat.type !== 'private') { await reply(botId, m, 'Выхожу из группы и удаляю данные диалога. Wiki сохранится.'); await stopAgent(botId, target.chatId); return true; }
          await stopAgent(botId, target.chatId); result = 'Остановлено. Данные диалога удалены; wiki сохранена.';
        } else if (name === 'rules' || name === 'set_rules') {
          const rulesPath = path.join(config.dataDir, 'rules', botId, 'AGENTS.md');
          if (name === 'rules') { if (parts.length) throw new Error('/rules без аргументов'); await telegram.call(botId, 'sendDocument', { chat_id: m.chat.id, document: 'attach://rules', reply_parameters: { message_id: m.message_id } }, { uploads: [{ name: 'rules', filename: 'AGENTS.md', bytes: fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath) : Buffer.from('') }] }); return true; }
          if (parts.length > 1 || parts[0] && parts[0] !== 'force') throw new Error('/set_rules [force]');
          const document = uploadReply ? m.document : m.reply_to_message?.document;
          if (!document) result = 'Отправьте файл цитатой на своё сообщение /set_rules';
          else { await updateRules(botId, document, parts[0] === 'force'); result = 'Правила обновлены. Контекст агентов будет очищен.'; }
        } else if (fileCommands && ['git_setup', 'git_changes', 'git_sync', 'ls', 'cat', 'download', 'upload', 'rm', 'mv', 'edit', 'cleanup_temp'].includes(name)) {
          result = await fileCommands(botId, name, parsed, m);
        } else throw new Error('Неизвестная команда.');
        if (result === null) return true;
        if (result?.parse_mode || result?.entities) await telegram.call(botId, 'sendMessage', { chat_id: m.chat.id, ...result, reply_parameters: { message_id: m.message_id } });
        else await reply(botId, m, typeof result === 'string' ? result : JSON.stringify(result));
      } catch (e) { await reply(botId, m, e.code === 'access_denied' ? 'Нет доступа' : e.safe ? e.message : 'Команда не выполнена. Проверьте синтаксис, роль и доступность данных.'); }
      finally { if (sensitive) { try { await telegram.call(botId, 'deleteMessage', { chat_id: m.chat.id, message_id: m.message_id }); } catch {} } }
      return true;
    },
  };
}
