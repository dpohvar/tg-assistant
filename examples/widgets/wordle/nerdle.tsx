import {defineStore} from "@tg-assistant/widget";
import {createNerdleConfig} from "./game-config.mjs";
import {createGameUI} from "./game-ui.tsx";
import {finishRound as finishRoundRecipe} from "./model.mjs";

defineStore({version:1,initialState:{round:null,players:{},sharedSessions:{}}});
const game=createGameUI(createNerdleConfig());
export const {Players,GameInput,GameInputShared,GameShared}=game;
export const finishRound=()=>finishRoundRecipe({now:Date.now()});
export default game.Runtime;
