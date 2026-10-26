import test from "node:test";
import assert from "node:assert/strict";
import * as projection from "../../src/widgets/projection.mjs";
import {hostNode,hostText,insertNode} from "../../src/widgets/host-tree.mjs";

const tag=(type,props={},...children)=>{
  const node=hostNode(type,props);
  for(const child of children.flat())insertNode(node,typeof child==="string"?hostText(child):child);
  return node;
};
const root=(...children)=>tag("widget-view",{viewId:"v"},...children);

test("rich JSX projects formatted table cells and photos", () => {
  assert.equal(typeof projection.projectHostTree,"function");
  const tree=root(tag("p",{},"Hello ",tag("u",{},"yellow")," ",tag("mark",{},"green")),
    tag("table",{},tag("tr",{},tag("td",{},"A"),tag("td",{},"B"))),
    tag("img",{src:"https://example.org/cat.jpg"}));
  const result=projection.projectHostTree(tree,{creating:true});
  assert.equal(result.kind,"rich_message");
  assert.equal(result.body.rich_message.blocks[0].type,"paragraph");
  assert.equal(result.body.rich_message.blocks[1].type,"table");
  assert.equal(result.body.rich_message.blocks[2].type,"photo");
});

test("multiple keyboards merge rows, callback identities survive updates and removed nodes vanish", () => {
  const button=tag("tg-button",{onClick:()=>"old",icon_custom_emoji_id:"12345"},"Play");
  const first=root(tag("p",{},"Text"),tag("tg-keyboard",{},tag("tg-button-row",{},button)),
    tag("tg-keyboard",{},tag("tg-button-row",{},tag("tg-button",{url:"https://example.org"},"Open"))));
  const a=projection.projectHostTree(first,{creating:true});
  assert.equal(a.replyMarkup.inline_keyboard.length,2);
  assert.equal(a.replyMarkup.inline_keyboard[0][0].icon_custom_emoji_id,"12345");
  assert.equal(a.callbacks.size,1);
  const token=[...a.callbacks.keys()][0];
  button.props={onClick:()=>"new"};
  const b=projection.projectHostTree(first,{priorBody:a.body,creating:false});
  assert.equal([...b.callbacks.keys()][0],token);
  assert.equal(b.callbacks.get(token)(),"new");
  first.children.splice(1,1);
  const c=projection.projectHostTree(first,{priorBody:b.body,creating:false});
  assert.equal(c.callbacks.size,0);
});

test("native dice and sticker bodies cannot change or disappear after creation", () => {
  const dice=root(tag("tg-dice",{emoji:"🎲"}),tag("tg-keyboard",{},tag("tg-button-row",{},tag("tg-button",{onClick:()=>{}},"Again"))));
  const a=projection.projectHostTree(dice,{creating:true});
  assert.equal(a.kind,"dice");
  assert.deepEqual(a.body.dice,{emoji:"🎲"});
  assert.equal(projection.projectHostTree(dice,{priorBody:a.body,creating:false}).kind,"dice");
  assert.throws(()=>projection.projectHostTree(root(tag("tg-dice",{emoji:"🎯"})),{priorBody:a.body,creating:false}),/render|native|edit/i);
  assert.throws(()=>projection.projectHostTree(root(),{priorBody:a.body,creating:false}),/render|native|edit/i);
  assert.throws(()=>projection.projectHostTree(root(tag("tg-dice",{emoji:"🎲"}),tag("p",{},"extra")),{creating:true}),/invalid_argument/);
  assert.equal(projection.projectHostTree(root(tag("tg-sticker",{src:"file-id"})),{creating:true}).kind,"sticker");
});

test("empty and keyboard-only renders use one blank paragraph; unknown tags reject", () => {
  assert.deepEqual(projection.projectHostTree(root(),{creating:true}).body.rich_message.blocks,
    [{type:"paragraph",text:""}]);
  const keyOnly=projection.projectHostTree(root(tag("tg-keyboard",{},tag("tg-button-row",{},tag("tg-button",{onClick:()=>{}},"A")))),{creating:true});
  assert.deepEqual(keyOnly.body.rich_message.blocks,[{type:"paragraph",text:""}]);
  assert.throws(()=>projection.projectHostTree(root(tag("unknown",{},"x")),{creating:true}),/invalid_argument/);
});
