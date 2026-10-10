import fs from 'node:fs';
import path from 'node:path';
import { BotFiles } from '../files/paths.mjs';
import { cleanTemp } from '../files/cleanup.mjs';
import { gitChanges, gitSync, gitAuth } from '../git/operations.mjs';
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function createFileCommands({ db, config, telegram, fetchDocument, gitSetup }) {
  return async (botId, name, args, message) => {
    const root = path.join(config.botsDir, botId), store = new BotFiles(root, 'admin', { admin: true });
    const parts = args.map(a => a.value), filename = parts[0];
    if (name === 'ls') return store.list(filename ?? '.').join('\n');
    if (name === 'cat') { const bytes = store.read(filename), content = bytes.toString('utf8');  return { text: `${escape(filename.slice(0,200))}\n<pre>${escape(content.slice(0,3000))}</pre>${content.length>3000?'\n[truncated]':''}`, parse_mode: 'HTML' }; }
    if (name === 'download') { await telegram.call(botId, 'sendDocument', { chat_id: message.chat.id, document: 'attach://file', reply_parameters: { message_id: message.message_id } }, { uploads: [{ name: 'file', filename: path.basename(filename), bytes: store.read(filename) }] }); return null; }
    if (name === 'rm') { store.remove(filename); return 'Deleted'; }
    if (name === 'mv') { store.move(parts[0], parts[1]); return 'Moved'; }
    if (name === 'edit') { store.write(filename, Buffer.from(parts[1])); return 'Saved'; }
    if (name === 'upload') { const document = message.document ?? message.reply_to_message?.document; if (!document) return 'Send a document in reply to your own /upload PATH command'; store.write(filename, await fetchDocument(botId, document)); return 'Saved'; }
    if (name === 'cleanup_temp') { const failures = cleanTemp(root); return failures.length ? failures.join('\n') : 'Cleanup complete'; }
    const settings = db.sql.prepare('SELECT * FROM git_settings WHERE botId=?').get(botId);
    if (name === 'git_setup') return gitSetup(botId, parts, settings);
    const options = { root, configured: Boolean(settings), branch: settings?.branch, env: gitAuth(settings?.secretRef) };
    return name === 'git_changes' ? gitChanges(options) : gitSync(options, parts.join(' '));
  };
}
