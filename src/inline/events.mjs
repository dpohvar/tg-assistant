import {buttons} from '../messages/callbacks.mjs';
export function createInlineEvents({store,widgets,queue,resolveOwner,telegram,onError=()=>{}}) {
  const ownedView=(botId,id)=>widgets?.store.byTarget(botId,{inlineMessageId:id});
  function keyboardAllows(scope,id,data,component) {
    const snapshot=store.read(scope,id);if(!snapshot)return true;
    const field=component==='rich'?'rich_message':'reply_markup';
    if(component==='rich'&&(snapshot.text!==undefined||snapshot.media!==undefined))return false;
    if(!Object.hasOwn(snapshot,field))return true;
    return buttons(snapshot[field]).some(button=>button.callback_data===data);
  }
  function admit(record) {
    if(record.queuedAt!=null||record.discardedAt!=null)return;
    const scope=resolveOwner(record.botId,record.agentId),event=record.event;
    if(!scope||ownedView(record.botId,event.inlineMessageId)||!keyboardAllows(scope,event.inlineMessageId,'i:'+event.btnId,record.component)) {store.discardEvent(record.eventId);return;}
    return queue.enqueueCommitted(record.agentId,event,'inline_button',()=>Boolean(resolveOwner(record.botId,record.agentId)),()=>store.markQueued(record.eventId));
  }
  return {
    async receive(botId,callback) {
      if(!callback?.inline_message_id)return false;
      try {
        if(ownedView(botId,callback.inline_message_id))return true;
        const duplicate=store.callbackEvent(botId,callback.id);if(duplicate){admit(duplicate);return true;}
        const btnId=/^i:([a-zA-Z0-9_-]+)$/.exec(callback.data??'')?.[1],definition=btnId&&store.button(botId,btnId);
        if(!definition)return true;
        const scope=resolveOwner(botId,definition.agentId);if(!scope||!keyboardAllows(scope,callback.inline_message_id,callback.data,definition.component))return true;
        const accepted=store.acceptButton({botId,callback,owner:scope});if(accepted.status==='accepted'||accepted.status==='duplicate')admit(accepted);
      } catch(error){onError(error);}
      finally{await telegram.call(botId,'answerCallbackQuery',{callback_query_id:callback.id}).catch(()=>{});}
      return true;
    },
    async drain(){for(const record of store.pendingEvents())try{admit(record);}catch(error){onError(error);}},
  };
}
