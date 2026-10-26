import React from "react";
import {defineStore,useSelector} from "../../../src/widgets/sdk.mjs";
defineStore({version:1,initialState:{finished:false}});
export function Main(){
  const finished=useSelector(state=>state.finished);
  return React.createElement("p",null,finished?"Finished":"Open");
}
export const finishRound=()=>state=>{state.finished=true;};
export const noop=()=>_state=>{};
