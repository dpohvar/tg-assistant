export const NATIVE_SEND = {
  text: "sendMessage",
  rich_message: "sendRichMessage",
  photo: "sendPhoto",
  video: "sendVideo",
  animation: "sendAnimation",
  document: "sendDocument",
  audio: "sendAudio",
  voice: "sendVoice",
  sticker: "sendSticker",
  video_note: "sendVideoNote",
  location: "sendLocation",
  venue: "sendVenue",
  contact: "sendContact",
  poll: "sendPoll",
  dice: "sendDice",
  live_photo: "sendLivePhoto",
};
export function messageKind(m) {
  for (const special of ["venue", "live_photo"])
    if (m?.[special] !== undefined) return special;
  return Object.keys(NATIVE_SEND).find((k) => m?.[k] !== undefined);
}
export function planNativeEdit(old, body) {
  const steps = [],
    kind = body.media?.type ?? messageKind(body),
    original = messageKind(old);
  if (body.text !== undefined || body.rich_message !== undefined)
    steps.push({
      method: "editMessageText",
      fields: Object.fromEntries(
        [
          "text",
          "rich_message",
          "parse_mode",
          "entities",
          "link_preview_options",
        ]
          .filter((k) => body[k] !== undefined)
          .map((k) => [k, body[k]]),
      ),
    });
  else if (
    body.media ||
    ["photo", "video", "animation", "document", "audio", "live_photo"].includes(
      kind,
    )
  ) {
    const fields = [
      "caption",
      "caption_entities",
      "parse_mode",
      "show_caption_above_media",
      "has_spoiler",
      "duration",
      "width",
      "height",
      "thumbnail",
      "cover",
      "start_timestamp",
      "supports_streaming",
      "disable_content_type_detection",
    ];
    const media = body.media ?? {
      type: kind,
      ...(kind === "live_photo" ? body.live_photo : { media: body[kind] }),
      ...Object.fromEntries(
        fields.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]),
      ),
    };
    steps.push({ method: "editMessageMedia", fields: { media } });
  } else if (kind === "location")
    steps.push({
      method: "editMessageLiveLocation",
      fields: Object.fromEntries(
        [
          "latitude",
          "longitude",
          "live_period",
          "horizontal_accuracy",
          "heading",
          "proximity_alert_radius",
        ]
          .filter((k) => body.location[k] !== undefined)
          .map((k) => [k, body.location[k]]),
      ),
    });
  else if (body.caption !== undefined)
    steps.push({
      method: "editMessageCaption",
      fields: Object.fromEntries(
        [
          "caption",
          "caption_entities",
          "parse_mode",
          "show_caption_above_media",
        ]
          .filter((k) => body[k] !== undefined)
          .map((k) => [k, body[k]]),
      ),
    });
  if (body.reply_markup !== undefined)
    steps.push({
      method: "editMessageReplyMarkup",
      fields: { reply_markup: body.reply_markup },
    });
  return steps;
}
