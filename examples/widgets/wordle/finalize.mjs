// Preserve custom emoji formatting while removing the button wrapper.
function hasCustomEmoji(value){
 if(!value||typeof value!=='object')return false;
 if(value.type==='custom_emoji')return true;
 return Object.values(value).some(hasCustomEmoji);
}
export function unwrapCustomEmojiButtons(value){
 if(Array.isArray(value))return value.map(unwrapCustomEmojiButtons);
 if(!value||typeof value!=='object')return value;
 if(value.type==='button'&&hasCustomEmoji(value.button?.text))return unwrapCustomEmojiButtons(value.button.text);
 return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,unwrapCustomEmojiButtons(item)]));
}
