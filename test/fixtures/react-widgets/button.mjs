import React from "react";

export function Main({label}) {
  return React.createElement(React.Fragment,null,
    React.createElement("p",null,label),
    React.createElement("tg-keyboard",null,
      React.createElement("tg-button-row",null,
        React.createElement("tg-button",{onClick:event=>{
          (globalThis.__reactWidgetButtonEvents??=[]).push({label,from:event.from?.id});
        }},"Press"))));
}
