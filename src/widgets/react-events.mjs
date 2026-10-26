/** Routes live React closures by the confirmed view, never by decoded inline IDs. */
export function createReactWidgetEvents({manager,telegram}) {
  const store=manager.store;
  const ack=(botId,id)=>telegram.call(botId,"answerCallbackQuery",{callback_query_id:id}).catch(()=>{});
  function hasToken(view,token) {
    const keyboard=view.projection?.replyMarkup?.inline_keyboard??[];
    if(keyboard.some(row=>row.some(button=>button.callback_data===token)))return true;
    const visit=value=>{
      if(!value||typeof value!=="object")return false;
      if((value.data===token&&value.type==="callback_data")||value.callback_data===token)return true;
      return Object.values(value).some(visit);
    };
    return visit(view.projection?.body);
  }
  return async(botId,update)=>{
    const callback=update.callback_query;
    if(!callback){
      const reply=update.message??update.channel_post;
      const reaction=update.message_reaction;
      if(reaction){
        if(!reaction.user?.id)return false;
        const found=store.byMessage(botId,reaction.chat.id,reaction.message_id);
        if(!found||found.status!=="active"||!manager.hasSubscription(found.view,"reaction"))return false;
        await manager.dispatchViewEvent(found,found.view,"reaction",{
          from:reaction.user,reaction,
        });
        return true;
      }
      if(!reply?.reply_to_message)return false;
      const source=reply.reply_to_message;
      const found=source.ephemeral_message_id&&reply.from?.id
        ?(()=>{const view=store.byTarget(botId,{chatId:reply.chat.id,
          receiverUserId:reply.from.id,ephemeralMessageId:source.ephemeral_message_id});
          return view?{...store.get(view.widgetId),view}:null;})()
        :source.message_id?store.byMessage(botId,reply.chat.id,source.message_id):null;
      if(!found||found.status!=="active"||!manager.hasSubscription(found.view,"reply"))return false;
      manager.touchEphemeral?.(found.view,reply.from?.id);
      await manager.dispatchViewEvent(found,found.view,"reply",{from:reply.from,message:reply});
      return true;
    }
    const match=/^w:(v[a-f0-9]{32}):[A-Za-z0-9_-]{16}$/.exec(callback.data??"");
    const tokenView=match?store.getView(match[1]):null;
    const message=callback.message;
    let addressed=null;
    if(message?.chat?.id&&Number.isSafeInteger(message.ephemeral_message_id))
      addressed=store.byTarget(botId,{chatId:message.chat.id,receiverUserId:callback.from?.id,
        ephemeralMessageId:message.ephemeral_message_id});
    else if(message?.chat?.id&&Number.isSafeInteger(message.message_id))
      addressed=store.byTarget(botId,{chatId:message.chat.id,messageId:message.message_id});
    else if(callback.inline_message_id)
      addressed=store.byTarget(botId,{inlineMessageId:callback.inline_message_id});
    if(!tokenView||tokenView.botId!==botId){
      if(addressed){await ack(botId,callback.id);return true;}
      return false;
    }
    if((addressed&&addressed.id!==tokenView.id)||
       (message&&!addressed)||
       (!message&&!callback.inline_message_id)||
       (!message&&tokenView.targetKind!=="inline")){
      await ack(botId,callback.id);return true;
    }
    const widget=store.get(tokenView.widgetId);
    if(!widget||widget.status!=="active"||tokenView.status!=="active"||
        tokenView.deliveryUnknown||!hasToken(tokenView,callback.data)){
      await ack(botId,callback.id);return true;
    }
    manager.touchEphemeral?.(tokenView,callback.from?.id);
    await manager.dispatchCallback(widget,tokenView,callback,()=>ack(botId,callback.id));
    return true;
  };
}
