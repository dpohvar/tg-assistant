import test from "node:test";
import assert from "node:assert/strict";
import {produce} from "immer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createInitialState,scoreGuess,startPlayer,typeKey,submitGuess,finishRound,
  selectRankedPlayers,selectProgress} from "../../examples/widgets/wordle/model.mjs";
import {createWordleConfig,createNerdleConfig} from "../../examples/widgets/wordle/game-config.mjs";

const apply=(state,recipe)=>produce(state,recipe);
const person=(id,name)=>({id,first_name:name,username:name.toLowerCase()});

test("duplicate letters score only available unmatched answer positions",()=>{
  assert.deepEqual(scoreGuess("АААБ","БАБА"),["present","correct","absent","present"]);
});

test("shared answer is chosen once; two players type and submit independently",()=>{
  let state=createInitialState({title:"WORDLE",length:4,wordMode:"shared"});
  state=apply(state,startPlayer({user:person(1,"One"),answerCandidate:"КОДА",now:100}));
  state=apply(state,startPlayer({user:person(2,"Two"),answerCandidate:"МИРА",now:101}));
  assert.equal(state.round.sharedAnswer,"КОДА");
  assert.equal(state.players["1"].answer,null);
  state=apply(state,typeKey({userId:1,key:"Д",now:110}));
  assert.equal(state.players["1"].input,"Д");
  assert.equal(state.players["2"].input,"");
  for(const key of "КОДА".slice(1))state=apply(state,typeKey({userId:1,key,now:111}));
  assert.equal(state.players["1"].startedAt,null);
  state=apply(state,submitGuess({userId:1,guess:"ДОДА",valid:false,now:200}));
  assert.equal(state.players["1"].startedAt,null);
  state=apply(state,submitGuess({userId:1,guess:"ДОДА",valid:true,now:201}));
  assert.equal(state.players["1"].startedAt,201);
  assert.equal(state.players["1"].guesses.length,1);
  assert.equal(state.players["2"].guesses.length,0);
  const progress=selectProgress(state,1);
  assert.equal(progress.length,1);
  assert.equal(progress[0].letters,null);
  state=apply(state,finishRound({now:300}));
  assert.equal(selectProgress(state,1)[0].letters,"ДОДА");
  assert.equal(state.players["2"].status,"playing");
  assert.equal(state.players["2"].finishedAt,null);
});

test("individual players keep distinct answers and rank by result, attempts, duration",()=>{
  let state=createInitialState({title:"WORDLE",length:4,wordMode:"individual"});
  for(const [id,answer] of [[1,"КОДА"],[2,"МИРА"],[3,"СЛОН"]])
    state=apply(state,startPlayer({user:person(id,String(id)),answerCandidate:answer,now:100}));
  const setInput=(id,word)=>{for(const key of word)state=apply(state,typeKey({userId:id,key,now:120}));};
  setInput(1,"КОДА");state=apply(state,submitGuess({userId:1,guess:"КОДА",valid:true,now:200}));
  setInput(2,"МИРА");state=apply(state,submitGuess({userId:2,guess:"МИРА",valid:true,now:250}));
  assert.deepEqual(selectRankedPlayers(state).map(p=>p.userId),[1,2,3]);
  assert.equal(selectProgress(state,1)[0].letters,"КОДА");
  assert.equal(state.players["1"].finishedAt-state.players["1"].startedAt,0);
});

test("answer selection uses select only, while guesses use broad union select",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"react-wordle-dict-"));
  try{
    fs.writeFileSync(path.join(dir,"wordle-dictionary-4.txt"),"КОТА\n");
    fs.writeFileSync(path.join(dir,"wordle-dictionary-4-select.txt"),"");
    const config=createWordleConfig({base:dir});
    assert.equal(config.validateGuess("КОТА",4),null);
    assert.throws(()=>config.selectAnswer(4,()=>0),/Пул ответов пуст/);
    fs.writeFileSync(path.join(dir,"wordle-dictionary-4-select.txt"),"ЁЛКА\n");
    assert.equal(config.selectAnswer(4,()=>0),"ЕЛКА");
    assert.equal(config.validateGuess("ёлка",4),null);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("Nerdle retains exact validation and an eight-character answer pool",()=>{
  const base=path.resolve("examples/widgets/wordle"),config=createNerdleConfig({base});
  const answer=config.selectAnswer(8,()=>0);
  assert.equal(answer.length,8);
  assert.equal(config.validateGuess(answer,8),null);
  assert.ok(config.validateGuess("1+1=0002",8));
  assert.equal(config.normalize("1×2=2"),"1*2=2");
});

test("six accepted guesses end only that player's game and retain every progress row",()=>{
  let state=createInitialState({title:"WORDLE",length:4,wordMode:"shared"});
  state=apply(state,startPlayer({user:person(1,"One"),answerCandidate:"КОДА",now:10}));
  state=apply(state,startPlayer({user:person(2,"Two"),answerCandidate:"МИРА",now:11}));
  for(let index=0;index<6;index++){
    for(const key of "МИРА")state=apply(state,typeKey({userId:1,key}));
    state=apply(state,submitGuess({userId:1,guess:"МИРА",valid:true,now:100+index*1000}));
  }
  assert.equal(state.players["1"].status,"lost");
  assert.equal(state.players["2"].status,"playing");
  assert.equal(state.players["1"].finishedAt-state.players["1"].startedAt,5000);
  assert.equal(selectProgress(state,1).length,6);
  state=apply(state,typeKey({userId:1,key:"К"}));
  assert.equal(state.players["1"].input,"");
});
