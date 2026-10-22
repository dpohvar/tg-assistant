export function createMessageSerial(){const jobs=new Map();return {
 run(target,fn){const key=JSON.stringify([target.botId,target.chatId,target.messageId]),prior=jobs.get(key)??Promise.resolve();const job=prior.catch(()=>{}).then(fn);jobs.set(key,job);job.finally(()=>{if(jobs.get(key)===job)jobs.delete(key);}).catch(()=>{});return job;},
 async idle(){while(jobs.size)await Promise.allSettled([...jobs.values()]);}
};}
