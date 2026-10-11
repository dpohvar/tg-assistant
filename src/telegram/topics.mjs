export const topicServices = ['forum_topic_created','forum_topic_edited','forum_topic_closed','forum_topic_reopened','general_forum_topic_hidden','general_forum_topic_unhidden'];
export function topicIdOf(message) {
 if (message?.chat?.is_forum !== true || message.topicUnknown) return null;
 return Number.isSafeInteger(message.message_thread_id) && message.message_thread_id > 0 ? message.message_thread_id : 1;
}
export const topicFields = message => {const topicId=topicIdOf(message);return topicId===null?{}:{topicId};};
export function validateTopicId(topicId) {
 if (topicId !== undefined && (!Number.isSafeInteger(topicId)||topicId<1)) throw Object.assign(new Error('topicId must be a positive integer.'),{code:'invalid_argument'});
}
export function destinationFields({chat,topicId,hasReply=false,replyMessage}) {
 validateTopicId(topicId);
 if(topicId===undefined)return {};
 if(!chat?.is_forum)throw new Error('Topic destinations require a currently enabled forum chat.');
 if(topicId===1&&hasReply&&topicIdOf(replyMessage)!==1)throw new Error('Explicit General cannot safely reply to an unknown or different topic. Remove reply_parameters to send to General.');
 return topicId===1?{}:{message_thread_id:topicId};
}
