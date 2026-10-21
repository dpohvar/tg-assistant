import { projectReaction } from "../messages/reactions.mjs";
import { observePoll, observePollAnswer } from "./polls.mjs";
import { validateWidgetEvent, widgetCallbackAction } from "./contract.mjs";
import {viewSnapshot} from './views.mjs';
import {resolveInlineWidgetCallback} from './callbacks.mjs';
export function createWidgetEvents({ db, manager, telegram }) {
  const store = manager.store;
  return async (botId, update) => {
    let w, name, source, data, user, callbackData;
    const callback = update.callback_query;
    if (callback) {
      const m = callback.message;
      if (!m&&!callback.inline_message_id) return false;
      const inline=callback.inline_message_id&&store.byTarget(botId,{inlineMessageId:callback.inline_message_id});
      const resolved=resolveInlineWidgetCallback(store,botId,callback),view=resolved?.view??inline;
      callbackData=resolved?.data??callback.data;
      w = view?{...store.get(view.widgetId),view}:m?store.byMessage(botId, m.chat.id, m.message_id):null;
      if (!w) return false;
      const ack = () =>
        telegram
          .call(botId, "answerCallbackQuery", {
            callback_query_id: callback.id,
          })
          .catch(() => {});
      if (w.status !== "active" || w.view.deliveryUnknown || manager.buttonsBlocked?.(w.view.id) || !w.view.buttonNames.includes(callbackData)) {
        await ack();
        return true;
      }
      try {
        name = widgetCallbackAction(callbackData);
      } catch {
        // A stale/corrupt registry must never turn a callback into a system hook.
        await ack();
        return true;
      }
      if (name === null) {
        await ack();
        return true;
      }
      source = "button";
      data = resolved?{...callback,data:callbackData}:callback;
      user = callback.from;
    } else if (update.poll || update.poll_answer) {
      data = update.poll ?? update.poll_answer;
      w = store.byPoll(botId, update.poll?.id ?? update.poll_answer.poll_id);
      if (!w) return false;
      source = update.poll ? "poll" : "poll_answer";
      name = update.poll ? "onPoll" : "onPollAnswer";
      user = update.poll_answer?.user;
      if (update.poll) observePoll(store, w, update.poll);
      else observePollAnswer(db, store, w, update.poll_answer);
    } else if (update.message_reaction || update.message_reaction_count) {
      data = update.message_reaction ?? update.message_reaction_count;
      w = store.byMessage(botId, data.chat.id, data.message_id);
      if (!w) return false;
      source = "reaction";
      name = "onReaction";
      user = data.user;
      const message = projectReaction(structuredClone(w.view.message), data);
      if (message) {
        if (message.reactions?.users?.length > 1000) {
          message.reactions.users = message.reactions.users.slice(-1000);
          message.reactions.usersComplete = false;
        }
        store.patchView(w,w.view.id, { message });
      }
    } else {
      const m = update.message ?? update.channel_post;
      if (!m?.reply_to_message) return false;
      w = store.byMessage(botId, m.chat.id, m.reply_to_message.message_id);
      if (!w) return false;
      source = "reply";
      name = "onReply";
      data = m;
      user = m.from;
      if (w.status === "active" && !manager.hasHook(w, name)) return false;
    }
    if (w.lifecycleIntent === "delete") return false;
    if(w.status!=='active')return true;
    if (
      source !== "button" &&
      source !== "reply" &&
      w.status === "active" &&
      !manager.hasHook(w, name)
    )
      return true;
    const event = {
      name,
      source,
      receivedAt: new Date().toISOString(),
      delayed: false,
      data,
      view:viewSnapshot(w.view),
      ...(user ? { user } : {}),
    };
    try {
      validateWidgetEvent(event);
      await manager.admit(w, event,{viewId:w.view.id,bindingEpoch:w.view.bindingEpoch,target:w.view.target,
        ...(source==='button'?{callbackData}:{}),...(['poll','poll_answer'].includes(source)?{pollId:w.view.pollId}:{})});
    } catch (e) {
      if (
        [
          "queue_full",
          "event_too_large",
          "widget_stopped",
          "widget_disabled",
        ].includes(e.code)
      ) {
        if (e.code === "event_too_large")
          db.sql
            .prepare("UPDATE widgets SET dropped=dropped+1 WHERE widgetId=?")
            .run(w.widgetId);
        if (callback)
          await telegram
            .call(botId, "answerCallbackQuery", {
              callback_query_id: callback.id,
            })
            .catch(() => {});
        return true;
      }
      throw e;
    }
    return true;
  };
}
