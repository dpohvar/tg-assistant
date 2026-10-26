import {openDatabase} from '../../src/storage/database.mjs';
import {createWidgetStore} from '../../src/widgets/store.mjs';
import {createWidgetManager} from '../../src/widgets/manager.mjs';
import {createWidgetRenderer} from '../../src/widgets/render.mjs';
import {createRuntime} from '../../src/widgets/runtime.mjs';
import {createWidgetEvents} from '../../src/widgets/events.mjs';

export async function widgetFixture(t,options={}) {
  const db=openDatabase(':memory:');
  db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});
  db.saveChat('b',{id:1,type:'private',first_name:'Owner'});
  db.saveChat('b',{id:-100123,type:'supergroup',title:'Group'});
  const agent=db.ensureAgent('b',1),scope={botId:'b',agentId:agent.agentId,chatId:1};
  const store=createWidgetStore(db),telegramCalls=[],handled=[],notices=[];
  let manager,renderer,nextMessageId=7,nextError,block;
  const messages=new Map(),loaded=new Set();
  const module={
    render(state,view){return {text:`${view?.props.part??'game'}:${state.count??0}`,reply_markup:{inline_keyboard:[[{text:'+',callback_data:'increment'}]]}};},
    increment(ctx,event){handled.push(event);ctx.state.count=(ctx.state.count??0)+1;},
    onReply(_ctx,event){handled.push(event);},
    ...options.module,
  };
  const telegram={async call(botId,method,args){
    telegramCalls.push({botId,method,args:structuredClone(args)});
    if(block&&method.startsWith('edit')){const current=block;block=null;current.enter();await current.promise;}
    if(nextError){const error=nextError;nextError=null;throw error;}
    if(method==='answerCallbackQuery')return true;
    if(method==='answerGuestQuery')return {inline_message_id:'guest-'+nextMessageId++};
    if(args.inline_message_id)return true;
    const id=args.message_id??nextMessageId++,key=`${args.chat_id}/${id}`;
    const message={...(messages.get(key)??{}),message_id:id,date:1,chat:{id:args.chat_id,type:args.chat_id===1?'private':'supergroup'},from:{id:42,is_bot:true},...args};
    delete message.chat_id;delete message.message_id;message.message_id=id;
    messages.set(key,message);return message;
  }};
  const guest=options.guestFactory?.({db,scope,telegram,store});
  const runtime=createRuntime({bridge:async(method,args)=>{
    if(method==='save')return store.save(args.ref,{state:args.state});
    if(method==='views')return store.listViews(args.ref.widgetId);
    if(method==='publish')return manager.publish(args.ref,args.viewId,args.value);
    if(method==='notifyError')return manager.error(args.ref,args.error,args.viewId,{quiet:args.quiet});
    if(method==='begin')return {event:await manager.begin(args.ref,args.token),dropped:0};
    if(method==='complete'||method==='drop')return manager.complete(args.ref,args.token??args.event.token);
    if(method==='respond')return telegram.call('b','answerCallbackQuery',{callback_query_id:args.callbackId});
    if(method==='api'&&args.name==='delete_widget')return manager.delete(scope,args.args,{self:args.args.widgetId===args.ref.widgetId});
    if(method==='api'&&options.api)return options.api(args.name,args.args);
    throw new Error(`Unexpected bridge ${method}`);
  }});
  const host={canReserve:()=>true,has:r=>loaded.has(r.widgetId),reserve:async()=>{},
    load:async(ref,args)=>{loaded.add(ref.widgetId);return runtime.load(ref,{...args,module,viewMode:true});},
    request:async(ref,method,args)=>{if(method==='retire')loaded.delete(ref.widgetId);return method==='hook'?runtime.hook(ref,args.name,args):runtime[method](ref,args);},
    release:async()=>{},close:()=>runtime.close()};
  renderer=createWidgetRenderer({db,store,telegram,guest,filesFor:()=>({}),authorize:(_ref,target)=>{
    if(target!==undefined&&!Number.isSafeInteger(target))throw Object.assign(new Error('Invalid chatId'),{code:'invalid_argument'});
    return scope;
  }});
  manager=createWidgetManager({db,store,host,guest,render:renderer,build:async()=>({snapshotId:'snapshot'}),authorize:()=>scope,assertInlineOwner:()=>{},notify:async(_r,event)=>notices.push(event),ackCallback:id=>telegram.call('b','answerCallbackQuery',{callback_query_id:id}),...options.managerOptions});
  const receive=createWidgetEvents({db,manager,telegram});
  t.after(async()=>{await manager.close();db.close();});
  return {db,store,scope,host,runtime,manager,renderer,module,telegram,telegramCalls,handled,notices,
    receiveButton:(target,data='increment')=>receive('b',{callback_query:{id:'callback-'+Math.random(),from:{id:1},data,...(target.inlineMessageId?{inline_message_id:target.inlineMessageId}:{message:{message_id:target.messageId,chat:{id:target.chatId}}})}}),
    receiveReply:(target,text='hello')=>receive('b',{message:{message_id:99,chat:{id:target.chatId},from:{id:1},text,reply_to_message:{message_id:target.messageId}}}),
    failNextEdit(code='telegram_api_error',message='Bad Request: failed'){nextError=Object.assign(new Error(message),{code});},
    blockNextPublish(){let enter,release,fail;const entered=new Promise(r=>enter=r),promise=new Promise((resolve,reject)=>{release=resolve;fail=reject;});block={enter,promise};return {entered,release,fail};},
    async idle(){for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));await manager.idle();},
    async withOneView(){const w=await manager.create(scope,{handler:'counter.tsx',description:'Counter'});const v=await manager.setView(scope,{widgetId:w.widgetId,send:{}});return {...w,...v};},
  };
}
