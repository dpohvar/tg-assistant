// Synthetic local TLS probe. Trust CERT via NODE_EXTRA_CA_CERTS, never disable verification.
import fs from 'node:fs';import https from 'node:https';import path from 'node:path';import assert from 'node:assert/strict';
import {WebSocketServer} from 'ws';import {WebSocketManager} from '../../src/websocket/manager.mjs';
const [root,cert,key]=process.argv.slice(2);if(!root||!cert||!key)throw Error('Supply ROOT CERT KEY');
const server=https.createServer({cert:fs.readFileSync(cert),key:fs.readFileSync(key)}),ws=new WebSocketServer({server});
let authenticated=false;ws.on('connection',(s,req)=>{authenticated=req.headers.authorization==='Bearer synthetic-tls';s.on('message',(b,binary)=>s.send(b,{binary}));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const m=new WebSocketManager({botsDir:path.join(root,'bots')}),scope={botId:'b',agentId:'a'};
try{const {connectionId}=await m.open(scope,{url:`wss://127.0.0.1:${server.address().port}/secret`,description:'TLS probe',headers:{Authorization:'Bearer synthetic-tls'}});await m.send(scope,{connectionId,text:'tls-ok'});
 const end=Date.now()+5000;while(!m.list(scope).connections[0].queued){if(Date.now()>end)throw Error('Echo timeout');await new Promise(r=>setTimeout(r,10));}
 assert.equal(m.pull(scope,{connectionId,count:1}).messages[0].data,'tls-ok');assert.equal(authenticated,true);console.log(JSON.stringify({passed:true,tlsVerified:true,headersAuthenticated:true}));m.delete(scope,connectionId);
}finally{m.shutdown();for(const s of ws.clients)s.terminate();await new Promise(r=>ws.close(r));await new Promise(r=>server.close(r));}
