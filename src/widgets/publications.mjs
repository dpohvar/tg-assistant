import { plainJSON, widgetError } from "./contract.mjs";
import { NATIVE_SEND } from "../messages/edit-plan.mjs";
import { messageAddress } from "../messages/address.mjs";
import { viewLossReason } from "./errors.mjs";
import { prepareWidgetMedia, cacheWidgetMedia } from "./media.mjs";

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const kindOf=body=>["rich_message","dice","sticker"].find(key=>body?.[key]!==undefined);
const transportUnknown=error=>["telegram_transport_failed","delivery_unknown","storage_failed"].includes(error?.code);
const diagnostic=error=>({code:error?.code??"telegram_api_error",message:String(error?.message??error).slice(0,1000)});

/** Controller-owned serialization and acknowledgement for React view projections. */
export function createReactPublications({store,telegram,authorize=()=>{},guest,receipts,filesFor,closeOverlays=async()=>[],messageSerial}) {
  const lanes=new Map(),unknownViews=new Set(),revokedViews=new Set(),mediaCaches=new Map(),parentVersions=new Map();
  function serialize(key,operation){
    const previous=lanes.get(key)??Promise.resolve();
    const task=previous.catch(()=>{}).then(operation);
    lanes.set(key,task);
    task.finally(()=>{if(lanes.get(key)===task)lanes.delete(key);}).catch(()=>{});
    return task;
  }
  function validate(input){
    if(!input || typeof input!=="object")throw widgetError("invalid_argument");
    const body=JSON.parse(plainJSON(input.body)),kind=kindOf(body);
    if(!kind || Object.keys(body).filter(key=>["rich_message","dice","sticker"].includes(key)).length!==1)
      throw widgetError("invalid_argument","Projection must contain one supported body.");
    if(kind==="rich_message"&&(!Array.isArray(body.rich_message?.blocks)||!body.rich_message.blocks.length))
      throw widgetError("invalid_argument","Rich message must contain at least one block.");
    const replyMarkup=input.replyMarkup===null||input.replyMarkup===undefined?null:JSON.parse(plainJSON(input.replyMarkup));
    if(replyMarkup && !Array.isArray(replyMarkup.inline_keyboard))throw widgetError("invalid_argument");
    if(!Number.isSafeInteger(input.storeRevision)||input.storeRevision<0)
      throw widgetError("invalid_argument","Store revision is required.");
    return {body,kind,replyMarkup};
  }
  function address(target){
    if(target.inlineMessageId)return {inline_message_id:target.inlineMessageId};
    if(target.ephemeralMessageId)return {chat_id:target.chatId,receiver_user_id:target.receiverUserId,
      ephemeral_message_id:target.ephemeralMessageId};
    return messageAddress(target);
  }
  async function call(ref,method,args,uploads=[]) {
    authorize(ref,args.chat_id);
    return telegram.call(ref.botId,method,args,{uploads});
  }
  async function removeLatePrivate(ref,viewId,target,closedOverlayIds=[]){
    try{
      await telegram.call(ref.botId,"deleteEphemeralMessage",{
        chat_id:target.chatId,receiver_user_id:target.receiverUserId,
        ephemeral_message_id:target.ephemeralMessageId});
      receipts?.done(ref,viewId);
      return {status:"removed",reason:"stale_private_publication",closedOverlayIds};
    }catch(error){
      unknownViews.add(viewId);
      try{store.addCandidate(ref,{viewId,target,reason:"late_overlay_delete_failed"});}catch{}
      return {status:"unknown",error:diagnostic(error),confirmedTarget:target,closedOverlayIds};
    }
  }
  async function publishOne(ref,viewId,input,normalized){
    if(revokedViews.has(viewId))throw widgetError("view_not_found","This view was detached.");
    const widget=store.current(ref);
    if(widget.status!=="active")throw widgetError("widget_stopped");
    if(widget.storeRevision<input.storeRevision)throw widgetError("state_not_saved","Store revision must be persisted before publication.");
    let view=store.getView(viewId);
    if(view && view.widgetId!==ref.widgetId)throw widgetError("view_conflict");
    if(view?.deliveryUnknown)throw widgetError("delivery_unknown","Inspect the prior edit before retrying.");
    if(!view&&(unknownViews.has(viewId)||store.getCandidate(viewId)))
      throw widgetError("delivery_unknown","Inspect the prior send before retrying.");
    if(view && input.bindingEpoch && view.bindingEpoch!==input.bindingEpoch)
      throw widgetError("view_not_found","Binding epoch changed.");
    const target=view?.target??input.target;
    if(!target)throw widgetError("invalid_argument","A target is required for the first mount.");
    const other=!view && (target.inlineMessageId||target.messageId||target.ephemeralMessageId)
      ?store.byTarget(ref.botId,target):null;
    if(other)throw Object.assign(widgetError("view_conflict"),{ownerAgentId:other.agentId,viewId:other.id});
    const cache=mediaCaches.get(viewId)??new Map();
    mediaCaches.set(viewId,cache);
    const prepared=filesFor?prepareWidgetMedia(normalized.body,{files:filesFor(ref),cache}):
      {value:normalized.body,uploads:[],manifest:[],signatures:[]};
    if(target.inlineMessageId&&prepared.uploads.length)
      throw widgetError("invalid_argument","Inline messages require existing file IDs or public URLs.");
    const projected={body:normalized.body,replyMarkup:normalized.replyMarkup,
      ...(prepared.signatures.length?{mediaSignatures:prepared.signatures}:{})};
    const prior=view?.projection;
    if(prior && same(projected,prior))return {status:"unchanged",view};
    if(prior && (kindOf(prior.body)!==normalized.kind ||
        (normalized.kind!=="rich_message"&&!same(prior.body,normalized.body))))
      throw widgetError("render_failed","Native body cannot be changed after sending.");
    const markup=normalized.replyMarkup??{inline_keyboard:[]};
    const creating=!view&&!target.messageId&&!target.inlineMessageId&&!target.ephemeralMessageId;
    const parentVersion=input.parentViewId?parentVersions.get(input.parentViewId)??0:null;
    let method,args,confirmedTarget=target,receipt;
    if(target.guestRequestId){
      if(!guest?.publish)throw widgetError("invalid_argument","Guest transport is unavailable.");
      method="guest";
    } else if(creating){
      if(!Number.isSafeInteger(target.chatId))throw widgetError("invalid_argument","New sends require an authorized chat.");
      if(target.receiverUserId && normalized.kind==="dice")
        throw widgetError("invalid_argument","Dice cannot be sent as a standalone ephemeral view.");
      method=NATIVE_SEND[normalized.kind];
      const body=normalized.kind==="dice"?{...prepared.value.dice}:prepared.value;
      args={chat_id:target.chatId,...(target.topicId?{message_thread_id:target.topicId}:{}),
        ...(target.reply_parameters?{reply_parameters:target.reply_parameters}:{}),
        ...(target.receiverUserId?{ephemeral_message_parameters:{
          receiver_user_id:target.receiverUserId,
          ...(target.callbackQueryId?{callback_query_id:target.callbackQueryId}:{}),
          ...(target.replaceCallbackQueryMessage?{replace_callback_query_message:true}:{}),
        }}:{}),
        ...body,...(normalized.replyMarkup?{reply_markup:normalized.replyMarkup}:{})};
    } else {
      if(normalized.kind==="rich_message" && (!prior||!same(prior.body,normalized.body))){
        method="editMessageText";
        args={...address(target),...prepared.value,reply_markup:markup};
      } else {
        method="editMessageReplyMarkup";
        args={...address(target),reply_markup:markup};
      }
      if(target.ephemeralMessageId){
        method=method==="editMessageText"?"editEphemeralMessageText":"editEphemeralMessageReplyMarkup";
      }
    }
    if(view&&view.targetKind!=="ephemeral")
      parentVersions.set(viewId,(parentVersions.get(viewId)??0)+1);
    const closedOverlayIds=view&&view.targetKind!=="ephemeral"
      ?await closeOverlays(ref,viewId):[];
    receipts?.write(ref,{id:viewId,target},null);
    try {
      receipt=method==="guest"?await guest.publish(ref,target,{
        ...normalized.body,...(normalized.replyMarkup?{reply_markup:normalized.replyMarkup}:{})
      }):await call(ref,method,args,prepared.uploads);
    } catch(error) {
      if(transportUnknown(error)){
        unknownViews.add(viewId);
        if(view)store.patchView(ref,viewId,{status:"error",lastError:diagnostic(error),deliveryUnknown:true});
        else try{store.addCandidate(ref,{viewId,target,reason:"delivery_unknown"});}catch{}
        return {status:"unknown",error:diagnostic(error),target,closedOverlayIds};
      }
      const loss=view?viewLossReason(error):null;
      if(loss){store.detachView(ref,viewId);receipts?.done(ref,viewId);return {status:"removed",error:diagnostic(error),reason:loss,closedOverlayIds};}
      if(view){const updated=store.patchView(ref,viewId,{status:"error",lastError:diagnostic(error)});
        receipts?.done(ref,viewId);
        return {status:"view_error",view:updated,error:diagnostic(error),closedOverlayIds};}
      receipts?.done(ref,viewId);
      return {status:"view_error",error:diagnostic(error),closedOverlayIds};
    }
    if(method==="guest"){
      if(typeof receipt?.inlineMessageId!=="string"||!receipt.inlineMessageId){
        unknownViews.add(viewId);
        try{store.addCandidate(ref,{viewId,target,reason:"guest_confirmation_missing"});}catch{}
        return {status:"unknown",error:{code:"delivery_unknown",message:"Guest publication address was not confirmed."},target};
      }
      confirmedTarget={inlineMessageId:receipt.inlineMessageId};
    }
    else if(creating){
      if(target.receiverUserId){
        if(!Number.isSafeInteger(receipt?.ephemeral_message_id)||
            receipt?.receiver_user?.id!==target.receiverUserId){
          unknownViews.add(viewId);
          try{store.addCandidate(ref,{viewId,target,reason:"ephemeral_confirmation_missing"});}catch{}
          return {status:"unknown",error:{code:"delivery_unknown",message:"Telegram returned no confirmed private address."},target};
        }
        confirmedTarget={chatId:target.chatId,receiverUserId:target.receiverUserId,
          ephemeralMessageId:receipt.ephemeral_message_id};
      } else {
        if(!Number.isSafeInteger(receipt?.message_id)){
          unknownViews.add(viewId);
          try{store.addCandidate(ref,{viewId,target,reason:"message_confirmation_missing"});}catch{}
          return {status:"unknown",error:{code:"delivery_unknown",message:"Telegram returned no confirmed message ID."},target};
        }
        confirmedTarget={chatId:target.chatId,messageId:receipt.message_id};
      }
    }
    if(input.parentViewId && (!store.getView(input.parentViewId)||
        parentVersions.get(input.parentViewId)!==undefined&&
          parentVersions.get(input.parentViewId)!==parentVersion)){
      return removeLatePrivate(ref,viewId,confirmedTarget,closedOverlayIds);
    }
    if(method!=="guest"&&creating){
      try{cacheWidgetMedia(prepared,receipt,cache);}catch{}
    }
    try {store.current(ref);} catch {
      if(confirmedTarget.ephemeralMessageId)
        return removeLatePrivate(ref,viewId,confirmedTarget,closedOverlayIds);
      unknownViews.add(viewId);
      return {status:"unknown",reason:"stale_generation",confirmedTarget};
    }
    try {
      receipts?.write(ref,{id:viewId,target:confirmedTarget},{message:receipt,projection:projected});
      if(!view) view=store.createView(ref,{id:viewId,target:confirmedTarget,
        parentViewId:input.parentViewId??null,
        exportName:input.component,props:input.props??{},message:receipt&&typeof receipt==="object"?receipt:null,
        projection:projected,bindingEpoch:input.bindingEpoch});
      else view=store.patchView(ref,viewId,{status:"active",lastError:null,
        message:receipt&&typeof receipt==="object"?receipt:view.message,
        projection:projected,deliveryUnknown:false});
      receipts?.done(ref,viewId);
      if(method==="guest")try{await guest.complete?.(receipt.publicationId);}catch{}
      return {status:"confirmed",view,target:confirmedTarget,closedOverlayIds};
    } catch(error) {
      unknownViews.add(viewId);
      if(!view)try{store.addCandidate(ref,{viewId,target:confirmedTarget,reason:"storage_failed_after_send"});}catch{}
      return {status:"unknown",error:{code:"storage_failed",message:String(error.message)},
        confirmedTarget,confirmedMessageId:confirmedTarget.messageId??null};
    }
  }
  return {
    invalidateParent(viewId){parentVersions.set(viewId,(parentVersions.get(viewId)??0)+1);},
    invalidateView(viewId){revokedViews.add(viewId);},
    publish(ref,viewId,input) {
      const normalized=validate(input);
      const existing=store.getView(viewId),target=existing?.target??input.target;
      const key=JSON.stringify([ref.botId,existing?.target??target??viewId]);
      return serialize(key,()=>target?.messageId&&messageSerial
        ?messageSerial.run({botId:ref.botId,chatId:target.chatId,messageId:target.messageId},
          ()=>publishOne(ref,viewId,input,normalized))
        :publishOne(ref,viewId,input,normalized));
    },
  };
}
