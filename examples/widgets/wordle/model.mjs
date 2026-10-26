/** Pure Wordle/Nerdle round recipes. I/O, clocks and random choice stay outside. */
export function createInitialState({title="WORDLE",length=5,wordMode="individual"}={}) {
  if(!Number.isInteger(length)||length<1||!["individual","shared"].includes(wordMode))
    throw Error("Invalid round configuration.");
  return {round:{status:"open",title,length,wordMode,sharedAnswer:null,finishedAt:null},
    players:{},sharedSessions:{}};
}

export function scoreGuess(guess,answer) {
  const letters=[...guess],actual=[...answer];
  if(letters.length!==actual.length)throw Error("Guess and answer lengths differ.");
  const result=Array(letters.length).fill("absent"),remaining=new Map();
  for(let i=0;i<letters.length;i++){
    if(letters[i]===actual[i])result[i]="correct";
    else remaining.set(actual[i],(remaining.get(actual[i])??0)+1);
  }
  for(let i=0;i<letters.length;i++){
    if(result[i]==="correct")continue;
    const left=remaining.get(letters[i])??0;
    if(left){result[i]="present";remaining.set(letters[i],left-1);}
  }
  return result;
}

const active=(state,userId)=>state.round.status==="open"&&
  state.players[String(userId)]?.status==="playing"?state.players[String(userId)]:null;
const answerFor=(state,player)=>state.round.wordMode==="shared"
  ?state.round.sharedAnswer:player.answer;

export const startPlayer=({user,answerCandidate,now})=>state=>{
  if(state.round.status!=="open")return;
  if(!Number.isSafeInteger(user?.id)||user.id<1)throw Error("Invalid player ID.");
  const id=String(user.id);
  if(state.players[id])return;
  if(typeof answerCandidate!=="string"||[...answerCandidate].length!==state.round.length)
    throw Error("A selected answer of the configured length is required.");
  if(state.round.wordMode==="shared"&&!state.round.sharedAnswer)
    state.round.sharedAnswer=answerCandidate;
  state.players[id]={userId:user.id,
    name:String(user.first_name??user.name??`Игрок ${user.id}`).slice(0,100),
    username:user.username??null,joinedAt:now,
    answer:state.round.wordMode==="individual"?answerCandidate:null,
    guesses:[],input:"",status:"playing",startedAt:null,finishedAt:null};
};

export const typeKey=({userId,key})=>state=>{
  const player=active(state,userId);
  if(!player||typeof key!=="string"||!key||[...player.input,...key].length>state.round.length)return;
  player.input+=key;
};

export const backspace=({userId})=>state=>{
  const player=active(state,userId);
  if(player)player.input=[...player.input].slice(0,-1).join("");
};
export const clearInput=({userId})=>state=>{
  const player=active(state,userId);if(player)player.input="";
};

export const submitGuess=({userId,guess,valid,now})=>state=>{
  const player=active(state,userId);
  if(!player||valid!==true||guess!==player.input||
      [...guess].length!==state.round.length)return;
  const answer=answerFor(state,player);
  if(!answer)throw Error("Selected answer is unavailable.");
  if(player.startedAt===null)player.startedAt=now;
  player.guesses.push(guess);
  player.input="";
  if(guess===answer)player.status="won";
  else if(player.guesses.length>=6)player.status="lost";
  if(player.status!=="playing")player.finishedAt=now;
};

export const finishRound=({now})=>state=>{
  if(state.round.status==="finished")return;
  state.round.status="finished";state.round.finishedAt=now;
  for(const session of Object.values(state.sharedSessions)){
    session.activeUserId=null;session.expiresAt=null;
  }
};

export function selectProgress(state,userId){
  const player=state.players[String(userId)];
  if(!player)return [];
  const answer=answerFor(state,player);
  const lettersVisible=state.round.wordMode==="individual"||state.round.status==="finished";
  return player.guesses.map(guess=>({
    letters:lettersVisible?guess:null,
    colors:scoreGuess(guess,answer),
  }));
}

export function selectRankedPlayers(state){
  const rank={won:0,lost:1,playing:2};
  return Object.values(state.players).slice().sort((a,b)=>
    rank[a.status]-rank[b.status]||a.guesses.length-b.guesses.length||
    (a.finishedAt===null?Infinity:a.finishedAt-a.startedAt)-
      (b.finishedAt===null?Infinity:b.finishedAt-b.startedAt)||
    a.joinedAt-b.joinedAt||a.userId-b.userId);
}
