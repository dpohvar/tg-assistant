export const INLINE_POLICY=Object.freeze({triggerMs:2000,waitMs:5000,requestTtlMs:3600000,promptRows:Object.freeze([6,6,20]),pageSize:50});
export function inlineError(code,message=code){return Object.assign(new Error(message),{code});}
export function inlinePolicy(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw inlineError('invalid_argument','inline must be an object.');
  for(const [key,value] of Object.entries(input)){
    const rows=key==='promptRows'?(Array.isArray(value)?value:[value]):null;
    if(!['triggerMs','waitMs','promptRows'].includes(key)||(rows?(!rows.length||rows.length>50||rows.some(n=>!Number.isSafeInteger(n)||n<1||n>50)):(!Number.isSafeInteger(value)||value<0)))
      throw inlineError('invalid_argument','Invalid inline policy field: '+key);
  }
  return Object.freeze({...INLINE_POLICY,...input,...(Array.isArray(input.promptRows)?{promptRows:Object.freeze([...input.promptRows])}:{})});
}
