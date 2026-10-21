import {createHash} from 'node:crypto';
import {buttons} from '../messages/callbacks.mjs';

// Telegram can identify a guest message differently for each private participant.
// A wire token identifies our view and an exact published authored callback; it
// never establishes ownership of the callback's previously unknown address.
const token=(viewId,data)=>`w:${viewId}:${createHash('sha256').update(data).digest('base64url').slice(0,22)}`;

export function inlineWidgetButtons(value,view){
  if(!view?.target.inlineMessageId&&!view?.target.guestRequestId)return value;
  const copy=structuredClone(value);
  for(const button of buttons(copy))button.callback_data=token(view.id,button.callback_data);
  return copy;
}

export function resolveInlineWidgetCallback(store,botId,callback){
  if(!store||!callback?.inline_message_id||callback.message)return null;
  const match=/^w:(v[a-f0-9]{32}):[A-Za-z0-9_-]{22}$/.exec(callback.data??'');
  if(!match)return null;
  const view=store.getView(match[1]);
  if(!view||view.botId!==botId||!view.target.inlineMessageId)return null;
  const addressed=store.byTarget(botId,{inlineMessageId:callback.inline_message_id});
  if(addressed&&addressed.id!==view.id)return null;
  const data=view.buttonNames.find(value=>token(view.id,value)===callback.data);
  return data===undefined?null:{view,data};
}
