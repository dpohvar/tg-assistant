import {createUsageStore,zeroUsage,usageFields} from '../storage/usage.mjs';
import {syntaxError} from './arguments.mjs';
const integer=n=>n.toLocaleString('en-US');
const size=n=>`${(n/1048576).toFixed(1)} MiB (${integer(n)} bytes)`;
const number='(?:0|[1-9]\\d{0,2}(?:,\\d{3})*)';
const tokenLine=new RegExp(`^Tokens: (${number}) in / (${number}) out$`);
const imageLine=new RegExp(`^Images: (${number}) / [0-9]+\\.[0-9] MiB \\((${number}) bytes\\)$`);
function numeric(s){const n=Number(s.replaceAll(',',''));if(!Number.isSafeInteger(n)||n<0)throw syntaxError('Invalid usage report counter.');return n;}
function readCounters(a,b){const t=tokenLine.exec(a),i=imageLine.exec(b);if(!t||!i)throw syntaxError('Reply to a complete usage report.');return {inputTokens:numeric(t[1]),outputTokens:numeric(t[2]),imageGenerations:numeric(i[1]),imageBytes:numeric(i[2])};}
export function parseUsageReport(text){
 if(typeof text!=='string'||text.length>4000||!text.startsWith('Usage (UTC):\n\n'))throw syntaxError('Reply to a complete usage report.');
 const blocks=text.slice(14).replace(/\n\nOutput truncated$/,'').split('\n\n');const rows=[];let all=false;
 for(let n=0;n<blocks.length;){
  const lines=blocks[n++].split('\n'),head=lines[0];const m=/^@([A-Za-z0-9_]+) \[ID: ([1-9]\d*)\](?: removed)? usage:$/.exec(head);
  if(head==='all usage:'){if(rows.length)throw syntaxError('Invalid usage report.');all=true;}else if(!m||all)throw syntaxError('Invalid usage report.');
  if(lines.length!==4||!/^Total from .+:$/.test(lines[1]))throw syntaxError('Invalid usage report.');
  const startedAt=Date.parse(lines[1].slice(11,-1));if(!Number.isFinite(startedAt)||new Date(startedAt).toISOString()!==lines[1].slice(11,-1))throw syntaxError('Invalid usage report date.');
  const id=all?'all':numeric(m[2]);if(rows.some(r=>r.id===id))throw syntaxError('Duplicate bot in usage report.');rows.push({id,startedAt,total:readCounters(lines[2],lines[3])});
  while(n<blocks.length&&!/^(@|all usage:)/.test(blocks[n])){
   const extra=blocks[n++].split('\n');
   if(/^Change over \d+[smhd]:$/.test(extra[0])){
    if(extra.length===2&&extra[1]==='Counters reset; comparison unavailable')continue;
    if(extra.length!==3||!/^Tokens: \+[\d,]+ in \/ \+[\d,]+ out$/.test(extra[1])||!/^Images: \+[\d,]+ \/ \+[\d,]+ bytes$/.test(extra[2]))throw syntaxError('Invalid usage comparison.');
   }else{
    if(extra.length!==3||!/^Period (\d{4}(?:-\d{2})?(?:-\d{2})?(?:T\d{2})?)(?: · in progress):$/.test(extra[0])&&!/^Period \d{4}(?:-\d{2})?(?:-\d{2})?(?:T\d{2})?:$/.test(extra[0]))throw syntaxError('Invalid usage period.');readCounters(extra[1],extra[2]);
   }
  }
 }
 if(!rows.length)throw syntaxError('Reply to a complete usage report.');return {all,rows};
}
export function usageReport({db,args=[],reply,masterTelegramId,now=Date.now()}){
 const store=createUsageStore(db),bots=store.list();let selected,option,previous;
 if(args.length>2)throw syntaxError('Use /usage [@BOT|all] [hours|days|months|years].');
 if(reply&&!args.length){
  if(reply.from?.id!==masterTelegramId||reply.forward_origin||reply.forward_from||reply.forward_from_chat||reply.is_automatic_forward)throw syntaxError('Reply to a report from this master bot.');
  if(reply.edit_date)throw syntaxError('Edited reports cannot be compared.');
  if(!Number.isSafeInteger(reply.date)||reply.date*1000>now)throw syntaxError('Invalid report date.');
  previous=parseUsageReport(reply.text);
  selected=previous.all?'all':previous.rows.map(r=>bots.find(b=>b.telegramId===r.id)).filter(Boolean);
  if(!previous.all&&selected.length!==previous.rows.length)throw syntaxError('A bot in the report is unavailable.');
 }else{
  option=args[1];if(option&&!['hours','days','months','years'].includes(option))throw syntaxError('Unknown usage period.');
  if(!args.length)selected=bots;
  else if(args[0]==='all'){if(option)throw syntaxError('Period options require @BOT.');selected='all';}
  else if(/^@[A-Za-z0-9_]+$/.test(args[0])){const matches=bots.filter(b=>b.username.toLowerCase()===args[0].slice(1).toLowerCase());if(matches.length!==1)throw syntaxError(matches.length?'Bot name is ambiguous.':'Bot not found.');selected=matches;}
  else throw syntaxError('Specify @BOT or all.');
 }
 if(selected==='all'){const total=zeroUsage();for(const b of bots)for(const k of usageFields){total[k]+=b.total[k];if(!Number.isSafeInteger(total[k]))throw syntaxError('Usage counter overflow.');}selected=[{telegramId:'all',startedAt:store.startedAt(),total}];}
 const oldFor=b=>previous?.rows.find(r=>r.id===b.telegramId);
 selected.sort((a,b)=>(previous?b.total.inputTokens-oldFor(b).total.inputTokens-(a.total.inputTokens-oldFor(a).total.inputTokens):b.total.inputTokens-a.total.inputTokens)||(Number(a.telegramId)||0)-(Number(b.telegramId)||0));
 if(!selected.length)return {text:'No records',entities:[]};
 let output={text:'Usage (UTC):',entities:[]},truncated=false;
 const build=()=>({text:'',entities:[]});
 const line=(block,text,type)=>{if(block.text)block.text+='\n';const offset=block.text.length;block.text+=text;if(type)block.entities.push({type,offset,length:text.length});};
 const counters=(block,total)=>{line(block,`Tokens: ${integer(total.inputTokens)} in / ${integer(total.outputTokens)} out`);block.entities.push({type:'italic',offset:block.text.lastIndexOf('Tokens:'),length:7});line(block,`Images: ${integer(total.imageGenerations)} / ${size(total.imageBytes)}`);block.entities.push({type:'italic',offset:block.text.lastIndexOf('Images:'),length:7});};
 const append=block=>{if(output.text.length+2+block.text.length>3970||output.entities.length+block.entities.length>95){truncated=true;return false;}const offset=output.text.length+2;output.text+='\n\n'+block.text;output.entities.push(...block.entities.map(e=>({...e,offset:e.offset+offset})));return true;};
 for(const b of selected){const block=build();line(block,b.telegramId==='all'?'all usage:':`@${b.username} [ID: ${b.telegramId}]${b.removed?' removed':''} usage:`,'code');line(block,`Total from ${new Date(b.startedAt).toISOString()}:`,'bold');counters(block,b.total);
  const old=oldFor(b);if(old){block.text+='\n';const sec=Math.floor((now-reply.date*1000)/1000),elapsed=sec<60?sec+'s':sec<3600?Math.floor(sec/60)+'m':sec<86400?Math.floor(sec/3600)+'h':Math.floor(sec/86400)+'d';line(block,`Change over ${elapsed}:`,'bold');if(old.startedAt!==b.startedAt||Object.keys(old.total).some(k=>b.total[k]<old.total[k]))line(block,'Counters reset; comparison unavailable');else{line(block,`Tokens: +${integer(b.total.inputTokens-old.total.inputTokens)} in / +${integer(b.total.outputTokens-old.total.outputTokens)} out`);line(block,`Images: +${integer(b.total.imageGenerations-old.total.imageGenerations)} / +${integer(b.total.imageBytes-old.total.imageBytes)} bytes`);}}
  if(!append(block))break;
  if(option){for(const p of store.periods(b.telegramId,option,now)){const period=build();line(period,`Period ${p.slot}${p.inProgress?' · in progress':''}:`,'bold');counters(period,p.counters);if(!append(period))break;}}
 }
 if(truncated)output.text+='\n\nOutput truncated';return output;
}
