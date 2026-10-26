import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';
export function guestMessage({id='query',userId=1,chatId=-50,text='@bot hello',...fields}={}) {
  return {message_id:7,date:1,guest_query_id:id,from:{id:userId,first_name:`User ${userId}`},chat:{id:chatId,type:chatId<0?'supergroup':'private'},text,entities:[{type:'mention',offset:text.indexOf('@'),length:4}],...fields};
}
export function guestFixture(t,{personal=true,telegram:effect,clock=Date.now,config,agentRun,profile={id:42,username:'bot',active_usernames:['bot','alias_bot']}}={}) {
  const db=openDatabase(':memory:');db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});db.saveChat('b',{id:1,type:'private'});
  const owner=personal?db.ensureAgent('b',1):null,calls=[],batches=[];
  const agent={run:async(scope,events)=>{batches.push({scope,events});await agentRun?.(scope,events);}};
  const c=createController({db,clock,config,telegram:{call:async(botId,method,args,options)=>{if(method==='getChat')return profile;calls.push({botId,method,args});return effect?effect(botId,method,args,options):true;}},agent});
  t.after(async()=>{c.close();await c.idle();db.close();});
  let sequence=100;
  return {db,c,agent,owner,calls,batches,scope:owner&&c.lifecycle.scope(owner),
    async receive(message=guestMessage()){await c.receive('b',{update_id:++sequence,guest_message:message});await c.queue.idle();},
  };
}
