import{readFileSync,statSync,writeFileSync,renameSync,mkdirSync,rmdirSync,appendFileSync,existsSync,unlinkSync}from'node:fs';
import{join}from'node:path';
export const normalizeWord=value=>String(value??'').toLocaleUpperCase('ru-RU').replace(/Ё/g,'Е');
export const validWord=word=>/^[А-Я]{4,8}$/.test(word);
const lengths=[4,5,6,7,8];
export function createDictionaryStore(base='widgets/wordle'){
 const cache=new Map(),merged=new Map(),file=key=>join(base,`wordle-dictionary-${key}.txt`);
 function load(key){if(!/^[4-8](?:-select)?$/.test(String(key)))throw Error('Недопустимая длина словаря');const path=file(key),st=statSync(path,{bigint:true}),signature=[st.ino,st.size,st.mtimeNs,st.ctimeNs].join(':');let c=cache.get(key);if(!c||c.signature!==signature){const n=Number(String(key)[0]),words=[...new Set(normalizeWord(readFileSync(path,'utf8')).trim().split(/\s+/).filter(Boolean))];if(words.some(w=>!validWord(w)||w.length!==n))throw Error('Некорректный словарь '+key);words.sort((a,b)=>a.localeCompare(b,'ru'));c={signature,words,set:new Set(words)};cache.set(key,c);}return c;}
 const selected=n=>load(`${n}-select`);
 const words=n=>{const common=load(n),pool=selected(n);let c=merged.get(n);if(!c||c.common!==common||c.pool!==pool){const values=[...new Set([...common.words,...pool.words])];values.sort((a,b)=>a.localeCompare(b,'ru'));c={common,pool,words:values};merged.set(n,c);}return c.words;};
 const has=(value,n)=>{const word=normalizeWord(value);return load(n).set.has(word)||selected(n).set.has(word);};
 function find(value){const word=normalizeWord(value);return word?lengths.filter(n=>has(word,n)):[];}
 function edit(value,action,actorId,auditDir){
  const word=normalizeWord(value);if(!validWord(word))throw Error('Нужно слово из 4–8 русских букв');if(!['add','remove','enable','disable'].includes(action))throw Error('Неизвестное действие');
  const lock=join(base,'.dictionary-edit.lock');try{mkdirSync(lock);}catch(e){if(e.code==='EEXIST')throw Error('Словарь занят, повтори нажатие');throw e;}
  try{
   const n=word.length,common=new Set(load(n).words),pool=new Set(selected(n).words),found=common.has(word)||pool.has(word);
   if(['enable','disable'].includes(action)&&!found)throw Error('Слова уже нет в базе');
   if(action==='add'){if(found)return{word,changed:0,lengths:[]};common.add(word);pool.add(word);}
   if(action==='remove'){common.delete(word);pool.delete(word);}
   if(action==='enable')pool.add(word);
   if(action==='disable'){common.add(word);pool.delete(word);}
   const changes=[];for(const[key,set]of[[n,common],[`${n}-select`,pool]]){const content=[...set].sort((a,b)=>a.localeCompare(b,'ru')).join('\n')+(set.size?'\n':'');const old=readFileSync(file(key),'utf8');if(content!==old)changes.push({key,content,old});}
   if(!changes.length)return{word,changed:0,lengths:[]};
   const audit={at:new Date().toISOString(),actor_id:actorId,action,word,lengths:changes.map(x=>x.key)};
   const log=phase=>{if(auditDir){mkdirSync(auditDir,{recursive:true});appendFileSync(join(auditDir,'wordle-dictionary-edits.jsonl'),JSON.stringify({...audit,phase})+'\n',{mode:0o600});}};
   log('requested');
   const applied=[];try{
    for(const c of changes)writeFileSync(file(c.key)+'.admin.tmp',c.content);
    for(const c of changes){renameSync(file(c.key)+'.admin.tmp',file(c.key));applied.push(c);cache.delete(c.key);}
   }catch(e){for(const c of applied){writeFileSync(file(c.key)+'.rollback.tmp',c.old);renameSync(file(c.key)+'.rollback.tmp',file(c.key));cache.delete(c.key);}log('rolled_back');throw Error('Не удалось сохранить словари: '+e.message);}
   finally{for(const c of changes){const p=file(c.key)+'.admin.tmp';if(existsSync(p))unlinkSync(p);}}
   log('committed');return{word,changed:changes.length,lengths:changes.map(x=>x.key)};
  }finally{rmdirSync(lock);}
 }
 return{words,selectionWords:n=>selected(n).words,has,find,edit,isUsed:value=>{const word=normalizeWord(value);return validWord(word)&&selected(word.length).set.has(word);}};
}
export const dictionaryStore=createDictionaryStore();
