const descriptions={say:'Send a hidden message to the chat agent',help:'Command help',start:'Getting started',agent:'Manage agents',task:'Manage scheduled tasks',chat:'Manage connected chats',triggers:'Manage chat triggers',user:'Manage users',owner:'Manage ownership',rules:'Manage bot rules',browse:'Browse files interactively',ls:'List files',cat:'Read a text file',download:'Download a file',upload:'Upload a document',edit:'Write a text file',mv:'Move a file',rm:'Remove a file',git:'Manage Git',temp:'Manage temporary files',vault:'Manage secrets',ws:'Manage WebSocket connections',mcp:'Manage MCP connections',widget:'Manage widgets'};
export async function registerGroupCommands({telegram,botId}){
  if(botId==='master')return;
  const commands=Object.entries(descriptions).map(([command,description])=>({command,description,is_ephemeral:true}));
  for(const type of ['all_group_chats','all_chat_administrators'])for(const language_code of ['','en','ru'])await telegram.call(botId,'setMyCommands',{scope:{type},language_code,commands});
}
