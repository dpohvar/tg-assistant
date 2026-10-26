// Opt-in native API experiment, not the proposed React renderer.
// node test/manual/empty-rich-probe.mjs PRIVATE_CONFIG COMPLETED_GROUP_STATE [SECONDS]
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createTelegram} from '../../src/telegram/api.mjs';
import {acquireLock} from '../../src/service/lock.mjs';

if (!process.argv[2] || !process.argv[3]) throw Error('Explicit private config and completed group state required.');
const configFile = path.resolve(process.argv[2]);
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const previous = JSON.parse(fs.readFileSync(path.resolve(process.argv[3]), 'utf8'));
const seconds = Number(process.argv[4] ?? 1200);
if (config.controllerActive !== false || config.username !== 'dpohvar_test_pub_bot' ||
    !config.token || !Number.isSafeInteger(config.ownerId) || !Number.isSafeInteger(config.botTelegramId) ||
    !previous.stoppedAt || !Number.isSafeInteger(previous.groupId) || previous.groupId >= 0 ||
    !Number.isSafeInteger(seconds) || seconds < 60 || seconds > 1800) throw Error('Unsafe probe configuration.');
const release = acquireLock(path.join(path.dirname(configFile), 'inline-calibration.lock'));
const run = randomBytes(3).toString('hex');
const dir = path.resolve('.runtime-check/empty-rich', run);
fs.mkdirSync(dir, {recursive: true});
const state = {run, startedAt: Date.now(), expiresAt: Date.now() + seconds * 1000, cases: [], ordinary: [], ephemeral: [], events: [], errors: []};
const save = () => fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
const clean = error => String(error?.message ?? error).replaceAll(config.token, '[redacted]').slice(0, 400);
const record = (type, extra = {}) => {state.events.push({at: Date.now(), type, ...extra}); save(); console.log(JSON.stringify({type, ...extra}));};
const groupId = previous.groupId;
const stop = new AbortController();
const timer = setTimeout(() => stop.abort(), seconds * 1000);
const watcher = setInterval(() => {if (fs.existsSync(path.join(dir, 'stop'))) stop.abort();}, 500);
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
let cleaning = false, offset, previousAllowed, polling = false, identityConfirmed = false, launcher;
const api = createTelegram({getToken: () => config.token});
const paragraph = text => ({blocks: [{type: 'paragraph', text}]});
const candidates = [
  {name: 'no-blocks', rich: {blocks: []}},
  {name: 'empty-paragraph', rich: paragraph('')},
  {name: 'space', rich: paragraph(' ')},
  {name: 'nbsp', rich: paragraph('\u00a0')},
  {name: 'braille-blank', rich: paragraph('\u2800')},
  {name: 'zero-width-space', rich: paragraph('\u200b')},
];
const summarize = m => ({hasRich: !!m?.rich_message, rich: m?.rich_message, text: m?.text, ephemeral: m?.ephemeral_message_id !== undefined});
function ownedEphemeral(args) {
  return state.ephemeral.some(a => a.chat_id === args.chat_id && a.receiver_user_id === args.receiver_user_id && a.ephemeral_message_id === args.ephemeral_message_id);
}
async function call(method, args = {}) {
  if (args.chat_id !== undefined && ![groupId, config.ownerId].includes(args.chat_id)) throw Error('Unobserved destination.');
  if ((method.startsWith('editMessage') || method === 'deleteMessage') &&
      !state.ordinary.some(a => a.chat_id === args.chat_id && a.message_id === args.message_id)) throw Error('Unowned ordinary target.');
  if ((method.startsWith('editEphemeral') || method === 'deleteEphemeralMessage') && !ownedEphemeral(args)) throw Error('Unowned ephemeral target.');
  const result = await api.call('empty-rich-probe', method, args, {signal: cleaning ? AbortSignal.timeout(12000) : AbortSignal.any([stop.signal, AbortSignal.timeout(method === 'getUpdates' ? 20000 : 12000)])});
  if (method === 'sendMessage' || method === 'sendRichMessage') {
    if (result?.ephemeral_message_id !== undefined) {
      if (result.chat?.id !== groupId || result.receiver_user?.id !== config.ownerId || !Number.isSafeInteger(result.ephemeral_message_id)) throw Error('Unexpected ephemeral receipt.');
      state.ephemeral.push({chat_id: groupId, receiver_user_id: config.ownerId, ephemeral_message_id: result.ephemeral_message_id});
    } else if (result?.message_id > 0 && result.chat?.id === args.chat_id) state.ordinary.push({chat_id: args.chat_id, message_id: result.message_id});
    else throw Error('Unconfirmed send; do not repeat.');
    save();
  }
  return result;
}
const dm = text => call('sendMessage', {chat_id: config.ownerId, text, disable_notification: true});
async function remove(address) {
  await call(address.ephemeral_message_id !== undefined ? 'deleteEphemeralMessage' : 'deleteMessage', address);
  const list = address.ephemeral_message_id !== undefined ? state.ephemeral : state.ordinary;
  list.splice(list.indexOf(address), 1); save();
}
async function attempt(mode, candidate, operation, fn) {
  const entry = {mode, candidate: candidate.name, operation};
  const began = Date.now();
  try {const message = await fn(); Object.assign(entry, {ok: true, receipt: summarize(message)}); return message;}
  catch (error) {
    Object.assign(entry, {ok: false, error: clean(error)});
    if (error.code !== 'telegram_api_error' || error.retryAfter) throw error;
  } finally {entry.elapsedMs = Date.now() - began; state.cases.push(entry); record('case', entry);}
}
const keyboard = (label, action) => ({inline_keyboard: [[{text: label, callback_data: `empty:${run}:${action}`}]]});
const sourceAddress = message => message.ephemeral_message_id !== undefined
  ? state.ephemeral.find(a => a.ephemeral_message_id === message.ephemeral_message_id)
  : state.ordinary.find(a => a.chat_id === message.chat.id && a.message_id === message.message_id);
function summary(mode) {
  return candidates.map(c => `${c.name}: ${['send', 'edit'].map(op => `${op}=${state.cases.find(e => e.mode === mode && e.candidate === c.name && e.operation === op)?.ok ?? 'pending'}`).join(', ')}`).join('\n');
}
async function ephemeralCase(query, index) {
  const candidate = candidates[index];
  if (!candidate || state.cases.some(e => e.mode === 'ephemeral' && e.candidate === candidate.name)) return;
  const params = {receiver_user_id: config.ownerId, callback_query_id: query.id};
  const direct = await attempt('ephemeral', candidate, 'send', () => call('sendRichMessage', {
    chat_id: groupId, rich_message: candidate.rich, ephemeral_message_parameters: params,
    disable_notification: true,
  }));
  if (direct) await call('editEphemeralMessageReplyMarkup', {...sourceAddress(direct), reply_markup: keyboard(`${candidate.name}: direct / remove`, 'remove')});
  const seed = await call('sendRichMessage', {chat_id: groupId, rich_message: paragraph(`Ephemeral edit control: ${candidate.name}`), ephemeral_message_parameters: params, disable_notification: true});
  const address = sourceAddress(seed);
  const edited = await attempt('ephemeral', candidate, 'edit', () => call('editEphemeralMessageText', {
    ...address, rich_message: candidate.rich, reply_markup: keyboard(`${candidate.name}: edited / remove`, 'remove'),
  }));
  if (!edited) await remove(address);
  await dm(`Empty-rich ${run}: ${candidate.name}\nDirect=${!!direct}; edit=${!!edited}. Inspect the private messages in the test group; their button labels identify the case.\n${summary('ephemeral')}\nStop: /empty stop ${run}`);
}
async function receive(update) {
  const m = update.message;
  if (m?.from?.id === config.ownerId && m.chat?.id === config.ownerId && m.text === `/empty stop ${run}`) {stop.abort(); return;}
  const q = update.callback_query;
  if (q?.from?.id !== config.ownerId || !q.data?.startsWith(`empty:${run}:`) || q.message?.chat?.id !== groupId) return;
  const address = sourceAddress(q.message);
  if (!address) return;
  const action = q.data.slice(`empty:${run}:`.length);
  // Acknowledge immediately; the callback ID is still used for the private send.
  await call('answerCallbackQuery', {callback_query_id: q.id});
  record('callback', {action, ephemeral: address.ephemeral_message_id !== undefined});
  if (action === 'remove') {await remove(address); return;}
  if (action === 'stop') {stop.abort(); return;}
  if (/^case:[0-5]$/.test(action) && q.message.message_id === launcher?.message_id && q.message.ephemeral_message_id === undefined) await ephemeralCase(q, Number(action.slice(5)));
}
try {
  const me = await call('getMe');
  if (me.id !== config.botTelegramId || me.username !== config.username) throw Error('Wrong bot.');
  identityConfirmed = true;
  const hook = await call('getWebhookInfo');
  if (hook.url) throw Error('Active webhook.');
  previousAllowed = hook.allowed_updates;
  const member = await call('getChatMember', {chat_id: groupId, user_id: me.id});
  if (!['member', 'administrator', 'creator'].includes(member.status)) throw Error('Bot is absent from test group.');
  state.membership = member.status;
  const control = await call('sendRichMessage', {chat_id: groupId, rich_message: paragraph(`Empty-rich control ${run}`), disable_notification: true});
  const controlAddress = sourceAddress(control);
  record('rich_control_confirmed', {receipt: summarize(control)});
  for (const candidate of candidates) {
    const sent = await attempt('ordinary', candidate, 'send', () => call('sendRichMessage', {chat_id: groupId, rich_message: candidate.rich, disable_notification: true}));
    if (sent) await remove(sourceAddress(sent));
    await attempt('ordinary', candidate, 'edit', () => call('editMessageText', {...controlAddress, rich_message: candidate.rich}));
    await call('editMessageText', {...controlAddress, rich_message: paragraph(`Empty-rich control ${run}: after ${candidate.name}`)});
  }
  await remove(controlAddress);
  // Leave one confirmed blank-body example with a visible keyboard for client inspection.
  const best = candidates.find(c => state.cases.some(e => e.mode === 'ordinary' && e.candidate === c.name && e.operation === 'send' && e.ok));
  if (best) await call('sendRichMessage', {chat_id: groupId, rich_message: best.rich, reply_markup: keyboard(`Public blank: ${best.name} / remove`, 'remove'), disable_notification: true});
  launcher = await call('sendMessage', {
    chat_id: groupId, text: `Empty-rich probe ${run}\nOrdinary API results:\n${summary('ordinary')}\nPress each case once to test private send + edit. Inspect blank bodies above their labelled buttons. Finish removes only this probe's messages.`,
    reply_markup: {inline_keyboard: [...candidates.map((c, i) => [{text: `${i + 1}. ${c.name}`, callback_data: `empty:${run}:case:${i}`}]), [{text: 'Finish and clean up', callback_data: `empty:${run}:stop`}]]}, disable_notification: true,
  });
  await dm(`Empty-rich probe ${run} is ready in the previous test group. Ordinary API results:\n${summary('ordinary')}\nPress the six case buttons, inspect the private blank-message bodies, then Finish. Expires in ${seconds / 60} minutes. Stop: /empty stop ${run}`);
  fs.writeFileSync('.runtime-check/empty-rich-active.json', JSON.stringify({run, dir}, null, 2));
  record('ready', {run, expiresAt: state.expiresAt});
  while (!stop.signal.aborted) {
    polling = true;
    const updates = await call('getUpdates', {...(offset === undefined ? {} : {offset}), timeout: 10, allowed_updates: ['message', 'callback_query']});
    for (const update of updates) {offset = update.update_id + 1; await receive(update); if (stop.signal.aborted) break;}
  }
} catch (error) {
  if (!stop.signal.aborted) {state.errors.push(clean(error)); record('fatal', {error: clean(error)}); process.exitCode = 1;}
} finally {
  clearTimeout(timer); clearInterval(watcher); cleaning = true;
  if (identityConfirmed) for (const address of [...state.ephemeral, ...[...state.ordinary].reverse()]) {
    try {await remove(address);} catch (error) {record('cleanup_error', {error: clean(error)});}
  }
  if (polling) try {await call('getUpdates', {...(offset === undefined ? {} : {offset}), timeout: 0, limit: 1, allowed_updates: previousAllowed ?? []}); state.pollRestored = true;} catch (error) {record('restore_error', {error: clean(error)});}
  state.stoppedAt = Date.now(); save(); release(); record('stopped', {lockReleased: true});
}
