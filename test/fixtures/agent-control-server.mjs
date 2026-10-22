import readline from 'node:readline';import {spawn} from 'node:child_process';
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.method==='initialize')send({id:m.id,result:{}});
 if(m.method==='test/orphan'){
  const leaf="const fs=require('fs');fs.writeFileSync(process.argv[1],String(process.pid));let n=0;setInterval(()=>fs.writeFileSync(process.argv[2],String(++n)),25)";
  spawn(process.execPath,['-e',`const {spawn}=require('child_process');const p=spawn(process.execPath,['-e',${JSON.stringify(leaf)},...process.argv.slice(1)],{detached:true,stdio:'ignore'});p.unref();`,m.params.ready,m.params.late],{stdio:'ignore'});send({id:m.id,result:{}});
 }
 if(m.method==='test/spawn'){
  const child=spawn(process.execPath,['-e',"const fs=require('fs');fs.writeFileSync(process.argv[1],'ready');let n=0;setInterval(()=>fs.writeFileSync(process.argv[2],String(++n)),100)",m.params.ready,m.params.late],{stdio:'ignore',windowsHide:true});
  send({id:m.id,result:{pid:child.pid}});
 }
});
