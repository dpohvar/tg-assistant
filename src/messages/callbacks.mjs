export function parseCallback(data) {
  if (typeof data !== 'string' || Buffer.byteLength(data) > 64) throw new Error('Invalid callback data');
  const match = /^\[([^\[\]]+)\]([^\[\]]+)$/.exec(data);
  const result = match ? { group: match[1], key: match[2] } : { key: data };
  if ((!match && /[\[\]]/.test(data)) || Object.values(result).some(v => !v.length || [...v].length > 20)) throw new Error('Invalid callback key or group');
  return result;
}
export function permitsAllow(permits, data, userId) {
  if (permits == null) return true;
  const keys = Object.keys(permits);
  const rule = Object.hasOwn(permits, data) ? data : keys.filter(k => k.endsWith('*') && data.startsWith(k.slice(0, -1))).sort((a, b) => b.length - a.length)[0];
  if (rule === undefined) return false;
  return permits[rule] === null || Array.isArray(permits[rule]) && permits[rule].includes(userId);
}
export function buttons(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (typeof value.callback_data === 'string') out.push(value);
  for (const v of Object.values(value)) if (v && typeof v === 'object') buttons(v, out);
  return out;
}
// RichText may be a string, an array, or a nested formatted text node.
export function buttonText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(buttonText).join('');
  if (!value || typeof value !== 'object') return '';
  if (value.type === 'custom_emoji') return value.alternative_text ?? '';
  return buttonText(value.text);
}
function selectionMarker(value, selected) {
  let first = true;
  const visit = item => {
    if (!first) return item;
    if (typeof item === 'string') {
      if (!item.length) return item;
      first = false;
      return item.replace(/^(⬜️?|⬛️?|✅)/u, selected ? '✅' : '⬛️');
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') {
      if (item.type === 'custom_emoji' || item.text === undefined) { first = false; return item; }
      return { ...item, text: visit(item.text) };
    }
    return item;
  };
  return visit(value);
}
export function closeButtons(message, group, selected) {
  const copy = structuredClone(message);
  for (const button of buttons({ rich: copy.rich_message, keyboard: copy.reply_markup })) {
    if (parseCallback(button.callback_data).group !== group) continue;
    const wasSelected = button.callback_data === selected;
    delete button.callback_data;
    button.disabled = {};
    button.text = selectionMarker(button.text, wasSelected);
  }
  return copy;
}
// Telegram returns output media metadata; editMessageText expects InputMedia.
// Only JSON media blocks are converted. HTML/Markdown are never parsed here.
export function richInput(rich) {
  const copy = structuredClone(rich);
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const kind of ['photo', 'video', 'animation', 'audio', 'document', 'voice_note']) {
      const media = value[kind];
      const source = Array.isArray(media) ? [...media].sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0] : media;
      if (value.type === kind && source?.file_id) value[kind] = { type: kind, media: source.file_id };
    }
    for (const item of Object.values(value)) if (item && typeof item === 'object') visit(item);
  };
  visit(copy); return copy;
}
