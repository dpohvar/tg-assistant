import {roles} from '../access/scope.mjs';
export const isEphemeral = message => message?.ephemeral_message_id!==undefined||message?.receiver_user!==undefined;
const safeError=text=>Object.assign(new Error(text),{safe:true,commandReplyFailed:true});
export function createCommandReply({telegram,botId,message,now=Date.now,timers={setTimeout,clearTimeout}}){
  const ephemeral=isEphemeral(message),userId=message.from?.id,chatId=message.chat.id;
  let status,used=false,timer,ackJob,ackError,started=false,completed=false,closed=false;
  const abort=new AbortController();
  const assertOpen=()=>{if(closed)throw safeError('The command response is closed.');};
  const privateCall=async(method,args,options)=>{
    assertOpen();
    const signal=AbortSignal.any([abort.signal,options?.signal??AbortSignal.timeout(120000)]);
    try{return await telegram.call(botId,method,args,{...options,signal});}
    catch{throw safeError(closed?'The command response is closed.':'The private command reply could not be delivered.');}
  };
  const cancel=()=>{if(timer!==undefined){timers.clearTimeout(timer);timer=undefined;}};
  const settle=async()=>{cancel();await ackJob;if(ackError)throw ackError;};
  const parameters={ephemeral_message_parameters:{receiver_user_id:userId},reply_parameters:{ephemeral_message_id:message.ephemeral_message_id}};
  const target=()=>({chat_id:chatId,receiver_user_id:userId,ephemeral_message_id:status.ephemeral_message_id});
  const inWindow=()=>!Number.isFinite(message.date)||now()-message.date*1000<15000;
  const fresh=async body=>{
    assertOpen();
    if(!inWindow())throw safeError('The private reply window expired. Send the command again.');
    return privateCall('sendMessage',{chat_id:chatId,...body,...parameters});
  };
  const session={
    async start({processing=true}={}){
      assertOpen();
      if(!ephemeral||started)return;started=true;
      if(!Number.isSafeInteger(message.ephemeral_message_id)||message.ephemeral_message_id<=0||!Number.isSafeInteger(userId)||userId<=0)throw safeError('Invalid ephemeral command address.');
      if(!inWindow())throw safeError('The private reply window expired. Send the command again.');
      if(processing){timer=timers.setTimeout(()=>{
        timer=undefined;if(completed||closed)return;
        ackJob=fresh({text:'Processing…'}).then(result=>{status=result;if(!Number.isSafeInteger(status?.ephemeral_message_id))throw safeError('Telegram did not confirm the private acknowledgement.');}).catch(error=>{ackError=error;});
      },5000);timer?.unref?.();}
    },
    async invite(body){
      assertOpen();await settle();assertOpen();completed=true;
      if(!ephemeral)return telegram.call(botId,'sendMessage',{chat_id:chatId,...body,reply_parameters:{message_id:message.message_id}});
      return fresh(body);
    },
    async finish(){cancel();completed=true;await ackJob;if(ephemeral&&status&&!used)try{await telegram.call(botId,'deleteEphemeralMessage',target());}catch{}},
    async detachStatus(text){
      assertOpen();await settle();completed=true;
      let result;if(ephemeral){if(status){used=true;await privateCall('editEphemeralMessageText',{...target(),text});result=status;}else{result=await fresh({text});used=true;}}
      else result=await telegram.call(botId,'sendMessage',{chat_id:chatId,text,reply_parameters:{message_id:message.message_id}});
      const common={botId,chatId,requesterUserId:userId};
      if(ephemeral){if(!Number.isSafeInteger(result?.ephemeral_message_id))throw safeError('Telegram did not confirm the private acknowledgement.');return {...common,ephemeralMessageId:result.ephemeral_message_id,receiverUserId:userId};}
      if(!Number.isSafeInteger(result?.message_id))throw safeError('Telegram did not confirm the acknowledgement.');return {...common,messageId:result.message_id};
    },
    close(){closed=true;completed=true;cancel();abort.abort();},
  };
  session.telegram={...telegram,call:async(id,method,args={},options)=>{
    assertOpen();
    if(!ephemeral||id!==botId||args.chat_id!==chatId)return telegram.call(id,method,args,options);
    if(method==='deleteMessage'&&args.message_id===message.message_id)return telegram.call(id,'deleteEphemeralMessage',{chat_id:chatId,receiver_user_id:userId,ephemeral_message_id:message.ephemeral_message_id},options);
    const source=args.reply_parameters;
    if(!method.startsWith('send')||!source||(source.message_id!==message.message_id&&source.ephemeral_message_id!==message.ephemeral_message_id))return telegram.call(id,method,args,options);
    await session.start();await settle();assertOpen();completed=true;
    if(method==='sendMessage'){
      const {reply_parameters,ephemeral_message_parameters,message_thread_id,...body}=args;
      if(status&&!used){used=true;await privateCall('editEphemeralMessageText',{...body,...target()},options);return {...status,...body};}
      return fresh(body);
    }
    if(method==='sendDocument'){
      if(!status){if(!inWindow())throw safeError('The private reply window expired. Send the command again.');return privateCall(method,{...args,...parameters},options);}
      if(used)throw safeError('This command response cannot be sent privately.');
      used=true;const media={type:'document',media:args.document};
      for(const key of ['caption','parse_mode','caption_entities','disable_content_type_detection'])if(args[key]!==undefined)media[key]=args[key];
      return privateCall('editEphemeralMessageMedia',{...target(),media,...(args.reply_markup?{reply_markup:args.reply_markup}:{})},options);
    }
    throw safeError('This command response cannot be sent privately.');
  }};
  return session;
}
export async function updateControlReply({telegram,db},target,text){
  if(!target||!db.getBot(target.botId)||!db.getChat(target.botId,target.chatId)||(roles[db.role(target.botId,target.requesterUserId)]??0)<(roles[target.requiredRole??'user']))return;
  const args={chat_id:target.chatId,text};
  if(target.ephemeralMessageId!==undefined){Object.assign(args,{ephemeral_message_id:target.ephemeralMessageId,receiver_user_id:target.receiverUserId});await telegram.call(target.botId,'editEphemeralMessageText',args);}
  else {args.message_id=target.messageId;await telegram.call(target.botId,'editMessageText',args);}
}
