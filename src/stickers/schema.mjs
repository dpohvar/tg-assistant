const str = { type: "string", minLength: 1 };
const owner = { type: "integer", minimum: 1 };
const format = { type: "string", enum: ["static", "animated", "video"] };
const emojis = { type: "array", minItems: 1, maxItems: 20, items: str };
const keywords = { type: "array", maxItems: 20, items: { type: "string" } };
const uploads = { type: "object", additionalProperties: str };
const sticker = {
  type: "object",
  properties: { sticker: str, format, emoji_list: emojis, keywords },
  required: ["sticker", "format", "emoji_list"],
  additionalProperties: false,
};
const tool = (name, description, properties, required = []) => ({
  type: "function",
  name,
  description,
  inputSchema: {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  },
});
export const stickerSetTools = [
  tool(
    "sticker_set_get",
    "Read a live Telegram sticker/custom emoji set by short name or t.me/addstickers or addemoji link. Returns native set including all Sticker file_id and custom_emoji_id values plus link. Use download or download_custom_emoji for selected artwork. Does not register or download the set.",
    { name: str },
    ["name"],
  ),
  tool(
    "sticker_sets",
    "List this bot's locally recorded created sets with name, title, type, ownerUserId and link. Shared across agents, persists across resets. Unconfirmed creation intents appear separately in uncertain; inspect before retrying. External sets read by name are not registered.",
    {},
  ),
  tool(
    "sticker_set_create",
    "Create a regular sticker set or custom emoji set. Full name must end _by_<bot_username>. Owner defaults to application bot owner. 1-50 native InputSticker entries: sticker is file_id, supported URL or attach://name; uploads maps names to permitted local paths. Static PNG/WebP, animated TGS, video WebM. needsRepainting is custom emoji only. Returns created status, name, ownerUserId, link; then get the set for native IDs. Never automatically retry delivery_unknown or applied:true errors.",
    {
      name: str,
      title: { type: "string", minLength: 1, maxLength: 64 },
      type: { type: "string", enum: ["regular", "custom_emoji"] },
      ownerUserId: owner,
      stickers: { type: "array", minItems: 1, maxItems: 50, items: sticker },
      uploads,
      needsRepainting: { type: "boolean" },
    },
    ["name", "title", "type", "stickers"],
  ),
  tool(
    "sticker_set_edit",
    "Edit one set operation. add: sticker; replace: oldFileId,sticker; remove: fileId; move: fileId,position (zero-based); set_emojis: fileId,emojiList; set_keywords: fileId,keywords ([] clears); set_title: title; set_thumbnail: regular thumbnail,format or emoji customEmojiId (null resets). Owner for add/replace/regular thumbnail defaults to recorded owner then bot owner. uploads maps attachment names to local paths. Telegram checks edit rights; no catalog membership required. Check delivery_unknown before retrying; applied:true means mutation succeeded.",
    {
      name: str,
      action: {
        type: "string",
        enum: [
          "add",
          "replace",
          "remove",
          "move",
          "set_emojis",
          "set_keywords",
          "set_title",
          "set_thumbnail",
        ],
      },
      sticker,
      oldFileId: str,
      fileId: str,
      position: { type: "integer", minimum: 0 },
      emojiList: emojis,
      keywords,
      title: { type: "string", minLength: 1, maxLength: 64 },
      thumbnail: { type: ["string", "null"] },
      format,
      customEmojiId: { type: ["string", "null"] },
      ownerUserId: owner,
      uploads,
    },
    ["name", "action"],
  ),
  tool(
    "sticker_set_delete",
    "Delete an actual Telegram sticker/custom emoji set and remove its local catalog entry after confirmation. Telegram checks ownership. On delivery_unknown inspect first; never repeat an applied:true operation.",
    { name: str },
    ["name"],
  ),
];
