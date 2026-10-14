export function createCustomEmojiDownload({ telegram, download, assertCurrent }) {
  const unavailable = customEmojiId => ({
    customEmojiId,
    error: 'custom_emoji_unavailable',
    description: 'Telegram could not return this custom emoji. Check its ID and retry.',
  });
  return async (scope, { customEmojiIds } = {}) => {
    if (!Array.isArray(customEmojiIds) || !customEmojiIds.length || customEmojiIds.length > 200 ||
        [...customEmojiIds].some(id => typeof id !== 'string' || !id.length)) {
      return { error: 'invalid_argument', description: 'customEmojiIds must contain 1 to 200 non-empty custom emoji ID strings.' };
    }
    let stickers;
    try {
      stickers = await telegram.call(scope.botId, 'getCustomEmojiStickers', { custom_emoji_ids: [...new Set(customEmojiIds)] });
      if (!Array.isArray(stickers)) throw new Error('Invalid sticker metadata');
    } catch {
      return { files: customEmojiIds.map(unavailable) };
    }
    assertCurrent(scope);
    const byId = new Map(stickers.filter(sticker => sticker && typeof sticker.custom_emoji_id === 'string' &&
      typeof sticker.file_id === 'string' && sticker.file_id.length).map(sticker => [sticker.custom_emoji_id, sticker]));
    const fileIds = [...new Set(customEmojiIds.flatMap(id => byId.has(id) ? [byId.get(id).file_id] : []))];
    const result = await download(scope, { fileIds });
    assertCurrent(scope);
    const files = new Map(result.files.map(file => [file.fileId, file]));
    return { files: customEmojiIds.map(customEmojiId => {
      const sticker = byId.get(customEmojiId);
      return sticker ? { customEmojiId, sticker, ...files.get(sticker.file_id) } : unavailable(customEmojiId);
    }) };
  };
}
