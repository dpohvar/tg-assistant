import {compileWidget} from './build.mjs';
import {connectWidgetTransport} from './transport.mjs';
import {widgetError,WIDGET_LIMITS as L} from './contract.mjs';
async function main(){
  let line='';for await(const chunk of process.stdin){line+=chunk;if(line.length>L.frameBytes)throw widgetError('invalid_argument');if(line.includes('\n'))break;}
  const boot=JSON.parse(line);
  const rpc=await connectWidgetTransport({...boot,handle:async(method,args)=>{
    if(method!=='build'||args.ref?.botId!==boot.owner.botId||args.ref?.agentId!==boot.owner.agentId)throw widgetError('access_denied');
    return compileWidget(args.handler,{cwd:process.cwd(),agentId:boot.owner.agentId,assets:boot.assets});
  }});
  const heart=setInterval(()=>void rpc.request('heartbeat',{}).catch(()=>process.exit(1)),L.heartbeatMs);
  process.on('SIGTERM',()=>{clearInterval(heart);void rpc.close().finally(()=>process.exit());});
}
if(process.argv.includes('--widget-runtime'))main().catch(()=>{console.error('widget_compiler_failed');process.exit(1);});
