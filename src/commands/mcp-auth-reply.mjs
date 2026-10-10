import {parseArguments,syntaxError} from './arguments.mjs';
import {commandError} from './contract.mjs';
const callbackText=text=>{try{const u=new URL((text??'').trim());return ['http:','https:'].includes(u.protocol)&&u.searchParams.has('state')&&(u.searchParams.has('code')||u.searchParams.has('error'));}catch{return false;}};
export const isMcpAuthReply=(m,oauth,botId)=>/^\/mcp(?:@[\w]+)?\s+auth(?:\s|$)/i.test(m.reply_to_message?.text??'')||callbackText(m.text)||callbackText(m.reply_to_message?.text)||oauth?.hasInvitation?.(botId,m.reply_to_message?.chat?.id,m.reply_to_message?.message_id)||Boolean(m.edit_date!==undefined&&oauth?.hasInvitation?.(botId,m.chat.id,m.message_id));
export async function handleMcpAuthReply({botId,message:m,db,telegram,mcpOAuth}){
  const send=text=>telegram.call(botId,'sendMessage',{chat_id:m.chat.id,text,reply_parameters:{message_id:m.message_id}});
  try{
    const role=db.role(botId,m.from?.id);
    if(botId==='master'||m.chat.type!=='private')throw syntaxError('OAuth callback replies are available only in private chats with a child bot.');
    if(!role)return true;
    if(!['admin','owner'].includes(role))throw syntaxError('Admin role required.');
    const q=m.reply_to_message;
    if(!q)throw syntaxError('Send the callback as a reply to your own /mcp auth NAME command.');
    if(q.from?.id!==m.from.id||q.sender_chat||m.sender_chat||q.chat?.id!==m.chat.id)throw syntaxError('Reply to your own /mcp auth command in this chat.');
    if(q.edit_date!==undefined||m.edit_date!==undefined)throw syntaxError('OAuth command and callback must not be edited. Start a new /mcp auth command.');
    const match=/^\/mcp(?:@([\w]+))?(?:\s|$)/i.exec(q.text);
    if(!match)throw syntaxError('The original OAuth command was changed. Start /mcp auth again.');
    if(match[1]&&match[1].toLowerCase()!==db.getBot(botId)?.username.toLowerCase())throw syntaxError('The quoted command addresses another bot.');
    const parts=parseArguments(q.text,q.entities,match[0].trimEnd().length);
    if(parts.length!==2||parts[0].value!=='auth'||parts.some(p=>p.type==='pre'))throw syntaxError('Reply to an unchanged /mcp auth NAME command.');
    if(!mcpOAuth)throw syntaxError('OAuth runtime is not configured.');
    if(typeof m.text!=='string'||m.document||m.forward_origin||m.entities?.some(e=>!['url','code','spoiler'].includes(e.type)))throw syntaxError('Send only the complete callback URL as text.');
    const value=m.text.trim();
    const finish=()=>{if(!['admin','owner'].includes(db.role(botId,m.from.id)))throw syntaxError('Admin role required.');return mcpOAuth.finish({botId,name:parts[1].value,userId:m.from.id,chatId:m.chat.id,messageId:q.message_id},value);};
    if(mcpOAuth.withConnection)await mcpOAuth.withConnection(botId,parts[1].value,finish);else await finish();
    await send('OAuth connected. Active agents will reload after their current work.');
  }catch(e){await send(commandError('mcp',e.safe?e.message:'OAuth callback could not be processed. Start /mcp auth again.'));}
  finally{try{await telegram.call(botId,'deleteMessage',{chat_id:m.chat.id,message_id:m.message_id});}catch{}}
  return true;
}
