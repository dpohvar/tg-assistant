import { createHash } from "node:crypto";
import { normalizeRender } from "./jsx-runtime.mjs";
import { widgetError } from "./contract.mjs";
import { prepareWidgetMedia, cacheWidgetMedia } from "./media.mjs";
import {
  NATIVE_SEND,
  messageKind,
  planNativeEdit,
} from "../messages/edit-plan.mjs";
import { buttons, richInput } from "../messages/callbacks.mjs";
import { destinationFields } from "../telegram/topics.mjs";
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const creationOnly = new Set([
  "venue",
  "contact",
  "poll",
  "dice",
  "sticker",
  "voice",
  "video_note",
]);
export function createWidgetRenderer({
  store,
  db,
  telegram,
  filesFor,
  authorize,
  journal = () => {},
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const caches = new Map();
  const call = async (ref, method, args, uploads = [], options = {}) => {
    for (;;) {
      authorize(ref, args.chat_id, options);
      try {
        return await telegram.call(ref.botId, method, args, { uploads });
      } catch (e) {
        if (
          !options.cleanup &&
          method.startsWith("edit") &&
          e.code === "telegram_api_error" &&
          /^Too Many Requests\b/i.test(e.message) &&
          Number.isSafeInteger(e.retryAfter) &&
          e.retryAfter > 0
        ) {
          for (let remaining = e.retryAfter * 1000; remaining > 0; ) {
            authorize(ref, args.chat_id, options);
            const chunk = Math.min(250, remaining);
            await sleep(chunk);
            remaining -= chunk;
          }
          continue;
        }
        if (
          method.startsWith("edit") &&
          e.code === "telegram_api_error" &&
          /\bmessage is not modified\b/i.test(e.message)
        )
          return;
        if (e.code === "telegram_transport_failed")
          throw widgetError(
            "delivery_unknown",
            "Telegram confirmation is unknown; do not repeat automatically.",
          );
        throw e;
      }
    }
  };
  return {
    async publish(ref, value, envelope = {}) {
      const w = store.current(ref),
        scope = authorize(ref, w.chatId),
        normalized = normalizeRender(value);
      let authored = normalized;
      if (w.status === "disabled") authored = disabledRender(normalized);
      const kind = messageKind(authored);
      if (w.message && w.renderSpec) {
        const previous = w.renderSpec;
        if (
          creationOnly.has(kind) &&
          messageKind(previous) === kind &&
          hash(authored[kind]) !== hash(previous[kind])
        )
          throw widgetError(
            "invalid_argument",
            "This native content cannot be edited; change its keyboard or create another message.",
          );
      }
      const cache = caches.get(w.widgetId) ?? new Map();
      caches.set(w.widgetId, cache);
      const prepared = prepareWidgetMedia(authored, {
        files: filesFor(scope),
        cache,
      });
      const renderHash = hash([authored, prepared.signatures]);
      if (w.message && w.renderHash === renderHash) return w.message;
      let sent = w.message;
      if (!w.messageId) {
        if (w.lifecycleIntent === "delivery_unknown")
          throw widgetError("delivery_unknown");
        const { chatId, messageId, widgetId, ...create } = envelope;
        const chat = JSON.parse(db.getChat(w.botId, w.chatId).json),
          topic = destinationFields({
            chat,
            topicId: w.topicId ?? undefined,
            hasReply: !!create.reply_parameters,
            replyMessage: create.reply_parameters
              ? db.getMessage(
                  w.botId,
                  create.reply_parameters.chat_id ?? w.chatId,
                  create.reply_parameters.message_id,
                )
              : undefined,
          });
        if (create.reply_parameters?.chat_id)
          authorize(ref, create.reply_parameters.chat_id, { read: true });
        const body = structuredClone(prepared.value);
        if (kind === "live_photo") {
          const { media, photo, ...fields } = body.live_photo;
          body.live_photo = media;
          body.photo = photo;
          Object.assign(body, fields);
        } else if (
          ["location", "venue", "contact", "poll", "dice"].includes(kind)
        ) {
          Object.assign(body, body[kind]);
          delete body[kind];
        }
        sent = await call(
          ref,
          NATIVE_SEND[kind],
          { chat_id: w.chatId, ...topic, ...create, ...body },
          prepared.uploads,
        );
      } else {
        const body = prepared.value;
        if (!body.reply_markup) body.reply_markup = { inline_keyboard: [] };
        if (
          ["photo", "video", "animation", "document", "audio"].includes(kind) &&
          body.caption === undefined
        )
          body.caption = "";
        const steps = planNativeEdit(w.message, body);
        if (
          steps.length === 2 &&
          steps[1].method === "editMessageReplyMarkup"
        ) {
          steps[0].fields.reply_markup = steps[1].fields.reply_markup;
          steps.pop();
        }
        if (!steps.length)
          throw widgetError("invalid_argument", "No editable native fields.");
        for (const step of steps) {
          const fieldsJSON = JSON.stringify(step.fields);
          const result = await call(
            ref,
            step.method,
            { chat_id: w.chatId, message_id: w.messageId, ...step.fields },
            prepared.uploads.filter((u) =>
              fieldsJSON.includes("attach://" + u.name),
            ),
          );
          if (result && typeof result === "object") sent = result;
          else if (step.method === "editMessageReplyMarkup")
            sent = { ...sent, reply_markup: step.fields.reply_markup };
        }
      }
      if (!sent?.message_id)
        throw widgetError(
          "delivery_unknown",
          "Telegram did not return an identifiable Message.",
        );
      const latest = store.current(ref).message;
      for (const k of ["reactions", "pollAnswers"])
        if (latest?.[k] !== undefined) sent = { ...sent, [k]: latest[k] };
      if (
        latest?.poll &&
        sent.poll?.id === latest.poll.id &&
        latest.poll !== w.message?.poll
      )
        sent = { ...sent, poll: latest.poll };
      try {
        const projection = {
          messageId: sent.message_id,
          message: sent,
          renderHash,
          renderSpec: normalized,
          buttonNames: buttons({
            rich: normalized.rich_message,
            keyboard: normalized.reply_markup,
          }).map((b) => b.callback_data),
          pollId: sent.poll?.id ?? null,
          lifecycleIntent: null,
        };
        journal(ref, sent, projection);
        store.patch(ref, projection);
      } catch (e) {
        throw Object.assign(
          widgetError(
            "storage_failed",
            "Telegram confirmed publication but persistence failed; do not resend.",
          ),
          { nativeMessage: sent, messageId: sent.message_id },
        );
      }
      try {
        db.saveMessage(ref.botId, sent, undefined, { observeChat: false });
      } catch {} // Durable widget projection is authoritative independently of history.
      cacheWidgetMedia(prepared, sent, cache);
      return sent;
    },
    async disable(ref) {
      const w = store.get(ref.widgetId);
      if (!w?.messageId) return;
      try {
        if (w.lifecycleIntent !== "delete")
          try {
            store.patch(ref, { renderHash: null });
          } catch {}
        if (w.message?.rich_message) {
          const m = await call(
            ref,
            "editMessageText",
            {
              chat_id: w.chatId,
              message_id: w.messageId,
              rich_message: disabledRender({
                rich_message: richInput(w.message.rich_message),
              }).rich_message,
              ...(w.message.reply_markup
                ? {
                    reply_markup: disabledRender({
                      reply_markup: w.message.reply_markup,
                    }).reply_markup,
                  }
                : {}),
            },
            [],
            { cleanup: true },
          );
          if (m && typeof m === "object") store.patch(ref, { message: m });
        } else {
          const markup = disabledRender({
            reply_markup: w.message?.reply_markup ?? { inline_keyboard: [] },
          }).reply_markup;
          const m = await call(
            ref,
            "editMessageReplyMarkup",
            {
              chat_id: w.chatId,
              message_id: w.messageId,
              reply_markup: markup,
            },
            [],
            { cleanup: true },
          );
          if (m && typeof m === "object") store.patch(ref, { message: m });
        }
      } catch {}
    },
    forget(id) {
      caches.delete(id);
    },
  };
}
export function disabledRender(value) {
  const copy = structuredClone(value);
  for (const b of buttons(copy)) {
    delete b.callback_data;
    b.disabled = {};
  }
  return copy;
}
