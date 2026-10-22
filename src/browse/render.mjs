import path from 'node:path';

const p=text=>({type:'paragraph',text});
export const formatSize=n=>n<1024?`${n} B`:n<1024*1024?`${(n/1024).toFixed(1)} KiB`:`${(n/1024/1024).toFixed(1)} MiB`;
const short=text=>text.length>100?text.slice(0,97)+'…':text;

// Rendering does not perform effects. The service supplies versioned callbacks and
// prepared media, and sends the complete replacement document to Telegram.
export function renderBrowse({info,entries=[],page=0,gallery,preview,image,attachment,clipboard,clipboardDirectory,confirmation,status,busy},button,media){
  const blocks=[],parts=info.path==='.'?[]:info.path.split('/');
  const crumbs=[{type:'button',button:button('🏠 Root',{action:'open',path:'.'},'link')}];
  for(let i=0;i<parts.length;i++){
    crumbs.push(' › ');
    const last=i===parts.length-1,label=(last&&!info.directory?'📄 ':'📁 ')+short(parts[i]);
    if(last)crumbs.push(label);
    else crumbs.push({type:'button',button:button(label,{action:'open',path:parts.slice(0,i+1).join('/')},'link')});
  }
  blocks.push(p(crumbs),{type:'divider'});
  const disabled=text=>({text,disabled:{}});
  const up=(text='↩️',style='success')=>info.path==='.'?disabled(text):button(text,{action:'open',path:path.posix.dirname(info.path)},style);
  if(info.directory){
    if(info.path!=='.')blocks.push(p([{type:'button',button:up('📁 ..','link')}]));
    if(!entries.length)blocks.push(p('Directory is empty.'));
    for(const entry of entries.slice(page*10,page*10+10))blocks.push(p([
      {type:'button',button:button((entry.directory?'📁 ':'📄 ')+short(entry.name),{action:'open',path:entry.path},'link')},
      entry.directory?'':`  ${formatSize(entry.size)}`,
    ]));
    const from=entries.length?page*10+1:0,to=Math.min((page+1)*10,entries.length);
    blocks.push({type:'buttons',align:'center',buttons:[
      up(),page>0?button('◀️',{action:'page',page:page-1},'success'):disabled('◀️'),
      disabled(`${from}-${to}/${entries.length}`),
      to<entries.length?button('▶️',{action:'page',page:page+1},'success'):disabled('▶️'),
      button('🔄',{action:'refresh'},'success'),
    ]});
  }else{
    blocks.push(p(['Path: ',{type:'code',text:info.path}]));
    blocks.push(p(`Size: ${formatSize(info.size)}\nModified: ${info.mtime}`));
    if(preview){blocks.push({type:'pre',text:preview.text||' ',...(preview.language?{language:preview.language}:{})});if(preview.truncated)blocks.push({type:'footer',text:'Preview truncated to 50 lines.'});}
    if(image)blocks.push({type:'photo',photo:{type:'photo',media:media(image,'photo',blocks.length)}});
    blocks.push({type:'buttons',align:'center',buttons:[
      button('↩️',{action:'open',path:path.posix.dirname(info.path),page:gallery.backPage},'success'),
      gallery.previous?button('◀️',{action:'open',path:gallery.previous,file:true},'success'):disabled('◀️'),
      disabled(`${gallery.index+1} / ${gallery.total}`),
      gallery.next?button('▶️',{action:'open',path:gallery.next,file:true},'success'):disabled('▶️'),
      button('🔄',{action:'refresh'},'success'),
    ]});
  }
  blocks.push({type:'divider'});
  if(confirmation){
    const label=confirmation.kind==='delete'?'Delete recursively':confirmation.kind==='copy'?'Copy / merge and replace':'Replace file';
    blocks.push(p(`${label}: ${confirmation.destination??confirmation.source}?`),{type:'buttons',align:'center',buttons:[button('Confirm',{action:'confirm'},'danger'),button('Cancel',{action:'cancel'})]});
  }else{
    blocks.push({type:'buttons',align:'center',buttons:[
      button('Upload',{action:'upload'}),button('Download',{action:'download'}),
      info.path==='.'?disabled('Delete'):button('Delete',{action:'delete'},'danger'),
      info.path==='.'?disabled('Copy'):button('Copy',{action:'copy'}),
      !clipboard||!info.directory&&clipboardDirectory?disabled('Paste'):button('Paste',{action:'paste'}),
    ]});
  }
  if(attachment)blocks.push({type:'document',document:{type:'document',media:media(attachment,'document',blocks.length)},caption:{text:attachment.filename}});
  blocks.push({type:'footer',text:clipboard?`Clipboard: ${clipboardDirectory?'📁':'📄'} ${clipboard}`:'Clipboard: empty'});
  if(status)blocks.push({type:'footer',text:status});
  return {blocks};
}
