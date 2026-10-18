import fs from 'node:fs';
import path from 'node:path';
// Publication intents survive the gap between Telegram and the binding transaction.
// Recovery only records uncertainty; it never replays an external effect or restores
// an older message projection over observations already in the database.
export function createPublicationReceipts({directory}) {
  const filename=(ref,id)=>path.join(directory(ref),`${ref.widgetId}-${id}.json`);
  const api={
    write(ref,view,projection=null){
      if(!view)return;
      const file=filename(ref,view.id);fs.mkdirSync(path.dirname(file),{recursive:true});
      const message=projection?.message,target=message?.message_id?{chatId:view.target.chatId,messageId:message.message_id}:view.target;
      const body={widgetId:ref.widgetId,generation:ref.generation,viewId:view.id,target,projection,at:Date.now()};
      fs.writeFileSync(file+'.tmp',JSON.stringify(body),{mode:0o600});fs.renameSync(file+'.tmp',file);
    },
    done(ref,id){try{fs.unlinkSync(filename(ref,id));}catch(error){if(error.code!=='ENOENT')throw error;}},
    list(ref){const dir=directory(ref);if(!fs.existsSync(dir))return [];
      return fs.readdirSync(dir).filter(name=>name.startsWith(ref.widgetId+'-')&&name.endsWith('.json'))
        .map(name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8')))
        .filter(r=>r.widgetId===ref.widgetId&&r.generation<=ref.generation);
    },
    recover(ref,store){let uncertain=false;
      for(const receipt of api.list(ref)){
        const target=receipt.target;
        const bound=target.messageId||target.inlineMessageId?store.byTarget(ref.botId,target):null;
        if(bound){
          if(bound.widgetId===ref.widgetId&&!(bound.id===receipt.viewId&&receipt.projection?.renderHash&&bound.renderHash===receipt.projection.renderHash)){
            store.patchView(ref,bound.id,{deliveryUnknown:true,renderHash:null});uncertain=true;
          }
          api.done(ref,receipt.viewId);
        }else if(!target.inlineMessageId){
          store.addCandidate(ref,{viewId:receipt.viewId,target,createdAt:receipt.at,reason:receipt.projection?'storage_failed':'delivery_unknown'});uncertain=true;
        }else {api.done(ref,receipt.viewId);uncertain=true;}
      }
      return uncertain;
    },
    remove(ref){for(const receipt of api.list(ref))api.done(ref,receipt.viewId);},
  };return api;
}
