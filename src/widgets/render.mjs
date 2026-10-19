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
import {messageAddress} from '../messages/address.mjs';
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
  completeJournal = () => {},
  saveInline = () => {},
  guest,
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
    async publish(ref, value, envelope = {}, view) {
      const widget = store.current(ref), w = view ? {...widget,...view} : widget,
        scope = authorize(ref, view?view.target.chatId:w.chatId),
        normalized = normalizeRender(value);
      let authored = normalized;
      if (w.status === "stopped" || w.status === "disabled") authored = disabledRender(normalized);
      const kind = messageKind(authored);
      const guestPrepared=view?.target.guestRequestId?guest.prepare(scope,authored,'widget'):null;
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
      const cache = caches.get(view?.id ?? w.widgetId) ?? new Map();
      caches.set(view?.id ?? w.widgetId, cache);
      const prepared = prepareWidgetMedia(authored, {
        files: filesFor(scope),
        cache,
      });
      const renderHash = hash([authored, prepared.signatures]);
      if(view?.target.inlineMessageId && prepared.uploads.length)throw widgetError('invalid_argument','Inline messages require existing file IDs or public URLs; upload to a buffer chat first.');
      if (w.message && !w.deliveryUnknown && w.renderHash === renderHash) return view?{message:w.message,target:view.target,projection:{...view}}:w.message;
      let sent = w.message;
      if(view?.target.guestRequestId){
        journal(ref,null,null,view);
        try {
          const published=await guest.publishPrepared(scope,{guestRequestId:view.target.guestRequestId,prepared:guestPrepared,viewId:view.id});
          view.guestPublicationId=published.publicationId;view.target={inlineMessageId:published.inlineMessageId};sent=published.message;
        }catch(error){
          if(error.confirmedTarget){view.target=error.confirmedTarget;journal(ref,null,{message:guestPrepared.snapshot},view);}
          else if(error.noEffect||!['delivery_unknown','storage_failed'].includes(error.code))completeJournal(ref,view.id);
          throw error;
        }
      } else if (!w.messageId && !view?.target.inlineMessageId) {
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
        journal(ref,null,null,view);
        try{sent = await call(
          ref,
          NATIVE_SEND[kind],
          { chat_id: w.chatId, ...topic, ...create, ...body },
          prepared.uploads,
        );}catch(error){if(error.code==='telegram_api_error')completeJournal(ref,view?.id);throw error;}
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
        journal(ref,null,null,view);
        let edited=false;
        for (const step of steps) {
          const fieldsJSON = JSON.stringify(step.fields);
          let result;
          try{result = await call(
            ref,
            step.method,
            { ...(view ? messageAddress(view.target) : {chat_id:w.chatId,message_id:w.messageId}), ...step.fields },
            prepared.uploads.filter((u) =>
              fieldsJSON.includes("attach://" + u.name),
            ),
          );}catch(error){
            if(error.code==='telegram_api_error'&&!edited)completeJournal(ref,view?.id);
            if(edited)throw Object.assign(widgetError('delivery_unknown','Only part of the edit was confirmed; inspect before repairing.'),{cause:error});
            throw error;
          }
          edited=true;
          if (result && typeof result === "object") sent = result;
          else if (view?.target.inlineMessageId)
            sent = structuredClone(prepared.value);
          else if (step.method === "editMessageReplyMarkup")
            sent = { ...sent, reply_markup: step.fields.reply_markup };
        }
      }
      if (!sent?.message_id && !view?.target.inlineMessageId)
        throw widgetError(
          "delivery_unknown",
          "Telegram did not return an identifiable Message.",
        );
      const latest = view ? store.getView(view.id)?.message : store.current(ref).message;
      for (const k of ["reactions", "pollAnswers"])
        if (latest?.[k] !== undefined) sent = { ...sent, [k]: latest[k] };
      if (
        latest?.poll &&
        sent.poll?.id === latest.poll.id &&
        latest.poll !== w.message?.poll
      )
        sent = { ...sent, poll: latest.poll };
      const projection = {
          message: sent,
          renderHash,
          renderSpec: normalized,
          buttonNames: buttons({
            rich: normalized.rich_message,
            keyboard: normalized.reply_markup,
          }).map((b) => b.callback_data),
          pollId: sent.poll?.id ?? null,
          deliveryUnknown:false,
        };
      try {
        journal(ref, sent, projection,view);
        if(view){
          if(store.getView(view.id))store.patchView(ref,view.id,projection);
          if(view.target.inlineMessageId)saveInline(ref,view.target.inlineMessageId,sent);
        } else {
          const {deliveryUnknown,...legacy}=projection;
          store.patch(ref,{...legacy,messageId:sent.message_id,lifecycleIntent:null});
        }
      } catch (e) {
        throw Object.assign(
          widgetError(
            "storage_failed",
            "Telegram confirmed publication but persistence failed; do not resend.",
          ),
          { nativeMessage: sent, messageId: sent.message_id,confirmedMessageId:sent.message_id,...(view?.target.inlineMessageId?{confirmedTarget:view.target}:{}) },
        );
      }
      try {
        if(!view?.target.inlineMessageId)db.saveMessage(ref.botId, sent, undefined, { observeChat: false });
      } catch {} // Durable widget projection is authoritative independently of history.
      try{if(!view?.target.inlineMessageId)cacheWidgetMedia(prepared, sent, cache);}
      catch(error){throw Object.assign(error,{nativeMessage:sent,confirmedMessageId:sent.message_id,confirmedTarget:{chatId:w.chatId,messageId:sent.message_id}});}
      if(view&&store.getView(view.id))completeJournal(ref,view.id);
      return view ? {message:sent,projection,target:view.target.inlineMessageId?view.target:{chatId:w.chatId,messageId:sent.message_id},...(view.guestPublicationId?{guestPublicationId:view.guestPublicationId}:{})} : sent;
    },
    async disable(ref, view) {
      if(!view&&store.listViews){await Promise.allSettled(store.listViews(ref.widgetId).map(v=>this.disable(ref,v)));return;}
      const widget=store.get(ref.widgetId),w=view?{...widget,...view}:widget;
      if (!w?.messageId && !view?.target.inlineMessageId) return;
      try {
        if (w.lifecycleIntent !== "delete")
          try {
            if(view)store.patchView(ref,view.id,{renderHash:null});else store.patch(ref, { renderHash: null });
          } catch {}
        if (w.message?.rich_message) {
          const m = await call(
            ref,
            "editMessageText",
            {
              ...(view?messageAddress(view.target):{chat_id:w.chatId,message_id:w.messageId}),
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
          if (m && typeof m === "object") {if(view)store.patchView(ref,view.id,{message:m});else store.patch(ref, { message: m });}
        } else {
          const markup = disabledRender({
            reply_markup: w.message?.reply_markup ?? { inline_keyboard: [] },
          }).reply_markup;
          const m = await call(
            ref,
            "editMessageReplyMarkup",
            {
              ...(view?messageAddress(view.target):{chat_id:w.chatId,message_id:w.messageId}),
              reply_markup: markup,
            },
            [],
            { cleanup: true },
          );
          if (m && typeof m === "object") {if(view)store.patchView(ref,view.id,{message:m});else store.patch(ref, { message: m });}
        }
      } catch {}
    },
    forget(id) {
      caches.delete(id);
    },
    confirm:completeJournal,
  };
}
export function disabledRender(value) {
  const copy = structuredClone(value);
  const disable=b=>{for(const key of Object.keys(b))if(!['text','icon_custom_emoji_id','style'].includes(key))delete b[key];b.disabled={};};
  for(const row of copy.reply_markup?.inline_keyboard??[])for(const button of row)disable(button);
  const visit=value=>{if(!value||typeof value!=='object')return;
    if(value.type==='button'&&value.button)disable(value.button);
    if(value.type==='buttons'&&Array.isArray(value.buttons))for(const button of value.buttons)disable(button);
    for(const child of Object.values(value))visit(child);
  };visit(copy.rich_message);
  return copy;
}
