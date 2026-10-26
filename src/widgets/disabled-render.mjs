/** Keep the last confirmed rich body visible while making its buttons inert. */
export function disabledRender(body){
  const copy=structuredClone(body);
  const disable=button=>{
    for(const key of Object.keys(button))
      if(!["text","icon_custom_emoji_id","style"].includes(key))delete button[key];
    button.disabled={};
  };
  const visit=value=>{
    if(!value||typeof value!=="object")return;
    if(value.type==="button"&&value.button)disable(value.button);
    if(value.type==="buttons"&&Array.isArray(value.buttons))
      for(const button of value.buttons)disable(button);
    for(const child of Object.values(value))visit(child);
  };
  visit(copy.rich_message);
  return copy;
}
