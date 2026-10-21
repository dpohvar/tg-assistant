import {ephemeralError} from './store.mjs';
import {readableDates} from '../agents/history.mjs';
import {NATIVE_SEND,planNativeEdit} from '../messages/edit-plan.mjs';
import {validateMessageFiles} from '../messages/actions.mjs';
import {destinationFields,topicIdOf} from '../telegram/topics.mjs';
import {prepareLocalMedia} from '../files/media.mjs';
const invalid=text=>ephemeralError('invalid_argument',text);
const positive=n=>Number.isSafeInteger(n)&&n>0;
const unsupportedButtons=value=>{
  if(!value||typeof value!=='object')return false;
  if(value.callback_data!==undefined||value.type==='buttons'||value.inline_keyboard?.length||value.keyboard?.length)return true;
  return Object.values(value).some(unsupportedButtons);
};
const resultError=error=>({error:error.code==='telegram_transport_failed'?'delivery_unknown':error.code??'telegram_failed',description:error.code==='telegram_api_error'?String(error.message).slice(0,1000):'The private operation was not confirmed. Do not repeat automatically or publish a public fallback.'});
const sendFields=new Set([...Object.keys(NATIVE_SEND),'caption','caption_entities','entities','parse_mode','reply_parameters','ephemeral_message_parameters','reply_markup','show_caption_above_media','disable_notification','protect_content','message_effect_id','title','performer']);
const editFields=new Set(['text','rich_message','photo','video','animation','document','audio','media','caption','caption_entities','parse_mode','entities','show_caption_above_media','reply_markup','link_preview_options']);
const nestedFields={location:['latitude','longitude','horizontal_accuracy'],venue:['latitude','longitude','title','address','foursquare_id','foursquare_type','google_place_id','google_place_type'],contact:['phone_number','first_name','last_name','vcard']};
export function createEphemeralMessages({db,store,telegram,access,assertCurrent,uploads=async()=>[]}){
  const locks=new Map();
  function locked(scope,args,work){
    const key=`${scope.botId}:${scope.chatId}:${args.ephemeralMessageId}:${args.receiverUserId}`;
    const result=(locks.get(key)??Promise.resolve()).catch(()=>{}).then(work);locks.set(key,result);
    result.finally(()=>{if(locks.get(key)===result)locks.delete(key);}).catch(()=>{});return result;
  }
  function address(scope,args,{outgoing=false,read=false}={}){
    assertCurrent(scope);
    if(['messageId','messageIds','inlineMessageId','guestRequestId'].some(key=>args[key]!==undefined)||args.chatId!==undefined&&args.chatId!==scope.chatId||!positive(args.ephemeralMessageId)||!read&&!positive(args.receiverUserId))throw invalid('Use a private address in the current chat alone.');
    access.assertRead(scope,scope.chatId);if(outgoing)access.assertWrite(scope,scope.chatId);
    const record=store.get(scope,args);
    if(outgoing&&record.direction!=='outgoing')throw invalid('Only the bot private response can be edited or deleted.');
    return record;
  }
  function validateBody(body,allowed,local){
    if(Object.keys(body).some(key=>!allowed.has(key)))throw invalid('Unsupported private message field.');
    if(unsupportedButtons(body))throw invalid('Interactive ephemeral buttons are not supported in this iteration.');
    const error=validateMessageFiles(body,local);if(error)throw ephemeralError(error.error,error.description);
  }
  const target=(scope,args)=>({chat_id:scope.chatId,receiver_user_id:args.receiverUserId,ephemeral_message_id:args.ephemeralMessageId});
  const api={
    read(scope,args){
      const record=address(scope,args,{read:true});if(Object.keys(args).some(key=>!['chatId','ephemeralMessageId','receiverUserId'].includes(key)))throw invalid('Private read accepts only its address.');
      const {message_id,...message}=readableDates(record.message);
      return {messages:[{...message,ephemeralMessageId:record.ephemeralMessageId,receiverUserId:record.receiverUserId,...(record.deliveryUnknown?{deliveryUnknown:true}:{})}]};
    },
    async send(scope,args){
      assertCurrent(scope);access.assertWrite(scope,scope.chatId);
      const {chatId=scope.chatId,topicId,uploads:legacy,file_sources,...input}=args;
      if(chatId!==scope.chatId||args.ephemeralMessageId!==undefined)throw invalid('Private sends use the current chat.');
      const {value:body,local}=prepareLocalMedia(input,legacy);
      validateBody(body,sendFields,local);
      const kinds=Object.keys(NATIVE_SEND).filter(key=>body[key]!==undefined);
      if(kinds.length!==1||['poll','dice','live_photo'].includes(kinds[0])||body.media!==undefined||body.location?.live_period)throw invalid('Specify one supported private content type; albums, polls, dice and live locations are unsupported.');
      let receiver=body.ephemeral_message_parameters?.receiver_user_id,source;
      if(body.ephemeral_message_parameters&&Object.keys(body.ephemeral_message_parameters).some(key=>key!=='receiver_user_id'))throw invalid('Only receiver_user_id is supported for a private send.');
      if(body.reply_parameters){
        if(Object.keys(body.reply_parameters).some(key=>key!=='ephemeral_message_id')||!positive(body.reply_parameters.ephemeral_message_id))throw invalid('A private reply requires only reply_parameters.ephemeral_message_id.');
        source=store.get(scope,{ephemeralMessageId:body.reply_parameters.ephemeral_message_id});
        if(source.direction!=='incoming'||receiver!==undefined&&receiver!==source.message.from.id)throw invalid('Private reply recipient does not match its source.');
        receiver=source.message.from.id;
      }
      if(!positive(receiver)||receiver===db.getBot(scope.botId)?.telegramId)throw invalid('A private user recipient is required.');
      body.ephemeral_message_parameters={receiver_user_id:receiver};
      const chat=JSON.parse(db.getChat(scope.botId,scope.chatId).json),topic=destinationFields({chat,topicId:topicId??(source?topicIdOf(source.message)??undefined:undefined),hasReply:!!source,replyMessage:source?.message});
      const kind=kinds[0];if(nestedFields[kind]){
        if(!body[kind]||typeof body[kind]!=='object'||Array.isArray(body[kind])||Object.keys(body[kind]).some(key=>!nestedFields[kind].includes(key)))throw invalid(`Unsupported private ${kind} field.`);
        Object.assign(body,body[kind]);delete body[kind];
      }
      let files;try{files=await uploads(scope,local);}catch{throw ephemeralError('file_unavailable','A local media file is unavailable or outside permitted paths.');}assertCurrent(scope);access.assertWrite(scope,scope.chatId);
      if(source)store.get(scope,{ephemeralMessageId:body.reply_parameters.ephemeral_message_id});
      let sent;try{sent=await telegram.call(scope.botId,NATIVE_SEND[kind],{...body,...topic,chat_id:scope.chatId},{uploads:files});}catch(error){return resultError(error);}
      if(!positive(sent?.ephemeral_message_id)||sent.receiver_user?.id!==receiver)return {error:'delivery_unknown',description:'Telegram did not confirm a usable private response address. Do not resend automatically.'};
      const response={ephemeralMessageId:sent.ephemeral_message_id,receiverUserId:receiver};
      try{store.record(scope,sent,{direction:'outgoing'});}catch{return {...response,error:'storage_failed',description:'Telegram sent the private response but its local snapshot could not be saved. Do not resend.'};}
      return response;
    },
    async edit(scope,args){
      const record=address(scope,args,{outgoing:true});if(record.deliveryUnknown)throw ephemeralError('delivery_unknown','A prior edit has an uncertain outcome. Do not repeat automatically.');
      const {chatId,ephemeralMessageId,receiverUserId,uploads:legacy,file_sources,...input}=args;
      const {value:body,local}=prepareLocalMedia(input,legacy);validateBody(body,editFields,local);
      const content=['text','rich_message','media','photo','video','animation','document','audio'].filter(key=>body[key]!==undefined);
      if(content.length>1||body.media&&['caption','caption_entities','parse_mode'].some(key=>body[key]!==undefined))throw invalid('Use one content kind and put media caption formatting inside media.');
      const methods={editMessageText:'editEphemeralMessageText',editMessageMedia:'editEphemeralMessageMedia',editMessageCaption:'editEphemeralMessageCaption',editMessageReplyMarkup:'editEphemeralMessageReplyMarkup'};
      const steps=planNativeEdit(record.message,body);if(!steps.length||steps.some(step=>!methods[step.method]))throw invalid('Unsupported private edit.');
      let files;try{files=await uploads(scope,local);}catch{throw ephemeralError('file_unavailable','A local media file is unavailable or outside permitted paths.');}const updated=[];
      for(const step of steps){
        if(address(scope,args,{outgoing:true}).deliveryUnknown)throw ephemeralError('delivery_unknown','A prior edit has an uncertain outcome. Do not repeat automatically.');
        try{await telegram.call(scope.botId,methods[step.method],{...target(scope,args),...step.fields},{uploads:files});}
        catch(error){
          if(!(error.code==='telegram_api_error'&&/message is not modified/i.test(error.message))){if(error.code==='telegram_transport_failed')store.markUnknown(scope,args);return {ephemeralMessageId,receiverUserId,updated,...resultError(error)};}
        }
        const part=step.fields.media?'media':step.fields.text!==undefined?'text':step.fields.rich_message!==undefined?'rich_message':step.fields.caption!==undefined?'caption':'reply_markup';updated.push(part);
        try{
          const patch={...step.fields,...(part==='text'?{rich_message:undefined}:part==='rich_message'?{text:undefined}:{})};
          if(step.fields.media){const media=step.fields.media;Object.assign(patch,{text:undefined,rich_message:undefined,[media.type]:media.media,snapshotComplete:false});delete patch.media;for(const key of ['caption','parse_mode','caption_entities'])if(media[key]!==undefined)patch[key]=media[key];}
          store.update(scope,args,patch);
        }catch{return {ephemeralMessageId,receiverUserId,updated,error:'storage_failed',description:'Telegram confirmed the edit but local snapshot storage failed. Do not repeat confirmed edits.'};}
      }
      return {ephemeralMessageId,receiverUserId,updated};
    },
    async delete(scope,args){
      address(scope,args,{outgoing:true});if(Object.keys(args).some(key=>!['chatId','ephemeralMessageId','receiverUserId'].includes(key)))throw invalid('Private delete accepts only its address.');
      try{await telegram.call(scope.botId,'deleteEphemeralMessage',target(scope,args));}catch(error){if(error.code==='telegram_transport_failed')store.markUnknown(scope,args);return resultError(error);}
      try{store.markDeleted(scope,args);}catch{return {error:'storage_failed',description:'Telegram deleted the response but its local snapshot could not be marked deleted.'};}
      return {ephemeralMessageId:args.ephemeralMessageId,receiverUserId:args.receiverUserId,status:'deleted'};
    },
  };
  return {...api,edit:(scope,args)=>locked(scope,args,()=>api.edit(scope,args)),delete:(scope,args)=>locked(scope,args,()=>api.delete(scope,args))};
}
