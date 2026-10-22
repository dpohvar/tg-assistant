import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {BrowseFiles,MAX_BYTES} from './files.mjs';
import {renderBrowse} from './render.mjs';
import {topicIdOf} from '../telegram/topics.mjs';
import {isEphemeral} from '../commands/replies.mjs';

const TTL=3600000,CACHE_BYTES=64*1024*1024;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity=m=>hash({date:m.date,from:m.from?.id,text:m.text,entities:m.entities??[],receiver:m.receiver_user?.id});
const positive=n=>Number.isSafeInteger(n)&&n>0;
const address=m=>({chatId:m.chat.id,ephemeral:isEphemeral(m),id:m.ephemeral_message_id??m.message_id,receiver:m.receiver_user?.id,date:m.date});
const same=(a,m)=>a&&a.chatId===m?.chat?.id&&a.ephemeral===isEphemeral(m)&&a.id===(m.ephemeral_message_id??m.message_id)&&(!a.ephemeral||a.receiver===m.receiver_user?.id)&&a.date===m.date;
const noop=()=>{};

export function createBrowse({db,config,telegram,fetchDocument,now=Date.now,onError=noop,run=(_bot,fn)=>fn()}){
  const sessions=new Map(),jobs=new Set(),operations=new Map();let closed=false;
  const key=(bot,user)=>`${bot}:${user}`;
  const track=promise=>{jobs.add(promise);promise.finally(()=>jobs.delete(promise)).catch(noop);return promise;};
  const gated=(bot,fn)=>{const job=(operations.get(bot)??Promise.resolve()).catch(noop).then(()=>run(bot,fn));operations.set(bot,job);job.finally(()=>{if(operations.get(bot)===job)operations.delete(bot);}).catch(noop);return job;};
  const role=(bot,user)=>{if(!db.getBot(bot)||!['admin','owner'].includes(db.role(bot,user)))throw new Error('Access denied. Admin or owner required.');};
  function assert(s){if(closed||!s.active||sessions.get(key(s.botId,s.userId))!==s)throw new Error('Browse session is closed.');role(s.botId,s.userId);}
  function dispose(s){s.active=false;s.invitation=null;s.confirmation=null;s.cache.clear();s.attachment=null;if(s.view)s.view.actions.clear();sessions.delete(key(s.botId,s.userId));}
  const sweep=()=>{for(const s of sessions.values())if(!s.busy&&now()-s.touched>=TTL)dispose(s);};
  const timer=setInterval(sweep,60000);timer.unref?.();
  function errorText(s,error){if(error.code==='ENOENT')return 'File or directory no longer exists.';if(error.code==='EACCES'||error.code==='EPERM')return 'File access denied.';return String(error.message??'Operation failed.').replaceAll(s.files.store.root,'[bot root]').slice(0,500);}
  function cache(s,id,item){
    const old=s.cache.get(id);if(old)return old;
    let size=[...s.cache.values()].reduce((n,e)=>n+e.bytes.length,0);
    for(const [key,value] of s.cache){if(size+item.bytes.length<=CACHE_BYTES)break;if(s.attachment===value)continue;s.cache.delete(key);size-=value.bytes.length;}
    if(size+item.bytes.length>CACHE_BYTES)throw new Error('Prepared media cache is full. Open another object and retry.');
    item={...item,key:id};s.cache.set(id,item);return item;
  }
  function observe(s,view,m){
    for(const entry of view.manifest??[]){
      const block=m.rich_message?.blocks?.[entry.index];let file=block?.[entry.role];
      if(Array.isArray(file))file=[...file].sort((a,b)=>(b.width??0)*(b.height??0)-(a.width??0)*(a.height??0))[0];
      if(file?.file_id&&s.cache.has(entry.key))s.cache.get(entry.key).fileId=file.file_id;
    }
  }
  function clearMedia(s){s.cache.clear();s.attachment=null;}
  async function mutate(s,plan,assert){try{await s.files.apply(plan,{assert});}finally{clearMedia(s);}}
  async function publish(s){
    const view=s.view;
    const promise=(view.tail??Promise.resolve()).catch(noop).then(async()=>{
      assert(s);if(s.view!==view)return;
      let info;
      try{info=s.files.info(s.path);}catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;s.path=path.posix.dirname(s.path);s.page=0;s.attachment=null;info=s.files.info(s.path);}
      let entries=info.directory?s.files.list(s.path):[],preview=info.directory?null:s.files.preview(s.path),image;
      s.page=Math.min(s.page,Math.max(0,Math.ceil(entries.length/10)-1));
      if(!info.directory){const id=`photo:${info.path}:${info.version}`;if(!s.failedImages.has(id)){image=s.cache.get(id);if(!image){const prepared=s.files.image(info.path);if(prepared)image=cache(s,id,prepared);}}}
      let clipboardDirectory=false;try{clipboardDirectory=s.clipboard&&s.files.info(s.clipboard).directory;}catch{}
      const revision=view.revision+1,actions=new Map(),manifest=[],uploads=[];
      const button=(text,action,style)=>{
        if(s.busy)return {text,disabled:{}};
        const data=`br:${view.nonce}:${revision}:${actions.size}`;actions.set(data,action);return {text,callback_data:data,...(style?{style}:{})};
      };
      const media=(entry,type,index)=>{
        manifest.push({key:entry.key,role:type,index});if(entry.fileId)return entry.fileId;
        const name='browse_media_'+uploads.length;uploads.push({name,bytes:entry.bytes,filename:entry.filename});return 'attach://'+name;
      };
      const rich=renderBrowse({info,entries,page:s.page,preview,image,attachment:s.attachment,clipboard:s.clipboard,clipboardDirectory,confirmation:s.confirmation,status:s.status,busy:s.busy},button,media);
      // Publish action ownership only after Telegram confirms the matching render.
      let result;
      try{
        if(!view.address){
          const m=view.source,privateRoute=isEphemeral(m);
          if(privateRoute&&now()-m.date*1000>=15000)throw new Error('Private reply window expired. Send /browse again.');
          result=await telegram.call(s.botId,'sendRichMessage',{chat_id:m.chat.id,rich_message:rich,...(topicIdOf(m)>1?{message_thread_id:topicIdOf(m)}:{}),...(privateRoute?{ephemeral_message_parameters:{receiver_user_id:s.userId},reply_parameters:{ephemeral_message_id:m.ephemeral_message_id}}:{reply_parameters:{message_id:m.message_id}})},{uploads});
          if(!result||!positive(result.ephemeral_message_id??result.message_id)||result.chat?.id!==m.chat.id||result.from?.id!==db.getBot(s.botId)?.telegramId||privateRoute&&result.receiver_user?.id!==s.userId)throw Object.assign(new Error('Telegram did not confirm the browse address.'),{code:'telegram_transport_failed'});
          view.address=address(result);
        }else{
          const a=view.address,method=a.ephemeral?'editEphemeralMessageText':'editMessageText';
          result=await telegram.call(s.botId,method,{chat_id:a.chatId,...(a.ephemeral?{ephemeral_message_id:a.id,receiver_user_id:s.userId}:{message_id:a.id}),rich_message:rich},{uploads});
        }
      }catch(error){
        if(!(error.code==='telegram_api_error'&&/message is not modified/i.test(error.message))){
          if(error.code==='telegram_transport_failed'){s.unknown=true;view.actions.clear();}
          else if(image&&error.code==='telegram_api_error'){
            if(s.failedImages.size>=256)s.failedImages.delete(s.failedImages.values().next().value);
            s.failedImages.add(image.key);s.cache.delete(image.key);error.browsePreviewKey=image.key;
          }
          throw error;
        }
      }
      view.revision=revision;view.actions=actions;view.manifest=manifest;
      if(result&&typeof result==='object')observe(s,view,result);
    });
    view.tail=promise;
    return promise.catch(error=>{
      // A confirmed API rejection had no effect. Retry once without the optional
      // preview; never do this for an unknown transport outcome.
      if(error.browsePreviewKey&&s.active&&s.view===view&&!closed){s.status='Image preview unavailable; the file can still be downloaded.';return publish(s);}
      throw error;
    });
  }
  async function removeView(s,view){
    view.actions.clear();await view.tail?.catch(noop);const a=view.address;if(!a)return;
    try{await telegram.call(s.botId,a.ephemeral?'deleteEphemeralMessage':'deleteMessage',{chat_id:a.chatId,...(a.ephemeral?{receiver_user_id:s.userId,ephemeral_message_id:a.id}:{message_id:a.id})});}
    catch(error){s.status='Previous browse could not be deleted; its controls are inactive.';onError(error);}
  }
  function operation(s,status,fn){
    if(s.busy)throw new Error('Browse is busy.');s.busy=true;s.status=status;
    return track((async()=>{
      try{await publish(s);assert(s);await gated(s.botId,()=>fn(()=>assert(s)));s.status=s.confirmation?'Confirmation required.':'Done.';}
      catch(error){s.confirmation=null;s.status='Failed: '+errorText(s,error);onError(error);}
      finally{s.busy=false;if(s.active&&!closed&&!s.unknown)try{await publish(s);}catch(error){onError(error);}}
    })());
  }
  async function invitation(s,cb,selected,view){
    if(s.view!==view)return;
    const info=s.files.info(selected),text=`Attach a document as a reply to THIS message to ${info.directory?'upload into':'replace'} ${selected}.`;
    const args={chat_id:view.address.chatId,text,...(topicIdOf(view.source)>1?{message_thread_id:topicIdOf(view.source)}:{}),...(view.address.ephemeral?{ephemeral_message_parameters:{receiver_user_id:s.userId,callback_query_id:cb.id}}:{reply_parameters:{message_id:view.address.id}})};
    const result=await telegram.call(s.botId,'sendMessage',args);
    assert(s);if(s.view!==view)return;
    if(!positive(result?.ephemeral_message_id??result?.message_id)||result.from?.id!==db.getBot(s.botId)?.telegramId||result.chat?.id!==view.address.chatId||view.address.ephemeral&&result.receiver_user?.id!==s.userId)throw new Error('Upload invitation address was not confirmed.');
    s.invitation={address:address(result),fingerprint:identity(result),target:info.path,targetDirectory:info.directory,targetVersion:info.version,topic:topicIdOf(result),expires:now()+TTL,view};s.status='Reply to the upload invitation with a document.';
  }
  async function action(s,entry,cb){
    const files=s.files,selected=s.path,view=s.view;
    if(['open','page','refresh','copy','cancel'].includes(entry.action)){
      if(entry.action==='open'){files.info(entry.path);s.path=entry.path;s.page=0;s.attachment=null;s.confirmation=null;}
      if(entry.action==='page')s.page=entry.page;
      if(entry.action==='copy'){files.info(s.path);s.clipboard=s.path;}
      if(entry.action==='cancel')s.confirmation=null;
      s.status='';await publish(s);return;
    }
    if(entry.action==='upload')return operation(s,'Preparing upload invitation…',async()=>invitation(s,cb,selected,view));
    if(entry.action==='download'){
      s.attachment=null;
      return operation(s,files.info(selected).directory?'Creating archive…':'Uploading…',async assert=>{
        const media=await files.archive(selected,{assert});assert();
        for(const [key,value] of s.cache)if(value.path===selected&&key.startsWith('document:'))s.cache.delete(key);
        const id='document:'+selected+':'+randomBytes(8).toString('hex');const item=cache(s,id,{...media,path:selected});
        if(s.path===selected)s.attachment=item;
      });
    }
    if(entry.action==='delete')return operation(s,'Preparing deletion…',async assert=>{const plan=await files.planDelete(selected,{assert});if(s.view===view)s.confirmation=plan;});
    if(entry.action==='paste'){
      if(!s.clipboard)throw new Error('Clipboard is empty.');const source=s.clipboard,target=s.path;
      return operation(s,'Preparing copy…',async assert=>{const plan=await files.planCopy(source,target,{assert});if(plan.conflict){if(s.view===view)s.confirmation=plan;}else await mutate(s,plan,assert);});
    }
    if(entry.action==='confirm'){
      const plan=s.confirmation;if(!plan)throw new Error('Confirmation expired.');s.confirmation=null;
      return operation(s,plan.kind==='delete'?'Deleting…':plan.kind==='copy'?'Copying…':'Saving upload…',async assert=>{
        await mutate(s,plan,assert);
        if(plan.kind==='delete'&&(s.path===plan.source||s.path.startsWith(plan.source+'/'))){s.path=path.posix.dirname(plan.source);s.page=0;}
      });
    }
  }
  return {
    open(botId,message,dir='.'){
      role(botId,message.from?.id);if(closed)throw new Error('Browse is closed.');
      if(!config?.botsDir||!['private','group','supergroup'].includes(message.chat.type)||message.sender_chat||message.edit_date)throw new Error('Browse is unavailable here.');
      sweep();const id=key(botId,message.from.id);let s=sessions.get(id);
      if(!s){s={botId,userId:message.from.id,files:new BrowseFiles(path.join(config.botsDir,botId)),active:true,cache:new Map(),failedImages:new Set(),page:0,path:'.',touched:now(),status:'',busy:false};sessions.set(id,s);}
      // Validate before replacing a working view. An invalid path is not root fallback.
      const target=s.files.initial(dir);
      const opening=(s.opening??Promise.resolve()).catch(noop).then(async()=>{
        assert(s);const previous=s.view;
        s.path=target;s.page=0;s.attachment=null;s.confirmation=null;s.invitation=null;s.touched=now();s.unknown=false;
        s.view={source:message,nonce:randomBytes(9).toString('base64url'),actions:new Map(),revision:0};
        if(previous)await removeView(s,previous);
        await publish(s);
      });s.opening=opening;return track(opening);
    },
    async callback(botId,cb){
      if(typeof cb.data!=='string'||!cb.data.startsWith('br:'))return false;
      const ack=text=>telegram.call(botId,'answerCallbackQuery',{callback_query_id:cb.id,...(text?{text,show_alert:true}:{})}).catch(noop);
      const s=sessions.get(key(botId,cb.from?.id));
      if(!s||now()-s.touched>=TTL&&!s.busy){if(s)dispose(s);await ack('Browse expired. Send /browse again.');return true;}
      let admission;
      try{
        assert(s);if(s.unknown)throw new Error('Last delivery was not confirmed. Send /browse again.');
        const view=s.view,entry=view?.actions.get(cb.data);
        if(!entry||!same(view.address,cb.message)||cb.message.from?.id!==db.getBot(botId)?.telegramId)throw new Error('This browse control is no longer active.');
        if(s.busy||s.handling)throw new Error('Browse is busy.');
        admission=Symbol();s.handling=admission;
        observe(s,view,cb.message);s.touched=now();await ack();assert(s);
        if(s.view!==view||view.actions.get(cb.data)!==entry)return true;
        await action(s,entry,cb);
      }catch(error){await ack(errorText(s,error));onError(error);}
      finally{if(admission&&s.handling===admission)s.handling=null;}
      return true;
    },
    async upload(botId,message){
      const s=sessions.get(key(botId,message.from?.id)),entry=s?.invitation,quoted=message.reply_to_message;
      if(!entry||!message.document||!same(entry.address,quoted))return false;
      if(entry.expires<=now()){s.invitation=null;return true;}
      if(message.sender_chat||message.edit_date||quoted.sender_chat||quoted.edit_date||quoted.forward_origin||message.chat.id!==entry.address.chatId||topicIdOf(message)!==entry.topic||identity(quoted)!==entry.fingerprint)return true;
      try{
        assert(s);if(s.busy||s.unknown)return true;
        s.touched=now();
        await operation(s,'Receiving upload…',async assert=>{
          if(message.document.file_size>MAX_BYTES)throw new Error('Upload exceeds the 32 MiB browse limit.');
          if(s.files.info(entry.target).version!==entry.targetVersion)throw new Error('Upload target changed. Request a new invitation.');
          const bytes=await fetchDocument(botId,message.document,{maxBytes:MAX_BYTES});assert();
          // Admission consumed this exact invitation before the async fetch. A new
          // browse transfers the operation; it does not retarget or cancel it.
          if(s.files.info(entry.target).version!==entry.targetVersion)throw new Error('Upload target changed. Request a new invitation.');
          const plan=await s.files.planUpload(entry.target,message.document.file_name??'document',bytes,{assert});
          if(plan.conflict)s.confirmation=plan;else await mutate(s,plan,assert);
          s.invitation=null;
        });
      }catch(error){onError(error);}
      return true;
    },
    close(botId){if(botId===undefined){closed=true;clearInterval(timer);}for(const s of sessions.values())if(botId===undefined||s.botId===botId)dispose(s);},
    async idle(){while(jobs.size)await Promise.allSettled([...jobs]);},
  };
}
