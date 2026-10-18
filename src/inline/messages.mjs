import {inlineError} from './contract.mjs';
import {randomUUID} from 'node:crypto';
import {prepareActionButtons} from './buttons.mjs';
import {validateInlineFiles} from './results.mjs';
import {planNativeEdit} from '../messages/edit-plan.mjs';
export function createInlineMessages({db,store,access,telegram,assertCurrent,withTarget=(_bot,_target,fn)=>fn()}) {
  function address(args) {
    if(typeof args.inlineMessageId!=='string'||!args.inlineMessageId||args.chatId!==undefined||args.messageId!==undefined||args.messageIds!==undefined)throw inlineError('invalid_argument','Use inlineMessageId alone as the message address.');
    return args.inlineMessageId;
  }
  function assertEditable(scope,id) {
    assertCurrent(scope);store.assertOwner(scope,id);
    const view=db.sql.prepare('SELECT * FROM widget_views WHERE botId=? AND inlineMessageId=?').get(scope.botId,id);
    if(view)throw Object.assign(inlineError('widget_owned','Use update_widget, widget_event or set_widget_view for this message.'),{ownerAgentId:view.agentId,widgetId:view.widgetId,viewId:view.viewId});
  }
  return {
    read(scope,args) {
      const id=address(args);assertCurrent(scope);
      if(Object.keys(args).some(key=>key!=='inlineMessageId'))throw inlineError('invalid_argument','Inline read accepts only inlineMessageId.');
      const snapshot=store.read(scope,id);
      if(!snapshot)return {messages:[{inlineMessageId:id,error:'message_not_found',description:'No confirmed saved content is available. This does not establish Telegram deletion.'}]};
      const {snapshotComplete,...content}=snapshot;return {messages:[{...content,partial:!snapshotComplete}]};
    },
    async edit(scope,args) {
      const id=address(args);
      return withTarget(scope.botId,{inlineMessageId:id},async()=>{
        assertEditable(scope,id);
        const {inlineMessageId,file_sources=[],...input}=args;
        const allowed=new Set(['text','rich_message','media','photo','video','animation','document','audio','caption','caption_entities','parse_mode','entities','link_preview_options','reply_markup','buttons','permits']);
        if(Object.keys(input).some(key=>!allowed.has(key)))throw inlineError('invalid_argument','Unsupported inline edit field; uploads are forbidden.');
        validateInlineFiles(scope,input,file_sources,{db,access});
        const prepared=prepareActionButtons(input,{tipId:randomUUID().replaceAll('-','')});
        if(prepared.native.media&&['caption','caption_entities','parse_mode'].some(key=>prepared.native[key]!==undefined))throw inlineError('invalid_argument','Put media caption formatting inside media.');
        const content=['text','rich_message','media','photo','video','animation','document','audio'].filter(key=>prepared.native[key]!==undefined);
        if(content.length>1)throw inlineError('invalid_argument','Specify at most one content kind.');
        const steps=planNativeEdit(null,prepared.native);
        if(!steps.length)throw inlineError('invalid_argument','Specify an editable component. Permits require new action buttons.');
        if(steps.length===2&&steps[1].method==='editMessageReplyMarkup'){steps[0].fields.reply_markup=steps[1].fields.reply_markup;steps.pop();}
        const updated=[];
        try{store.registerPage(scope,[prepared]);}catch{ return {inlineMessageId:id,error:'storage_failed',description:'Action registration failed; no edit was attempted.'};}
        for(const step of steps) {
          assertEditable(scope,id);
          try {await telegram.call(scope.botId,step.method,{inline_message_id:id,...step.fields});}
          catch(error) {
            if(error.code==='telegram_api_error'&&/\bmessage is not modified\b/i.test(error.message)){
              // Telegram confirms that the supplied component already matches.
            } else {
              const unknown=error.code==='telegram_transport_failed';if(unknown)try{store.markUnknown(scope,id);}catch{}
              return {inlineMessageId:id,updated,error:unknown?'delivery_unknown':error.code??'telegram_failed',description:String(error.message).slice(0,1000)};
            }
          }
          try {store.saveConfirmed(scope,id,step.fields);}
          catch {try{store.markUnknown(scope,id);}catch{}return {inlineMessageId:id,updated,error:'storage_failed',description:'Telegram confirmed the edit but saving its snapshot failed. Do not resend automatically.'};}
          updated.push(step.method);
        }
        return {inlineMessageId:id,updated};
      });
    },
  };
}
