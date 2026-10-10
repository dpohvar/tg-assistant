export function formatAgents(agents, offset, total) {
 if(!agents.length) return 'No records';
 let text=`${offset+1}-${offset+agents.length} / ${total}\n`;const entities=[];
 const append=(value,type)=>{value=String(value);const offset=text.length;text+=value;if(type)entities.push({type,offset,length:value.length});};
 agents.forEach((a,i)=>{if(i)text+='\n';append(a.agentId,'code');text+=' ';append(a.chatType,'italic');text+=' ';const chat=JSON.parse(a.json);append(chat.username?'@'+chat.username:a.name||String(a.chatId));if(a.chatType!=='private'){text+=' ';append(a.chatId,'italic');} if(a.agentEnabled!==undefined)text+=' — '+(a.agentEnabled?'enabled':'disabled');});
 if(text.length>4000){let end=4000;if(/^[\uD800-\uDBFF]$/.test(text[end-1]))end--;text=text.slice(0,end)+'\n[truncated]';for(const e of entities)e.length=Math.max(0,Math.min(e.length,end-e.offset));}
 return {text,entities:entities.filter(e=>e.length>0)};
}
