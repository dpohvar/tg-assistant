import {validMcpName} from './config.mjs';
export function createMcpStore(db){
 const check=name=>{if(!validMcpName(name))throw Object.assign(new Error('MCP name must start with an ASCII letter and contain up to 64 letters, digits, underscores or hyphens.'),{code:'invalid_argument',safe:true});};
 const get=(botId,name)=>{check(name);const row=db.sql.prepare('SELECT * FROM mcp_servers WHERE botId=? AND name=?').get(botId,name);return row?{name:row.name,config:JSON.parse(row.configJson)}:null;};
 return {get,list:botId=>db.sql.prepare('SELECT * FROM mcp_servers WHERE botId=? ORDER BY name').all(botId).map(r=>({name:r.name,config:JSON.parse(r.configJson)})),revision:botId=>db.getBot(botId)?.mcpRevision??0,
  set(botId,name,config){check(name);db.transaction(()=>{db.sql.prepare('INSERT INTO mcp_servers VALUES(?,?,?) ON CONFLICT(botId,name) DO UPDATE SET configJson=excluded.configJson').run(botId,name,JSON.stringify(config));db.sql.prepare('UPDATE bots SET mcpRevision=mcpRevision+1 WHERE botId=?').run(botId);});},
  delete(botId,name){check(name);return db.transaction(()=>{const found=db.sql.prepare('DELETE FROM mcp_servers WHERE botId=? AND name=?').run(botId,name).changes;if(found)db.sql.prepare('UPDATE bots SET mcpRevision=mcpRevision+1 WHERE botId=?').run(botId);return Boolean(found);});}};
}
