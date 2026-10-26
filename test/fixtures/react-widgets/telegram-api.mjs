import React from "react";
import {useTelegram} from "../../../src/widgets/react-context.mjs";
export function Main(){
  const api=useTelegram();
  return React.createElement(React.Fragment,null,React.createElement("p",null,"Scoped API"),
    React.createElement("tg-keyboard",null,React.createElement("tg-button-row",null,
      React.createElement("tg-button",{onClick:async()=>{
        globalThis.__reactWidgetTelegramResult=await api.send({text:"from widget"});
      }},"Send"))));
}
