import {widgetTarget} from './views.mjs';
import {widgetError} from './contract.mjs';
import {messageAddress} from '../messages/address.mjs';
export function createWidgetStop({store,authorize,telegram}){
  return async(ref,name,args)=>{
    const w=store.current(ref);let view;
    if(args.viewId!==undefined){if(Object.keys(args).some(k=>k!=='viewId'))throw widgetError('invalid_argument');view=store.getView(args.viewId);}
    else view=store.byTarget(w.botId,widgetTarget(args));
    if(!view||view.widgetId!==w.widgetId)throw widgetError('view_not_found');
    authorize(ref,view.target.chatId);
    if(name==='stop_poll'&&view.target.inlineMessageId)throw widgetError('invalid_argument','Telegram cannot stop a poll by inline message ID.');
    const result=await telegram.call(w.botId,name==='stop_poll'?'stopPoll':'stopMessageLiveLocation',messageAddress(view.target));
    const current=store.getView(view.id);store.current(ref);
    if(!current)return result;
    const message=name==='stop_poll'?{...current.message,poll:result}:result&&typeof result==='object'?{...current.message,...result}:current.message;
    store.patchView(ref,view.id,{message,renderHash:null});return result;
  };
}
