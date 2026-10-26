export function formatWidgets(items, start, end, total) {
  const entities = [];
  let text = `${items.length ? start + 1 : 0}-${items.length ? start + items.length : 0} / ${total}`;
  const add = (s, type) => {
    const offset = text.length;
    text += String(s);
    if (type) entities.push({ type, offset, length: String(s).length });
  };
  for (const w of items) {
    add("\n\n");
    add(w.widgetId, "code");
    add(" ");
    add(w.status, "italic");
    add("\n" + w.description + "\n");add('Owner:', 'bold');add(' ');
    add(w.agentId, "code");
    const views=w.views??[];add('\n');add('Views:','bold');add(` ${views.length}`);
    for(const view of views){
      add('\n- ');const target=view.target;
      if(target.ephemeralMessageId){add(`Private recipient ${target.receiverUserId} in chat ${target.chatId}`);continue;}
      if(target.inlineMessageId){add(`${view.chatType??'inline'} ${target.inlineMessageId}`);continue;}
      const address=`${target.chatId}/${target.messageId}`,offset=text.length;add(address);
      let url;
      if(['group','supergroup','channel'].includes(view.chatType)) {
        if(view.chatUsername)url=`https://t.me/${view.chatUsername}/${target.messageId}`;
        else if(String(target.chatId).startsWith('-100'))url=`https://t.me/c/${String(target.chatId).slice(4)}/${target.messageId}`;
      }
      if(url)entities.push({type:'text_link',offset,length:address.length,url});
    }
  }
  return { text, entities };
}
export function formatWidget(w) {
  const result = formatWidgets([w], 0, 1, 1);
  result.text += `\nHandler: ${w.handler ?? "unknown"}\nStore version: ${w.storeVersion??0}; revision: ${w.storeRevision??0}\nCreated: ${new Date(w.createdAt).toISOString()}\nLast error: ${w.lastError?JSON.stringify(w.lastError):'none'}`;
  for(const view of w.views??[])result.text+=`\nView ${view.id} (${view.exportName??'[Function]'}, ${view.status??'active'}): ${JSON.stringify(view.props??{})}; error: ${view.lastError?JSON.stringify(view.lastError):'none'}`;
  for(const candidate of w.possiblePublications??[])result.text+=`\nPossible publication ${candidate.viewId}: ${JSON.stringify(candidate.target)} (${candidate.reason})`;
  return result;
}
