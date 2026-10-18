// Only confirmed address/access failures imply loss of a view. Transport and
// payload errors leave ownership intact for a later explicit retry.
export function viewLossReason(error) {
  if(error.code!=='telegram_api_error')return null;
  if(/\b(?:message to edit not found|message not found|message_id_invalid)\b/i.test(error.message))return 'message_not_found';
  if(/\b(?:bot was kicked|bot is not a member|chat not found|chat_write_forbidden|not enough rights to send|have no rights to send)\b/i.test(error.message))return 'access_lost';
  return null;
}
