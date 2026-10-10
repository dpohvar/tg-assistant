import {RpcProcess} from '../codex/rpc.mjs';
import {nativeMcpOverrides,nativeServerName} from './config.mjs';
export async function initializeRpc(rpc){await rpc.request('initialize',{clientInfo:{name:'tg_assistant',version:'0.1'},capabilities:{experimentalApi:true}});rpc.notify('initialized');}
export async function isolatedMcpArgs({executable,args,cwd,env,botId,entries,readConfig}){
 let rpc;let config;
 try{if(readConfig)config=await readConfig();else{rpc=new RpcProcess({executable,args,cwd,env});await initializeRpc(rpc);config=(await rpc.request('config/read',{includeLayers:false,cwd})).config;}}
 catch{throw Object.assign(new Error('Codex MCP configuration could not be isolated.'),{code:'mcp_config_failed'});}finally{await rpc?.close();}
 const disabled=Object.keys(config?.mcp_servers??{}).flatMap(name=>['-c',`mcp_servers.${JSON.stringify(name)}.enabled=false`]);
 const plugins=Object.keys(config?.plugins??{}).flatMap(name=>['-c',`plugins.${JSON.stringify(name)}.enabled=false`]);
 return [...args,...disabled,...plugins,'-c','features.apps=false',...nativeMcpOverrides(botId,entries)];
}
export async function testMcpRuntime({executable,args,cwd,env,botId,entry}){
 const isolated=await isolatedMcpArgs({executable,args,cwd,env,botId,entries:[entry]});
 const rpc=new RpcProcess({executable,args:isolated,cwd,env,handleRequest:async()=>{throw new Error('Interactive MCP requests are not supported.');}});
 try{await initializeRpc(rpc);await rpc.request('thread/start',{cwd,approvalPolicy:'never',ephemeral:true});
  const rows=[];let cursor;do{const page=await rpc.request('mcpServerStatus/list',{...(cursor?{cursor}:{})});rows.push(...page.data);cursor=page.nextCursor;}while(cursor);
  const server=rows.find(x=>x.name===nativeServerName(botId,entry.name));
  if(!server||server.toolsError)throw new Error('Unavailable');return {status:'connected',tools:Object.keys(server.tools??{}),authStatus:server.authStatus};
 }catch{throw Object.assign(new Error('MCP connection failed. Check URL, headers and server availability; OAuth and interactive authentication are not supported.'),{code:'mcp_connection_failed',safe:true});}finally{await rpc.close();}
}
