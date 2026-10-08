export const syntaxError = message => Object.assign(new Error(message), { safe: true });
export function parseArguments(text, entities = [], start = 0) {
  const result = [], blocks = [];
  const lexical = new Set(['bot_command', 'url', 'mention', 'hashtag', 'cashtag', 'email', 'phone_number']);
  for (const e of entities) {
    if (!Number.isInteger(e.offset) || !Number.isInteger(e.length) || e.offset < 0 || e.length < 1 || e.offset + e.length > text.length) throw syntaxError('Invalid command entity range.');
    if (!['code', 'pre'].includes(e.type)) {
      if (!lexical.has(e.type)) throw syntaxError('Unsupported formatting. Commands accept only code and pre blocks.');
      continue;
    }
    if (e.offset < start) throw syntaxError('Formatting cannot overlap the command name.');
    blocks.push(e);
  }
  blocks.sort((a,b)=>a.offset-b.offset);
  let position = start;
  const plain = value => { for (const word of value.match(/\S+/gu) ?? []) result.push({ type:'text', value:word }); };
  for (const e of blocks) {
    if (e.offset < position) throw syntaxError('Command blocks cannot overlap.');
    plain(text.slice(position,e.offset)); result.push({type:e.type,value:text.slice(e.offset,e.offset+e.length)}); position=e.offset+e.length;
  }
  plain(text.slice(position)); return result;
}
export function validateArguments(name, args) {
  const counts = { clear:[0,1],set_triggers:[0,200],triggers:[0,0], newbot:[1,2],bots:[0,0],set_owner:[2,2],delete_bot:[1,3],set_user:[1,2],remove_user:[1,1],transfer_owner:[1,1],users:[0,1],agents:[0,1],chats:[0,1],agent_messages:[1,2],tasks:[0,1],task:[1,1],retry_task:[1,1],cancel_task:[1,1],models:[0,0],get_model:[0,1],set_model:[1,2],stop_agent:[1,1],leave:[0,0],leave_chat:[1,1],rules:[0,0],set_rules:[0,1],ls:[0,1],cat:[1,1],download:[1,1],upload:[1,1],rm:[1,1],mv:[2,2],edit:[2,2],cleanup_temp:[0,0],git_setup:[0,3],git_changes:[0,0],git_sync:[1,Infinity] };
  const bounds=counts[name];
  if(bounds && (args.length<bounds[0] || args.length>bounds[1])) throw syntaxError(`Invalid arguments for /${name}. Expected ${bounds[0]}${bounds[1]!==bounds[0] ? '–'+bounds[1] : ''}.`);
  if(name==='edit') { if(args[1]?.type!=='pre' || args[0]?.type==='pre') throw syntaxError('/edit requires a path followed by a pre block.'); }
  else if(name!=='git_sync' && args.some(a=>a.type==='pre')) throw syntaxError(`/${name} does not accept pre blocks.`);
}
