import React from "react";

export function PrivateGame({player}) {
  return React.createElement("p",null,`Player ${player}`);
}
export function Main() {
  return React.createElement(React.Fragment,null,
    React.createElement("p",null,"Open game"),
    React.createElement("tg-keyboard",null,
      React.createElement("tg-button-row",null,
        React.createElement("tg-button",{onClick:event=>event.overlay(
          React.createElement(PrivateGame,{player:event.from.id}))},"Open"))));
}
