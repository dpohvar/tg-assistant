import React from "react";
import {useOnMessage,useOnReply,useOnReaction} from "../../../src/widgets/subscriptions.mjs";

export function Main({disabled=false}) {
  useOnMessage(message=>{(globalThis.__reactWidgetSubscriptions??=[]).push(["message",message?.message_id]);});
  useOnReply(event=>{(globalThis.__reactWidgetSubscriptions??=[]).push(["reply",event.from?.id]);},{disabled});
  useOnReaction(event=>{(globalThis.__reactWidgetSubscriptions??=[]).push(["reaction",event.from?.id]);},{disabled});
  return React.createElement("p",null,"Hooks");
}
