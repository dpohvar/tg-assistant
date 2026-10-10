import {parse} from 'smol-toml';import {createHash} from 'node:crypto';
const fail=()=>{throw Object.assign(new Error('Invalid MCP configuration. Use HTTP url and supported fields; check JSON or TOML syntax and value types.'),{code:'invalid_argument',safe:true});};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function alias(c,old,key){if(Object.hasOwn(c,old)){if(Object.hasOwn(c,key)&&JSON.stringify(c[key])!==JSON.stringify(c[old]))fail();c[key]=c[old];delete c[old];}}
export const validMcpName=name=>typeof name==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name);
export function parseMcpConfig(text){
 let c;try{c=text.trimStart().startsWith('{')?JSON.parse(text):parse(text);}catch{fail();}if(!object(c))fail();if(Object.hasOwn(c,'type')){if(c.type!=='http')fail();delete c.type;}alias(c,'serverUrl','url');alias(c,'headers','http_headers');if(object(c.oauth)){alias(c.oauth,'clientId','client_id');alias(c.oauth,'clientSecret','client_secret');}
 const allowed=['url','http_headers','enabled','startup_timeout_sec','tool_timeout_sec','enabled_tools','disabled_tools','oauth'];
 if(Object.keys(c).some(k=>!allowed.includes(k))||typeof c.url!=='string')fail();
 let u;try{u=new URL(c.url);}catch{fail();}if(!['http:','https:'].includes(u.protocol))fail();
 if(c.enabled!==undefined&&typeof c.enabled!=='boolean')fail();
 for(const key of ['startup_timeout_sec','tool_timeout_sec'])if(c[key]!==undefined&&(!Number.isFinite(c[key])||c[key]<=0))fail();
 for(const key of ['enabled_tools','disabled_tools'])if(c[key]!==undefined&&(!Array.isArray(c[key])||c[key].some(v=>typeof v!=='string'||!v)))fail();
 if(c.http_headers!==undefined&&(!c.http_headers||typeof c.http_headers!=='object'||Array.isArray(c.http_headers)||Object.entries(c.http_headers).some(([k,v])=>!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k)||typeof v!=='string'||/[\r\n]/.test(v))))fail();
 if(c.oauth!==undefined){const o=c.oauth;if(!object(o)||Object.keys(o).some(k=>!['client_id','client_secret','scopes','callback_url','callback_port'].includes(k)))fail();
  if(o.client_id!==undefined&&(typeof o.client_id!=='string'||!o.client_id.trim()||/[\r\n]/.test(o.client_id)))fail();
  if(o.client_secret!==undefined&&(typeof o.client_secret!=='string'||!o.client_secret.trim()||/[\r\n]/.test(o.client_secret)||!o.client_id))fail();
  if(o.scopes!==undefined&&(!Array.isArray(o.scopes)||o.scopes.some(s=>typeof s!=='string'||!s||/\s/.test(s))))fail();
  if(o.callback_port!==undefined&&(!Number.isSafeInteger(o.callback_port)||o.callback_port<1||o.callback_port>65535))fail();
  if(o.callback_url!==undefined){let cb;try{cb=new URL(o.callback_url);}catch{fail();}if(typeof o.callback_url!=='string'||!['http:','https:'].includes(cb.protocol)||cb.username||cb.password||cb.hash||/[\r\n]/.test(o.callback_url)||(cb.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(cb.hostname)))fail();}
 }
 return c;
}
export const redactMcpConfig=c=>({...c,url:new URL(c.url).origin,...(c.http_headers?{http_headers:Object.fromEntries(Object.keys(c.http_headers).map(k=>[k,'[hidden]']))}:{}),...(c.oauth?{oauth:{...c.oauth,...(c.oauth.client_secret?{client_secret:'[hidden]'}:{}),...(c.oauth.callback_url?{callback_url:new URL(c.oauth.callback_url).origin}:{})}}:{})});
export const nativeServerName=(botId,name)=>'tg_'+createHash('sha256').update(botId).digest('hex').slice(0,16)+'_'+name;
const inline=v=>typeof v==='string'?JSON.stringify(v):Array.isArray(v)?'['+v.map(inline).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).map(([k,x])=>JSON.stringify(k)+'='+inline(x)).join(',')+'}':String(v);
export function nativeMcpOverrides(botId,entries){return ['-c','mcp_oauth_credentials_store="file"','-c','mcp_servers='+inline(Object.fromEntries(entries.map(e=>{const c={...e.config,default_tools_approval_mode:"approve"};if(c.oauth?.scopes){c.oauth={...c.oauth};c.scopes=c.oauth.scopes;delete c.oauth.scopes;}return [nativeServerName(botId,e.name),c];})))];}
