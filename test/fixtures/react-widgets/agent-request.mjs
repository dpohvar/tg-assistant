import React from "react";
import {useWidget} from "../../../src/widgets/react-context.mjs";

export function Main(){
  const widget=useWidget();
  return React.createElement(React.Fragment,null,React.createElement("p",null,"Agent request"),
    React.createElement("tg-keyboard",null,React.createElement("tg-button-row",null,
      React.createElement("tg-button",{onClick:async()=>{
      globalThis.__reactWidgetAgentReply=await widget.requestAgent({text:"Hint",data:{n:1}},
        {timeoutMs:1000});
    }},"Ask"))));
}
