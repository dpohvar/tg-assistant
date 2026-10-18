export function messageAddress(target) {
  return target.inlineMessageId
    ? {inline_message_id:target.inlineMessageId}
    : {chat_id:target.chatId,message_id:target.messageId};
}
