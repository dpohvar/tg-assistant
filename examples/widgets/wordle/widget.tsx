import {defineStore} from "@tg-assistant/widget";
import {createWordleConfig} from "./game-config.mjs";
import {createGameUI} from "./game-ui.tsx";

defineStore({version:1,initialState:{round:null,players:{},sharedSessions:{}}});
const game=createGameUI(createWordleConfig());
export const {Players,GameInput,GameInputShared,GameShared}=game;
export default game.Runtime;
