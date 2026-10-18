export function messageChunks(value,limit=4096) {
  if(typeof value==='string')value={text:value};
  const out=[];
  for(let start=0;start<value.text.length;) {
    let end=Math.min(start+limit,value.text.length);
    for(const entity of value.entities??[])if(['code','text_link'].includes(entity.type)&&entity.offset>start&&entity.offset<end&&entity.offset+entity.length>end)end=entity.offset;
    if(end<value.text.length&&/[\uD800-\uDBFF]/.test(value.text[end-1]))end--;
    const entities=(value.entities??[]).flatMap(entity=>{
      const from=Math.max(start,entity.offset),to=Math.min(end,entity.offset+entity.length);
      return from<to?[{...entity,offset:from-start,length:to-from}]:[];
    });
    out.push({...value,text:value.text.slice(start,end),entities});start=end;
  }
  return out.length?out:[{...value,entities:value.entities??[]}];
}
