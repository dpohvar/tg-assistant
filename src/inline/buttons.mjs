import {randomUUID} from 'node:crypto';
import {parseCallback} from '../messages/callbacks.mjs';
import {plainJSON} from '../widgets/contract.mjs';
import {inlineError} from './contract.mjs';
const bad=message=>{throw inlineError('invalid_argument',message);};
export function validatePermits(permits) {
  if(permits==null)return;
  if(typeof permits!=='object'||Array.isArray(permits))bad('Permits must be a rule map or null.');
  for(const [key,rule]of Object.entries(permits))if(!key||rule!==null&&(!Array.isArray(rule)||rule.some(id=>!Number.isSafeInteger(id)||id<=0)))bad('Permit rules must be null or arrays of user IDs.');
}
export function prepareActionButtons(input,{tipId,permits=input.permits,ids=()=>randomUUID().replaceAll('-','')}={}) {
  const native=JSON.parse(plainJSON(input)),definitions=[];let count=0;
  validatePermits(permits);delete native.permits;
  function button(value,{rich=false}={}) {
    if(!value||typeof value!=='object'||Array.isArray(value)||(!rich&&typeof value.text!=='string')||value.text===undefined)bad('A button needs text.');
    if('pay'in value||'callback_game'in value)bad('Games and payment buttons are not supported.');
    const {action,key,group,permits:ownPermits,...result}=value;
    if(action!==undefined) {
      if(typeof action!=='string'||!action.trim())bad('A button action must be a nonempty instruction.');
      const logicalKey=key??`button${++count}`,callbackKey=group===undefined?logicalKey:`[${group}]${logicalKey}`;
      if(typeof logicalKey!=='string'||group!==undefined&&typeof group!=='string')bad('Button key and group must be strings.');
      try{parseCallback(callbackKey);}catch{bad('Button key/group must contain 1–20 characters without brackets.');}
      const effective=ownPermits===undefined?permits:ownPermits;validatePermits(effective);
      if(Object.keys(result).some(field=>!['text','icon_custom_emoji_id','style'].includes(field)))bad('An action button cannot also have a native client action.');
      const btnId=ids();if(typeof btnId!=='string'||!/^[a-zA-Z0-9_-]+$/.test(btnId)||Buffer.byteLength('i:'+btnId)>64)bad('Invalid generated button ID.');
      definitions.push({btnId,tipId,key:logicalKey,callbackKey,...(group!==undefined?{group}:{}),permits:effective??null,action,component:rich?'rich':'keyboard'});
      result.callback_data='i:'+btnId;return result;
    }
    if('callback_data'in result)bad('Inline callbacks require an action instruction; raw callback_data is not accepted.');
    const choices=['url','login_url','web_app','switch_inline_query','switch_inline_query_current_chat','switch_inline_query_chosen_chat','copy_text','disabled'];
    if(choices.filter(field=>field in result).length!==1||Object.keys(result).some(field=>!['text','icon_custom_emoji_id','style',...choices].includes(field)))bad('Specify exactly one supported button action.');
    return result;
  }
  function row(items,rich=false){if(!Array.isArray(items)||items.length<1||items.length>8)bad('A button row must contain 1–8 buttons.');return items.map(item=>button(item,{rich}));}
  if(native.buttons!==undefined) {
    if(native.reply_markup!==undefined)bad('Use buttons or reply_markup, not both.');
    if(!Array.isArray(native.buttons))bad('buttons must be an array.');
    const rows=native.buttons.length&&!Array.isArray(native.buttons[0])?[native.buttons]:native.buttons;
    native.reply_markup={inline_keyboard:rows.map(items=>row(items))};delete native.buttons;
  } else if(native.reply_markup!==undefined) {
    if(!native.reply_markup||!Array.isArray(native.reply_markup.inline_keyboard))bad('reply_markup must contain inline_keyboard rows.');
    native.reply_markup.inline_keyboard=native.reply_markup.inline_keyboard.map(items=>row(items));
  }
  function visit(value) {
    if(!value||typeof value!=='object')return;
    if(value.type==='buttons')value.buttons=row(value.buttons,true);
    if(value.type==='button')value.button=button(value.button,{rich:true});
    for(const child of Object.values(value))visit(child);
  }
  visit(native.rich_message);return {native,definitions};
}
