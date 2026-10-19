import {readableDates} from '../agents/history.mjs';
import {prepareGuestResult} from './results.mjs';
import {guestError} from './store.mjs';

export function createGuestService({store,inlineStore,telegram,assertCurrent,resolveActor,receipts,db,access,isKnownMember=()=>false,now=Date.now,onError=()=>{}}) {
  const pending=new Map(),registrations=new Map();
  function assertRequest(scope,id) {
    assertCurrent(scope);const req=store.get(scope,id),actor=resolveActor(scope.botId,req.callerUserId);
    if(!actor||actor.agentId!==scope.agentId||isKnownMember(scope.botId,req.message.chat))throw guestError('guest_request_unavailable','The guest request owner is unavailable or the bot is now a known member.');
    return req;
  }
  function settle(id) {
    const item=registrations.get(id);if(!item)return;
    registrations.delete(id);pending.get(item.botId)?.delete(item.promise);item.resolve();
  }
  function register(receipt,{recover=false}={}) {
    const {scope,inlineMessageId,prepared,publicationId}=receipt;
    store.saveOutcome(publicationId,{status:'confirmed',inlineMessageId});
    inlineStore.claimOwner(scope,inlineMessageId);
    if(!recover||!inlineStore.read(scope,inlineMessageId))inlineStore.saveConfirmed(scope,inlineMessageId,prepared.snapshot);
  }
  const api={assertRequest,settle,
    prepare:(scope,body,origin='agent')=>prepareGuestResult(scope,body,{db,access,origin}),
    read(scope,args) {
      if(!args||Object.keys(args).some(key=>key!=='guestRequestId'))throw guestError('invalid_argument','Guest read accepts guestRequestId alone.');
      assertCurrent(scope);return {messages:[readableDates(store.get(scope,args.guestRequestId).message)]};
    },
    async send(scope,args) {
      try {
        if(!args||typeof args!=='object'||Array.isArray(args))throw guestError('invalid_argument','Use a guest send object.');
        const {guestRequestId,...body}=args;assertRequest(scope,guestRequestId);
        const prepared=api.prepare(scope,body),published=await api.publishPrepared(scope,{guestRequestId,prepared});
        api.complete(published.publicationId);return {inlineMessageId:published.inlineMessageId};
      }catch(error){
        return {error:error.code??'guest_publish_failed',description:String(error.message).slice(0,1000),...Object.fromEntries(['inlineMessageId','publicationId','previousInlineMessageIds'].filter(key=>error[key]!==undefined).map(key=>[key,error[key]]))};
      }
    },
    async publishPrepared(scope,{guestRequestId,prepared,viewId}) {
      const req=assertRequest(scope,guestRequestId);let attempt,receipt;
      try {
        // This synchronous stage creates independent evidence; no request is reserved.
        attempt=store.beginPublication(scope,{guestRequestId,prepared,viewId});
        inlineStore.registerPage(scope,[prepared]);
        receipt={publicationId:attempt.publicationId,guestRequestId,scope:{botId:scope.botId,agentId:scope.agentId,chatId:scope.chatId},expiresAt:req.expiresAt,prepared,...(viewId?{viewId}:{}),status:'prepared'};
        receipts.write(receipt);
      }catch{throw guestError('storage_failed','Guest publication preparation could not be saved; no Telegram send was attempted.',{noEffect:true});}
      let resolve;const promise=new Promise(r=>resolve=r),item={botId:scope.botId,promise,resolve,viewId,callbackData:new Set((prepared.definitions??[]).map(def=>'i:'+def.btnId))};
      registrations.set(attempt.publicationId,item);if(!pending.has(scope.botId))pending.set(scope.botId,new Set());pending.get(scope.botId).add(promise);
      let keepRegistration=false;
      try {
        assertRequest(scope,guestRequestId);
        let response;
        try {response=await telegram.call(scope.botId,'answerGuestQuery',{guest_query_id:req.queryId,result:prepared.native});}
        catch(error) {
          const unknown=error.code==='telegram_transport_failed',outcome={status:unknown?'unknown':'rejected',error:unknown?'delivery_unknown':error.code??'telegram_failed',description:String(error.message).slice(0,1000)};
          receipt={...receipt,...outcome};
          try{receipts.write(receipt);store.saveOutcome(attempt.publicationId,outcome);if(!unknown)receipts.done(attempt.publicationId);}catch{onError(guestError('storage_failed','Guest failure confirmation could not be saved.'));}
          let previous=[];try{previous=store.publications(scope,guestRequestId).filter(x=>x.status==='confirmed').map(x=>x.inlineMessageId);}catch{}
          throw guestError(outcome.error,unknown?'Telegram confirmation was not received. Do not retry automatically.':outcome.description,{publicationId:attempt.publicationId,...(previous.length?{previousInlineMessageIds:previous}:{})});
        }
        if(typeof response?.inline_message_id!=='string'||!response.inline_message_id){
          const outcome={status:'unknown',error:'delivery_unknown',description:'Telegram returned no identifiable inline message. Do not retry automatically.'};
          try{receipts.write({...receipt,...outcome});store.saveOutcome(attempt.publicationId,outcome);}catch{}
          throw guestError('delivery_unknown',outcome.description,{publicationId:attempt.publicationId});
        }
        receipt={...receipt,status:'confirmed',inlineMessageId:response.inline_message_id};item.inlineMessageId=receipt.inlineMessageId;
        let storageFailed=false;
        try{receipts.write(receipt);}catch{storageFailed=true;}
        try{register(receipt);}catch{storageFailed=true;}
        if(storageFailed)throw guestError('storage_failed','Telegram confirmed the guest answer but local registration failed. Do not resend automatically.',{publicationId:attempt.publicationId,inlineMessageId:receipt.inlineMessageId,confirmedTarget:{inlineMessageId:receipt.inlineMessageId}});
        keepRegistration=Boolean(viewId);
        return {publicationId:attempt.publicationId,inlineMessageId:receipt.inlineMessageId,message:prepared.snapshot};
      }finally{if(!keepRegistration)settle(attempt.publicationId);}
    },
    complete(id) {try{receipts.done(id);}catch{onError(guestError('storage_failed','Guest publication was confirmed but receipt cleanup failed.'));}finally{settle(id);}},
    hasPending(botId){return Boolean(pending.get(botId)?.size);},
    async waitRegistrations(botId,inlineMessageId,data){
      const unknown=!inlineMessageId||!inlineStore.owner(botId,inlineMessageId);
      const action=typeof data==='string'&&data.startsWith('i:');
      await Promise.allSettled([...registrations.values()].filter(item=>item.botId===botId&&(unknown||item.inlineMessageId===inlineMessageId)&&(data===undefined||item.inlineMessageId===inlineMessageId||(action?item.callbackData.has(data):Boolean(item.viewId)))).map(item=>item.promise));
    },
    async recover() {
      receipts.cleanup(now());
      for(let receipt of receipts.list()) {
        try {
          const req=store.get(receipt.scope,receipt.guestRequestId),actor=resolveActor(receipt.scope.botId,req.callerUserId);
          if(!actor||actor.agentId!==receipt.scope.agentId)continue;
          const known=store.publications(receipt.scope,receipt.guestRequestId).find(p=>p.publicationId===receipt.publicationId);
          if(known?.status==='confirmed')receipt={...receipt,status:'confirmed',inlineMessageId:known.inlineMessageId};
          if(receipt.status==='confirmed'&&receipt.inlineMessageId){register(receipt,{recover:true});if(!receipt.viewId||db.sql.prepare('SELECT 1 FROM widget_views WHERE viewId=? AND botId=? AND agentId=? AND inlineMessageId=?').get(receipt.viewId,receipt.scope.botId,receipt.scope.agentId,receipt.inlineMessageId))receipts.done(receipt.publicationId);}
          else store.saveOutcome(receipt.publicationId,{status:receipt.status==='rejected'?'rejected':'unknown',error:receipt.error??'delivery_unknown',description:receipt.description??'A publication was interrupted; do not resend automatically.'});
        }catch(error){if(error.code!=='guest_request_unavailable')onError(guestError('guest_recovery_failed','Local guest publication recovery could not complete.'));}
      }
    },
  };return api;
}
