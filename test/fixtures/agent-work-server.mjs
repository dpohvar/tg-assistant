import readline from 'node:readline';const send=m=>process.stdout.write(JSON.stringify(m)+'\n');let n=0;
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line),params=m.params??{};
 if(m.method==='initialize')send({id:m.id,result:{}});
 if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'root'}}});
 if(m.method==='turn/start'){const id='turn'+(++n);send({id:m.id,result:{turn:{id}}});send({method:'turn/started',params:{threadId:'root',turn:{id}}});if(n===1)send({method:'item/started',params:{threadId:'root',turnId:id,item:{type:'subAgentActivity',kind:'started',agentThreadId:'child'}}});send({method:'turn/completed',params:{threadId:'root',turn:{id,status:'completed'}}});}
 if(m.method==='test/release-child'){send({id:m.id,result:{}});send({method:'turn/completed',params:{threadId:'child',turn:{id:'child-turn',status:'failed'}}});}
});
