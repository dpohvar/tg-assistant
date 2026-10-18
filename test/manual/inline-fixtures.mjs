import {deflateSync} from 'node:zlib';
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),n=Buffer.alloc(4),crc=Buffer.alloc(4);n.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([n,name,data,crc]);}
export function fixturePNG(color=[40,100,220]){
  const header=Buffer.alloc(13);header.writeUInt32BE(96,0);header.writeUInt32BE(96,4);header[8]=8;header[9]=2;
  const rows=Buffer.alloc((96*3+1)*96);for(let y=0;y<96;y++)for(let x=0;x<96;x++){const i=y*(96*3+1)+1+x*3;rows[i]=color[0];rows[i+1]=color[1];rows[i+2]=color[2];}
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
export async function prepareInlineFixtures({telegram,botId,ownerId,created,signal}){
  const photo=await telegram.call(botId,'sendPhoto',{chat_id:ownerId,photo:'attach://fixture',caption:'Inline calibration fixture',disable_notification:true},
    {signal,uploads:[{name:'fixture',bytes:fixturePNG(),filename:'inline-probe.png',mime:'image/png'}]});
  created.push(photo.message_id);
  const doc=await telegram.call(botId,'sendDocument',{chat_id:ownerId,document:'attach://fixture',caption:'Inline calibration fixture',disable_notification:true},
    {signal,uploads:[{name:'fixture',bytes:Buffer.from('{"inlineCalibration":true}\n'),filename:'inline-probe.json',mime:'application/json'}]});
  created.push(doc.message_id);
  return [
    {type:'article',id:'probe-text',title:'Text result',input_message_content:{message_text:'Inline calibration: text'}},
    {type:'article',id:'probe-rich',title:'Rich result',input_message_content:{rich_message:{blocks:[{type:'paragraph',text:'Inline calibration: rich text'}]}}},
    {type:'photo',id:'probe-photo',photo_file_id:photo.photo.at(-1).file_id,title:'Photo result'},
    {type:'document',id:'probe-document',document_file_id:doc.document.file_id,title:'Document result'}
  ];
}
