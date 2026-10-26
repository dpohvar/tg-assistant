import { randomBytes } from "node:crypto";
import { normalizeRender } from "./jsx-runtime.mjs";
import { plainJSON, widgetError } from "./contract.mjs";

const callbackIds=new WeakMap();
const richTags=new Set([
  "p","b","strong","i","em","u","ins","s","strike","del","mark","code","pre",
  "blockquote","span","br","a","h1","h2","h3","h4","h5","h6","footer","hr",
  "table","caption","tr","td","th","img","figure","figcaption","ul","ol","li",
  "details","summary","tg-spoiler","tg-emoji","tg-time","tg-reference","tg-math",
  "tg-math-block","tg-map","tg-slideshow","tg-collage","tg-document","video",
  "audio","animation","document","voice","voice-note","tg-button","tg-button-row",
]);
const richAttrs={
  table:new Set(["bordered","striped","compact"]),
  td:new Set(["align","valign","colspan","rowspan"]),
  th:new Set(["align","valign","colspan","rowspan"]),
  img:new Set(["src","alt","width","height","caption"]),
  a:new Set(["href","name"]),
  span:new Set(["class","className"]),
  "tg-button":new Set(["onClick","url","style","icon_custom_emoji_id","disabled","copy_text","switch_inline_query","switch_inline_query_current_chat","switch_inline_query_chosen_chat"]),
  "tg-emoji":new Set(["id","emoji-id"]),
  "tg-time":new Set(["unix","format"]),
  "tg-reference":new Set(["name"]),
  "tg-map":new Set(["lat","long","zoom","width","height"]),
  video:new Set(["src","caption","width","height"]),
  audio:new Set(["src","caption"]),
  animation:new Set(["src","caption"]),
  document:new Set(["src","caption"]),
  voice:new Set(["src","caption"]),
};
const isNode=value=>value&&typeof value==="object"&&typeof value.type==="string";
const children=node=>node.children??[];
function ensureProps(node,allowed) {
  for(const key of Object.keys(node.props??{}))
    if(key!=="children"&&!allowed.has(key))
      throw widgetError("invalid_argument",`Unsupported ${node.type} attribute ${key}.`);
}
function callback(node,viewId,callbacks) {
  if(typeof node.props?.onClick!=="function")return null;
  let entry=callbackIds.get(node);
  if(!entry||entry.viewId!==viewId){
    entry={viewId,token:`w:${viewId}:${randomBytes(12).toString("base64url")}`};
    callbackIds.set(node,entry);
  }
  if(Buffer.byteLength(entry.token)>64)throw widgetError("invalid_argument","Callback token exceeds Telegram limit.");
  callbacks.set(entry.token,node.props.onClick);
  return entry.token;
}
function buttonText(node) {
  return children(node).map(child=>child.type==="#text"?child.text:buttonText(child)).join("");
}
function nativeButton(node,viewId,callbacks) {
  if(node.type!=="tg-button")throw widgetError("invalid_argument","Keyboard rows contain buttons only.");
  ensureProps(node,richAttrs["tg-button"]);
  const text=buttonText(node),token=callback(node,viewId,callbacks),p=node.props??{};
  const address=[token,p.url,p.copy_text,p.switch_inline_query,p.switch_inline_query_current_chat,
    p.switch_inline_query_chosen_chat,p.disabled].filter(value=>value!==undefined&&value!==null&&value!==false);
  if(address.length!==1)throw widgetError("invalid_argument","A button needs exactly one action.");
  return {text,...(token?{callback_data:token}:p.url?{url:p.url}:p.copy_text
    ?{copy_text:{text:p.copy_text}}:p.switch_inline_query!==undefined
      ?{switch_inline_query:p.switch_inline_query}:p.switch_inline_query_current_chat!==undefined
        ?{switch_inline_query_current_chat:p.switch_inline_query_current_chat}:p.disabled
          ?{disabled:{}}:{switch_inline_query_chosen_chat:p.switch_inline_query_chosen_chat}),
    ...(p.style?{style:p.style}:{}),
    ...(p.icon_custom_emoji_id?{icon_custom_emoji_id:p.icon_custom_emoji_id}:{})};
}
function keyboard(node,viewId,callbacks,rows) {
  ensureProps(node,new Set());
  for(const row of children(node)) {
    if(row.type!=="tg-button-row")throw widgetError("invalid_argument","Keyboard children must be rows.");
    ensureProps(row,new Set());
    rows.push(children(row).map(child=>nativeButton(child,viewId,callbacks)));
  }
}
function convert(node,viewId,callbacks,rows) {
  if(node.type==="#text")return node.text;
  if(node.type==="tg-keyboard"){keyboard(node,viewId,callbacks,rows);return null;}
  if(!richTags.has(node.type))throw widgetError("invalid_argument",`Unsupported rich tag ${node.type}.`);
  ensureProps(node,richAttrs[node.type]??new Set());
  const props={...node.props};
  if(node.type==="tg-button"){
    const token=callback(node,viewId,callbacks);
    if(token){props.type="callback_data";props.data=token;}
    else if(props.url)props.type="url";
    else if(props.disabled)props.type="disabled";
    else throw widgetError("invalid_argument","Rich button needs one action.");
    delete props.onClick;
  }
  const converted=children(node).map(child=>convert(child,viewId,callbacks,rows)).filter(x=>x!==null);
  props.children=converted;
  return {$widget:true,type:node.type,props};
}
function bodyKind(body) {
  return body?.dice!==undefined?"dice":body?.sticker!==undefined?"sticker":"rich_message";
}

/** Produce one validated Telegram body and the live callback closure table. */
export function projectHostTree(tree,{priorBody,creating=false}={}) {
  if(!tree||tree.type!=="widget-view")throw widgetError("invalid_argument","Projection needs one view root.");
  const viewId=tree.props?.viewId;
  if(typeof viewId!=="string"||!viewId)throw widgetError("invalid_argument","Missing view ID.");
  const callbacks=new Map(),rows=[];
  let native=null;
  const rich=[];
  for(const child of children(tree)){
    if(["tg-dice","tg-sticker"].includes(child.type)){
      if(native)throw widgetError("invalid_argument","Only one native body is allowed.");
      native=child;
    } else {
      const item=convert(child,viewId,callbacks,rows);
      if(item!==null)rich.push(item);
    }
  }
  if(native&&rich.length)throw widgetError("invalid_argument","Native body cannot contain rich blocks.");
  let body;
  if(native){
    ensureProps(native,new Set([native.type==="tg-dice"?"emoji":"src"]));
    body=native.type==="tg-dice"?{dice:{emoji:native.props.emoji??"🎲"}}
      :{sticker:native.props.src};
    if(native.type==="tg-sticker"&&(typeof body.sticker!=="string"||!body.sticker))
      throw widgetError("invalid_argument","Sticker src is required.");
  } else body=normalizeRender(rich.length?rich:{$widget:true,type:"p",props:{children:""}});
  const kind=bodyKind(body);
  if(!creating&&priorBody){
    const priorKind=bodyKind(priorBody);
    if(kind!==priorKind || (kind!=="rich_message"&&JSON.stringify(body)!==JSON.stringify(priorBody)))
      throw widgetError("render_failed","A native dice or sticker body cannot be edited or replaced.");
  }
  plainJSON(body);
  const replyMarkup=rows.length?{inline_keyboard:rows}:null;
  if(replyMarkup)plainJSON(replyMarkup);
  return {kind,body,replyMarkup,callbacks};
}
