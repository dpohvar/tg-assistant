import test from "node:test";
import assert from "node:assert/strict";
import {formatWidgets,formatWidget} from "../../src/commands/widgets-format.mjs";

test("widget admin output reports React status and private views without retired queue fields",()=>{
  const widget={widgetId:"w",agentId:"a",description:"Game",handler:"game.tsx",status:"error",
    storeVersion:1,storeRevision:3,createdAt:1000,lastError:{code:"render_failed"},views:[
      {id:"public",target:{chatId:-100123,messageId:7},chatType:"supergroup",exportName:"Players",props:{}},
      {id:"private",target:{chatId:-100123,receiverUserId:5,ephemeralMessageId:9},
        chatType:"supergroup",exportName:"PrivateGame",props:{}},
    ]};
  const list=formatWidgets([widget],0,1,1),detail=formatWidget(widget);
  assert.match(list.text,/error/);
  assert.match(list.text,/Views: 2/);
  assert.match(list.text,/Private recipient 5/);
  assert.doesNotMatch(list.text,/undefined|Pending:/);
  assert.match(detail.text,/Store version: 1; revision: 3/);
  assert.match(detail.text,/PrivateGame/);
  assert.doesNotMatch(detail.text,/Stopped reason|Dropped:/);
});
