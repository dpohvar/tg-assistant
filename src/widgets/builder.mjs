import {widgetError} from './contract.mjs';
export function createWidgetBuilder({host,authorize}){
  const queues=new Map(),epochs=new Map();let closed=false;
  return {
    compile(owner,handler){
      if(closed)return Promise.reject(widgetError('widget_stopped'));
      const key=JSON.stringify([owner.botId,owner.agentId]),epoch=epochs.get(key)??0,previous=queues.get(key)??Promise.resolve();
      const work=previous.catch(()=>{}).then(async()=>{
        if(closed||(epochs.get(key)??0)!==epoch)throw widgetError('widget_stopped');authorize(owner);
        try{const result=await host.request(owner,'build',{handler});
          if(closed||(epochs.get(key)??0)!==epoch)throw widgetError('widget_stopped');authorize(owner);return result;
        }
        finally{await host.release(owner);}
      });
      queues.set(key,work);work.finally(()=>{if(queues.get(key)===work)queues.delete(key);}).catch(()=>{});
      return work;
    },
    async cancel(owner){const key=JSON.stringify([owner.botId,owner.agentId]);epochs.set(key,(epochs.get(key)??0)+1);await host.release(owner);},
    async close(){closed=true;await host.close();await Promise.allSettled([...queues.values()]);},
  };
}
