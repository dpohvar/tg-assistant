import readline from 'node:readline';
import fs from 'node:fs';
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
const root='usage-root',child='usage-child',file=process.argv[2];let turn=0;
const counters=n=>({inputTokens:n,outputTokens:10,cachedInputTokens:0,reasoningOutputTokens:0,cacheWriteInputTokens:0,totalTokens:n+10});
const usage=(id,n)=>send({method:'thread/tokenUsage/updated',params:{threadId:id,tokenUsage:{total:counters(n),last:counters(n)}}});
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.method==='initialize'||m.method==='thread/delete'){send({id:m.id,result:{}});return;}
 if(m.method==='thread/start'||m.method==='thread/resume'){
  if(m.method==='thread/resume')usage(root,500);send({id:m.id,result:{thread:{id:root}}});return;
 }
 if(m.method==='turn/start'){
  send({id:m.id,result:{turn:{id:'t'+(++turn)}}});
  usage(root,turn===1?600:700);
  for(let j=0;j<2;j++)send({method:'item/started',params:{threadId:root,item:{type:'subAgentActivity',kind:'started',agentThreadId:child}}});
  usage(child,50);usage(child,50);
  fs.writeFileSync(file,'generated test bytes');
  for(let j=0;j<2;j++){send({method:'item/started',params:{threadId:child,item:{type:'imageGeneration',id:'image',status:'in_progress'}}});send({method:'item/completed',params:{threadId:child,item:{type:'imageGeneration',id:'image',status:'completed',savedPath:file}}});}
  for(const id of [child,root])send({method:'turn/completed',params:{threadId:id,turn:{status:'completed'}}});
 }
});
