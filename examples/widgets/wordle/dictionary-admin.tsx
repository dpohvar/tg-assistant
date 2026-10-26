import React,{useLayoutEffect} from "react";
import {defineStore,useDispatch,useSelector,useView} from "@tg-assistant/widget";
import {dictionaryStore,normalizeWord,validWord} from "./dictionary-store.mjs";
import {tile} from "./emoji.mjs";

const letters=[..."АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"];
const modes=["4","5","6","7","8","add"],PAGE_SIZE=20;
defineStore({version:1,initialState:{mode:"5",input:"",pages:{},notice:"",auditChatId:null}});

export function searchWords(input){
  const pattern=normalizeWord(input).replace(/[⭐★]/gu,"*");
  if(!pattern||!/^[А-Я*]{1,8}$/.test(pattern))return [];
  if(!pattern.includes("*"))return dictionaryStore.find(pattern).length?[pattern]:[];
  if(pattern.length<4||pattern.length>8)return [];
  const expression=new RegExp("^"+pattern.replaceAll("*","[А-Я]")+"$");
  return dictionaryStore.words(pattern.length).filter(word=>expression.test(word));
}
function listing(state){
  const mode=String(state.mode),key=mode==="add"?"add":Number(mode);
  const words=mode==="add"?searchWords(state.input):dictionaryStore.words(key);
  const last=Math.max(0,Math.ceil(words.length/PAGE_SIZE)-1);
  const raw=Number(state.pages?.[mode]),page=Math.min(last,Math.max(0,
    Number.isSafeInteger(raw)?raw:0));
  return {words,page,last,start:page*PAGE_SIZE};
}
function LetterTile({letter="",found=false}){
  const image=tile(letter==="*"?"★":letter,letter&&found?letter==="*"?"blue":"green":undefined);
  return <tg-emoji id={image.custom_emoji_id}>{image.alternative_text}</tg-emoji>;
}

export default function Runtime({children,auditChatId}){
  const current=useSelector(state=>state.auditChatId),dispatch=useDispatch();
  useLayoutEffect(()=>{
    if(current===null&&Number.isSafeInteger(auditChatId)&&auditChatId!==0)
      dispatch(draft=>{draft.auditChatId=auditChatId;});
  },[auditChatId,current,dispatch]);
  return <>{children}</>;
}

export function Editor(){
  const state=useSelector(value=>value),dispatch=useDispatch(),view=useView();
  const mode=modes.includes(String(state.mode))?String(state.mode):"5";
  const {words,page,last,start}=listing({...state,mode});
  const update=recipe=>dispatch(draft=>{recipe(draft);draft.notice="";});
  const setMode=next=>update(draft=>{draft.mode=next;draft.pages[next]=0;});
  const changePage=value=>update(draft=>{draft.pages[mode]=Math.min(last,Math.max(0,value));});
  const enter=key=>update(draft=>{
    if(draft.mode!=="add")return;
    const input=normalizeWord(draft.input).replace(/[^А-Я*]/g,"").slice(0,8);
    if(key==="backspace")draft.input=input.slice(0,-1);
    else if(key==="delete")draft.input="";
    else if(key==="star"&&input.length<8)draft.input=input+"*";
    else if(letters.includes(key)&&input.length<8)draft.input=input+key;
    draft.pages.add=0;
  });
  const edit=async(event,word,action,desired)=>{
    const actor=event.from?.id;
    if(!Number.isSafeInteger(actor)||actor<1||!validWord(word))return;
    const current=listing({...state,mode});
    if(action==="add"){
      if(mode!=="add"||state.input.includes("*")||normalizeWord(state.input)!==word){
        await event.respond({text:"Ввод изменился. Проверь слово и нажми заново.",showAlert:true});return;
      }
    }else if(!current.words.slice(current.start,current.start+PAGE_SIZE).includes(word)){
      await event.respond({text:"Результаты изменились. Проверь слово и нажми заново.",showAlert:true});return;
    }
    const chatId=state.auditChatId??view.target?.chatId;
    if(!Number.isSafeInteger(chatId)||chatId===0){
      await event.respond({text:"Не задан чат журнала редактора.",showAlert:true});return;
    }
    const absoluteAction=action==="use"?(desired?"enable":"disable"):action;
    try{
      const result=dictionaryStore.edit(word,absoluteAction,actor,`chats/${chatId}`);
      const labels={add:"Добавлено с ✅ Use: ",remove:"Удалено: ",
        enable:"✅ Use: ",disable:"⬜️ Use: "};
      dispatch(draft=>{
        draft.notice=result.changed?labels[absoluteAction]+word:"Без изменений: "+word;
        draft.pages[draft.mode]=Math.min(draft.pages[draft.mode]??0,listing(draft).last);
      });
    }catch(error){
      dispatch(draft=>{draft.notice=String(error.message).slice(0,300);});
      await event.respond({text:String(error.message).slice(0,200),showAlert:true});
    }
  };
  const table=<table compact>{words.slice(start,start+PAGE_SIZE).map(word=>{
    const used=dictionaryStore.isUsed(word);
    return <tr key={word}>
      <td>{word}</td>
      <td><tg-button key={`${word}:${used?1:0}`} onClick={event=>edit(event,word,"use",!used)}>
        {used?"✅":"⬜️"} Use</tg-button></td>
      <td><tg-button style="danger" onClick={event=>edit(event,word,"remove")}>❌ Remove</tg-button></td>
    </tr>;
  })}</table>;
  const pagination=last>0?<tg-button-row>
    <tg-button disabled={page<=0} onClick={page>0?()=>changePage(page-20):undefined}>⏮</tg-button>
    <tg-button disabled={page<=0} onClick={page>0?()=>changePage(page-1):undefined}>◀️</tg-button>
    <tg-button disabled>{start+1}-{Math.min(start+PAGE_SIZE,words.length)} / {words.length}</tg-button>
    <tg-button disabled={page>=last} onClick={page<last?()=>changePage(page+1):undefined}>▶️</tg-button>
    <tg-button disabled={page>=last} onClick={page<last?()=>changePage(page+20):undefined}>⏭</tg-button>
  </tg-button-row>:null;
  return <>
    <tg-button-row>{modes.map((choice,index)=><tg-button key={choice}
      {...(choice===mode?{style:"primary"}:{})}
      disabled={choice===mode} onClick={choice===mode?undefined:()=>setMode(choice)}>
      {choice==="add"?"✏️":`${index+4}⃣`}</tg-button>)}</tg-button-row>
    <h2>Редактор базы Wordle</h2>
    {mode==="add"?<>
      <p>{Array.from({length:8},(_,i)=><LetterTile key={i}
        letter={state.input[i]??""} found={words.length>0}/>)}</p>
      <table compact bordered>{Array.from({length:4},(_,row)=><tr key={row}>
        {letters.slice(row*8,row*8+8).map(letter=><td key={letter} align="center" valign="middle">
          <tg-button style="link" {...(state.input.length<8
            ?{onClick:()=>enter(letter)}:{disabled:true})}>
            <LetterTile letter={letter}/>
          </tg-button>
        </td>)}
      </tr>)}</table>
      <tg-button-row>
        <tg-button {...(state.input?{onClick:()=>enter("backspace")}:{disabled:true})}>⌫ backspace</tg-button>
        <tg-button style="danger" {...(state.input?{onClick:()=>enter("delete")}:{disabled:true})}>DELETE</tg-button>
        <tg-button {...(state.input.length<8?{onClick:()=>enter("star")}:{disabled:true})}>⭐</tg-button>
      </tg-button-row>
      <hr/>
    </>:null}
    {words.length?table:mode==="add"&&state.input.includes("*")?
      <p>not found</p>:mode!=="add"?<p>Словарь пуст.</p>:null}
    {pagination}
    {mode==="add"&&state.input&&!state.input.includes("*")&&!words.length?
      <tg-button-row><tg-button style="success"
        disabled={!validWord(normalizeWord(state.input))}
        onClick={validWord(normalizeWord(state.input))?event=>edit(event,normalizeWord(state.input),"add"):undefined}>
        ➕ Add</tg-button></tg-button-row>:null}
    {state.notice?<p>{state.notice}</p>:null}
  </>;
}
