import {crc32,deflateRaw} from 'node:zlib';
import {promisify} from 'node:util';
const deflate=promisify(deflateRaw);

// Bounded non-ZIP64 archive. UTF-8 names, local headers and a central directory
// make the output usable by standard ZIP readers without a platform executable.
export async function zip(entries) {
  const output=[],central=[];let offset=0;
  for(const {name,bytes=Buffer.alloc(0),mtime=new Date()} of entries){
    const filename=Buffer.from(name),data=name.endsWith('/')?Buffer.alloc(0):await deflate(bytes);
    const date=new Date(mtime),year=Math.min(2107,Math.max(1980,date.getFullYear()));
    const time=(date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1);
    const day=((year-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate();
    const local=Buffer.alloc(30),header=Buffer.alloc(46),method=name.endsWith('/')?0:8;
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(method,8);
    local.writeUInt16LE(time,10);local.writeUInt16LE(day,12);local.writeUInt32LE(crc32(bytes),14);
    local.writeUInt32LE(data.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(filename.length,26);
    header.writeUInt32LE(0x02014b50);header.writeUInt16LE(20,4);local.copy(header,6,4,30);
    header.writeUInt32LE(name.endsWith('/')?0x10:0,38);header.writeUInt32LE(offset,42);
    output.push(local,filename,data);central.push(header,filename);offset+=local.length+filename.length+data.length;
  }
  const tail=Buffer.alloc(22),centralSize=central.reduce((sum,b)=>sum+b.length,0);
  tail.writeUInt32LE(0x06054b50);tail.writeUInt16LE(entries.length,8);tail.writeUInt16LE(entries.length,10);
  tail.writeUInt32LE(centralSize,12);tail.writeUInt32LE(offset,16);
  return Buffer.concat([...output,...central,tail]);
}
