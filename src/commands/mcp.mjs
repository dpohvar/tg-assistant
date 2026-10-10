import {parseMcpConfig,redactMcpConfig} from '../mcp/config.mjs';import {createMcpStore} from '../mcp/store.mjs';import {syntaxError} from './arguments.mjs';
export async function handleMcpCommand({botId,parsed,send,db,requestMcpRefresh,testMcp}){
 const store=createMcpStore(db),parts=parsed.map(x=>x.value),action=parts[0]??'list';
 if(action==='list'&&parts.length<=1){await send({text:store.list(botId).map(e=>`${e.name} · ${new URL(e.config.url).origin}${e.config.enabled===false?' · disabled':''}`).join('\n')||'Подключений нет',entities:[]});return;}
 if(action==='set'&&parts.length===3&&parsed[2].type==='pre'){
  const config=parseMcpConfig(parts[2]);store.set(botId,parts[1],config);requestMcpRefresh?.(botId);await send('Настройки сохранены. Активные агенты применят их после завершения текущей работы.');return;
 }
 if(action==='delete'&&parts.length===2){const found=store.delete(botId,parts[1]);if(found)requestMcpRefresh?.(botId);await send(found?'Подключение удалено':'Подключение не найдено');return;}
 if(['show','test'].includes(action)&&parts.length===2){const entry=store.get(botId,parts[1]);if(!entry)throw syntaxError('MCP connection not found.');if(action==='show')await send({text:JSON.stringify(redactMcpConfig(entry.config),null,2),entities:[]});else {if(!testMcp)throw syntaxError('MCP runtime is not configured.');const result=await testMcp(botId,entry);await send({text:`${result.status}\nИнструментов: ${result.tools.length}\n${result.tools.join('\n')}`,entities:[]});}return;}
 throw syntaxError('Use /mcp set NAME followed by one pre block of TOML, or list/show/test/delete.');
}
