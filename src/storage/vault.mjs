const validateName = name => { if(typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) throw new Error('Invalid secret name. Use 1-64 ASCII letters, digits, underscores or hyphens; start with a letter.'); };
export function createVault(db) {
 return {
 list(botId){return db.sql.prepare('SELECT name FROM vault WHERE botId=? ORDER BY name').all(botId).map(r=>r.name);},
 get(botId,name){validateName(name);const row=db.sql.prepare('SELECT value FROM vault WHERE botId=? AND name=?').get(botId,name);return row?{value:row.value}:{error:'secret_not_found',description:'Secret not found in this bot vault. Ask an administrator to configure it.'};},
 set(botId,name,value){validateName(name);if(typeof value!=='string'||!value.length||Buffer.byteLength(value,'utf8')>16384)throw new Error('Secret must contain 1-16384 UTF-8 bytes.');db.sql.prepare('INSERT INTO vault VALUES(?,?,?) ON CONFLICT(botId,name) DO UPDATE SET value=excluded.value').run(botId,name,value);},
 delete(botId,name){validateName(name);return db.sql.prepare('DELETE FROM vault WHERE botId=? AND name=?').run(botId,name).changes>0;}
 };
}
