import {parse} from 'smol-toml';import {createHash} from 'node:crypto';
const fail=()=>{throw Object.assign(new Error('Invalid MCP configuration. Use HTTP url and supported Codex fields; check TOML syntax and value types.'),{code:'invalid_argument',safe:true});};
export const validMcpName=name=>typeof name==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name);
export function parseMcpConfig(text){
 let c;try{c=parse(text);}catch{fail();}
 const allowed=['url','http_headers','enabled','startup_timeout_sec','tool_timeout_sec','enabled_tools','disabled_tools'];
 if(Object.keys(c).some(k=>!allowed.includes(k))||typeof c.url!=='string')fail();
 let u;try{u=new URL(c.url);}catch{fail();}if(!['http:','https:'].includes(u.protocol))fail();
 if(c.enabled!==undefined&&typeof c.enabled!=='boolean')fail();
 for(const key of ['startup_timeout_sec','tool_timeout_sec'])if(c[key]!==undefined&&(!Number.isFinite(c[key])||c[key]<=0))fail();
 for(const key of ['enabled_tools','disabled_tools'])if(c[key]!==undefined&&(!Array.isArray(c[key])||c[key].some(v=>typeof v!=='string'||!v)))fail();
 if(c.http_headers!==undefined&&(!c.http_headers||typeof c.http_headers!=='object'||Array.isArray(c.http_headers)||Object.entries(c.http_headers).some(([k,v])=>!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k)||typeof v!=='string'||/[\r\n]/.test(v))))fail();
 return c;
}
export const redactMcpConfig=c=>({...c,url:new URL(c.url).origin,...(c.http_headers?{http_headers:Object.fromEntries(Object.keys(c.http_headers).map(k=>[k,'[hidden]']))}:{})});
export const nativeServerName=(botId,name)=>'tg_'+createHash('sha256').update(botId).digest('hex').slice(0,16)+'_'+name;
const inline=v=>typeof v==='string'?JSON.stringify(v):Array.isArray(v)?'['+v.map(inline).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).map(([k,x])=>JSON.stringify(k)+'='+inline(x)).join(',')+'}':String(v);
export function nativeMcpOverrides(botId,entries){return ['-c','mcp_servers='+inline(Object.fromEntries(entries.map(e=>[nativeServerName(botId,e.name),{...e.config,default_tools_approval_mode:"approve"}])))];}
