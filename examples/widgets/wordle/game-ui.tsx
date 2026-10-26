import React,{createContext,useContext,useEffect,useLayoutEffect} from "react";
import {useDispatch,useSelector,useView,useWidget} from "@tg-assistant/widget";
import {createInitialState,startPlayer,typeKey,backspace,clearInput,submitGuess,
  selectRankedPlayers,selectProgress,scoreGuess} from "./model.mjs";
import {tile} from "./emoji.mjs";

const GameContext=createContext(null);
const palette={absent:"⬛️",present:"🟨",correct:"🟩"};
const nameOf=user=>[user?.first_name,user?.last_name].filter(Boolean).join(" ")||
  user?.username||`Игрок ${user?.id}`;
const duration=player=>player.finishedAt===null||player.startedAt===null?"":
  `${Math.floor((player.finishedAt-player.startedAt)/60000)}:${String(
    Math.floor((player.finishedAt-player.startedAt)/1000)%60).padStart(2,"0")}`;

function useGame(){const value=useContext(GameContext);if(!value)throw Error("Game Runtime is missing.");return value;}

export function createGameUI(config){
  function LetterTile({letter="",color="neutral"}){
    const selected=tile(letter,color==="correct"?"green":color==="present"?"blue":
      color==="neutral"?"red":undefined);
    return <tg-emoji id={selected.custom_emoji_id}>{selected.alternative_text}</tg-emoji>;
  }

  async function acceptGuess({dispatch,widget,notify,userId,guess,now,sessionViewId}){
    let outcome=null;
    dispatch(draft=>{
      const session=sessionViewId?draft.sharedSessions[sessionViewId]:null;
      if(sessionViewId&&(!session||session.activeUserId!==userId||session.expiresAt<=now))return;
      const before=draft.players[String(userId)],count=before?.guesses.length??0;
      const previous=before?.status;
      submitGuess({userId,guess,valid:true,now})(draft);
      const player=draft.players[String(userId)];
      if(session)session.expiresAt=now+60_000;
      if(session&&player?.status!=="playing")session.expiresAt=null;
      if(player?.guesses.length===count+1&&previous==="playing"&&
          ["won","lost"].includes(player.status)){
        outcome={title:draft.round.title,name:player.name,status:player.status,
          guesses:player.guesses.length,answer:player.answer??draft.round.sharedAnswer};
      }
    });
    if(outcome&&notify)await widget.notifyAgent({text:
      `${outcome.title}: ${outcome.name} ${outcome.status==="won"?"выиграл":"проиграл"} `+
      `за ${outcome.guesses} попыток. Ответ: ${outcome.answer}.`}).catch(()=>{});
  }

  function Runtime({children,title,titleSuffix="",length=config.defaultLength,
    wordMode="individual",notify=false,blockedUserIds=[]}){
    const round=useSelector(state=>state.round),dispatch=useDispatch();
    useLayoutEffect(()=>{
      if(round)return;
      config.validateLength(length);
      dispatch(draft=>{Object.assign(draft,createInitialState({
        title:String(title??config.title)+(titleSuffix?` · ${titleSuffix}`:""),length,wordMode,
      }));});
    },[round,title,titleSuffix,length,wordMode,dispatch]);
    return <GameContext.Provider value={{config,notify,blockedUserIds}}>{children}</GameContext.Provider>;
  }

  function Progress({state,userId}){
    const rows=selectProgress(state,userId);
    return <>{rows.map((row,index)=><React.Fragment key={index}>
      {index>0?<br/>:null}
      {row.letters===null
        ?row.colors.map(color=>palette[color]).join("")
        :[...row.letters].map((letter,i)=><React.Fragment key={i}>
          {i>0?" ":null}
          {row.colors[i]==="correct"?<mark><b>{letter}</b></mark>:
            row.colors[i]==="present"?<u>{letter}</u>:letter}
        </React.Fragment>)}
    </React.Fragment>)}</>;
  }

  function Players(){
    const state=useSelector(state=>state);
    if(!state.round)return <p>Подготовка игры…</p>;
    const {round}=state,ranked=selectRankedPlayers(state);
    return <>
      <h2>{round.title} · {round.length} {config.title==="NERDLE"?"символов":"букв"}</h2>
      {round.status==="finished"?<>
        <p>Раунд завершён.</p>
        {round.wordMode==="shared"?<p>Ответ: {round.sharedAnswer}</p>
          :<p>{ranked.map(player=>`${player.name}: ${player.answer}`).join("; ")}</p>}
      </>:null}
      <table bordered compact><tr><th>Игрок</th><th>Прогресс</th><th>Длительность</th></tr>
        {ranked.map(player=><tr key={player.userId}>
          <td>{player.name}{player.username?` (@${player.username})`:""}</td>
          <td><Progress state={state} userId={player.userId}/></td>
          <td>{duration(player)}</td>
        </tr>)}
      </table>
    </>;
  }

  function Controls({player,answer,actorId,enabled,paused=false,act}){
    const {config}=useGame();
    const round=useSelector(state=>state.round),length=round?.length??config.defaultLength;
    const input=player?.input??"";
    const keyEnabled=enabled&&[...input].length<length;
    const editEnabled=enabled&&Boolean(input);
    const enterEnabled=enabled&&[...input].length===length;
    const known=new Map(),rank={absent:1,present:2,correct:3};
    if(answer)for(const guess of player?.guesses??[]){
      const colors=scoreGuess(guess,answer);
      [...guess].forEach((key,index)=>{
        const color=colors[index];
        if((rank[color]??0)>(rank[known.get(key)]??0))known.set(key,color);
      });
    }
    const rows=[];
    const width=config.keyboardWidth??8;
    for(let i=0;i<config.keyboard.length;i+=width)rows.push(config.keyboard.slice(i,i+width));
    const Cell=keyEnabled?"td":"th";
    return <>
      <h2>{round?.title} · {length} {config.unit}</h2>
      <p>Ход: {player?.name??"Игрок"}{player?.username?` (@${player.username})`:""}</p>
      {Array.from({length:6},(_,index)=>{
        const guess=player?.guesses[index],letters=[...(guess??
          (index===(player?.guesses.length??0)?input:""))];
        const colors=guess&&answer?scoreGuess(guess,answer):null;
        return <p key={index}>{Array.from({length},(_,column)=><LetterTile key={column}
          letter={letters[column]??""} color={colors?.[column]??"neutral"}/>)}</p>;
      })}
      <hr/>
      <table compact bordered>{rows.map((row,index)=><tr key={index}>
        {row.map(key=><Cell key={key} align="center" valign="middle">
          <tg-button style="link" onClick={event=>{
            if(keyEnabled)return act(event,"key",key);
          }}>
            <LetterTile letter={key} color={known.get(key)??"neutral"}/>
          </tg-button>
        </Cell>)}
      </tr>)}</table>
      <tg-button-row>
        <tg-button style="default" {...(editEnabled
          ?{onClick:event=>act(event,"backspace")}:{disabled:true})}>⌫</tg-button>
        <tg-button style="danger" {...(editEnabled
          ?{onClick:event=>act(event,"delete")}:{disabled:true})}>DELETE</tg-button>
        <tg-button style="success" {...(enterEnabled
          ?{onClick:event=>act(event,"enter")}:{disabled:true})}>Enter</tg-button>
      </tg-button-row>
      <hr/>
      {[["correct",`${config.symbol} на месте`],
        ["present",`${config.symbol} есть в ответе`],
        ["absent",`${config.symbol} отсутствует`]].map(([color,label])=><p key={color}>
          <LetterTile letter="★" color={color}/> — {label}
        </p>)}
      <hr/>
      {player?.status==="won"?<p>Победа! {config.noun}: {answer}</p>:
        player?.status==="lost"?<p>Попытки закончились. {config.noun}: {answer}</p>:
          round?.status==="finished"?<p>Раунд завершён.</p>:
            paused?<p>Игра на паузе.</p>:null}
    </>;
  }

  function PrivateGame(){
    const view=useView(),actorId=view.user?.id;
    const state=useSelector(state=>state),dispatch=useDispatch();
    const widget=useWidget(),{config,notify}=useGame(),player=state.players?.[String(actorId)];
    if(!state.round||!player)return <p>Игра недоступна.</p>;
    const enabled=state.round.status==="open"&&player.status==="playing";
    const act=async(event,action,key)=>{
      if(!enabled||event.from?.id!==actorId)return;
      if(action==="key"){
        dispatch(draft=>{
          const current=draft.players[String(actorId)];
          if(!current||draft.round.status!=="open")return;
          const next=config.appendKey(current.input,key,draft.round.length);
          typeKey({userId:actorId,key:next.slice(current.input.length)})(draft);
        });
      }else if(action==="backspace")dispatch(backspace({userId:actorId}));
      else if(action==="delete")dispatch(clearInput({userId:actorId}));
      else if(action==="enter"){
        const guess=config.normalize(player.input);
        const error=config.validateGuess(guess,state.round.length);
        if(error){await event.respond({text:error,showAlert:true});return;}
        await acceptGuess({dispatch,widget,notify,userId:actorId,guess,now:Date.now()});
      }
    };
    return <><Controls player={player} answer={player.answer??state.round.sharedAnswer}
      actorId={actorId} enabled={enabled} act={act}/>
      <tg-button-row><tg-button onClick={event=>event.view.closeOverlay()}>Закрыть</tg-button>
      </tg-button-row></>;
  }

  function GameInput(){
    const state=useSelector(state=>state),dispatch=useDispatch();
    const {config,blockedUserIds}=useGame();
    if(!state.round)return <p>Подготовка игры…</p>;
    const active=state.round.status==="open";
    const begin=async event=>{
      if(!active||!Number.isSafeInteger(event.from?.id))return;
      if(blockedUserIds.includes(event.from.id)){
        await event.respond({text:"Игра для вас недоступна.",showAlert:true});return;
      }
      const existing=state.players[String(event.from.id)];
      const answer=existing?null:state.round.wordMode==="shared"&&state.round.sharedAnswer
        ?state.round.sharedAnswer:config.selectAnswer(state.round.length);
      if(!existing)dispatch(startPlayer({user:{...event.from,name:nameOf(event.from)},
        answerCandidate:answer,now:Date.now()}));
      await event.overlay(<PrivateGame/>);
    };
    return <>
      <p>{state.round.title}</p>
      <tg-button-row><tg-button style="primary"
        {...(active?{onClick:begin}:{disabled:true})}>Начать / продолжить игру</tg-button>
      </tg-button-row>
    </>;
  }

  function GameInputShared(){
    const view=useView(),state=useSelector(state=>state),dispatch=useDispatch();
    const widget=useWidget(),{config,blockedUserIds,notify}=useGame();
    const round=state.round;
    const session=state.sharedSessions?.[view.id],now=Date.now();
    const shownId=session?.activeUserId??null;
    const activeId=session?.expiresAt>now?shownId:null;
    const player=shownId?state.players[String(shownId)]:null;
    useEffect(()=>{
      if(!session?.expiresAt||!session.activeUserId)return;
      const userId=session.activeUserId,deadline=session.expiresAt;
      const timer=setTimeout(()=>dispatch(draft=>{
        const current=draft.sharedSessions[view.id];
        if(current?.activeUserId===userId&&current.expiresAt===deadline&&Date.now()>=deadline){
          current.expiresAt=null;
        }
      }),Math.max(0,deadline-Date.now()));
      return()=>clearTimeout(timer);
    },[dispatch,view.id,session?.activeUserId,session?.expiresAt]);
    if(!round)return <p>Подготовка игры…</p>;
    if(round.wordMode!=="individual")throw Error("Общий ввод доступен только при индивидуальных ответах.");
    const claim=async event=>{
      if(round.status!=="open"||!Number.isSafeInteger(event.from?.id))return;
      const id=event.from.id,time=Date.now();
      if(blockedUserIds.includes(id)){
        await event.respond({text:"Игра для вас недоступна.",showAlert:true});return;
      }
      if(activeId&&activeId!==id){
        await event.respond({text:`Сейчас играет ${player?.name??"другой игрок"}.`,showAlert:true});return;
      }
      const answer=state.players[String(id)]?null:config.selectAnswer(round.length);
      dispatch(draft=>{
        const current=draft.sharedSessions[view.id]??={activeUserId:null,expiresAt:null};
        if(current.activeUserId&&current.activeUserId!==id&&current.expiresAt>time)return;
        if(!draft.players[String(id)])startPlayer({user:event.from,
          answerCandidate:answer,now:time})(draft);
        current.activeUserId=id;
        current.expiresAt=draft.players[String(id)]?.status==="playing"?time+60_000:null;
      });
    };
    const act=async(event,action,key)=>{
      const id=event.from?.id,time=Date.now();
      if(action==="close"){
        if(activeId&&id!==activeId){
          await event.respond({text:`Сейчас играет ${player?.name??"другой игрок"}.`,
            showAlert:true});return;
        }
        dispatch(draft=>{
          const current=draft.sharedSessions[view.id];
          if(draft.round.status!=="open"||current?.activeUserId!==shownId||
              current.expiresAt>time&&current.activeUserId!==id)return;
          current.activeUserId=null;current.expiresAt=null;
        });
        return;
      }
      if(round.status!=="open"||id!==activeId||session.expiresAt<=time)return;
      if(action==="enter"){
        const guess=config.normalize(player.input),error=config.validateGuess(guess,round.length);
        if(error){await event.respond({text:error,showAlert:true});return;}
        await acceptGuess({dispatch,widget,notify,userId:id,guess,now:time,
          sessionViewId:view.id});
        return;
      }
      dispatch(draft=>{
        const current=draft.sharedSessions[view.id];
        if(draft.round.status!=="open"||current?.activeUserId!==id||current.expiresAt<=time)return;
        if(action==="key"){
          const old=draft.players[String(id)].input;
          const next=config.appendKey(old,key,draft.round.length);
          typeKey({userId:id,key:next.slice(old.length)})(draft);
        }else if(action==="backspace")backspace({userId:id})(draft);
        else if(action==="delete")clearInput({userId:id})(draft);
        current.expiresAt=time+60_000;
      });
    };
    if(round.status==="finished")return <p>Раунд завершён.</p>;
    if(!shownId)return <tg-button-row>
      <tg-button style="primary" onClick={claim}>Начать / продолжить игру</tg-button>
    </tg-button-row>;
    return <>
      <Controls player={player} answer={player?.answer??round.sharedAnswer}
        actorId={shownId} enabled={Boolean(activeId)&&player?.status==="playing"}
        paused={!activeId&&player?.status==="playing"} act={act}/>
      <tg-button-row>
        <tg-button onClick={event=>act(event,"close")}>
          {activeId?"Назад / закрыть":"В меню"}
        </tg-button>
      </tg-button-row>
    </>;
  }

  function GameShared(){
    const round=useSelector(state=>state.round);
    if(round?.wordMode==="shared")throw Error("GameShared недоступен для общего слова.");
    return <><Players/><GameInputShared/></>;
  }
  return {Runtime,Players,GameInput,GameInputShared,GameShared};
}
