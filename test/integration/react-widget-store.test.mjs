import test from "node:test";
import assert from "node:assert/strict";
import * as storeModule from "../../src/widgets/react-store.mjs";

const definition = { version: 2, initialState: () => ({ count: 0, slots: [] }) };

test("instances share a definition but never a mutable store", () => {
  assert.equal(typeof storeModule.createReactStore,"function");
  const a=storeModule.createReactStore({definition});
  const b=storeModule.createReactStore({definition});
  a.dispatch(draft=>{draft.count++});
  assert.deepEqual(a.getSnapshot(),{count:1,slots:[]});
  assert.deepEqual(b.getSnapshot(),{count:0,slots:[]});
  assert.equal(a.revision,1);
  assert.equal(b.revision,0);
});

test("version matching restores exactly; older state migrates; newer rejects", () => {
  let calls=0;
  const def={version:3,initialState:(old,version)=>{calls++;return {count:(old?.count??0)+version};}};
  const restored=storeModule.createReactStore({definition:def,saved:{version:3,revision:7,state:{count:9}}});
  assert.equal(restored.getSnapshot().count,9);
  assert.equal(calls,0);
  const migrated=storeModule.createReactStore({definition:def,saved:{version:2,revision:7,state:{count:9}}});
  assert.equal(migrated.getSnapshot().count,11);
  assert.equal(migrated.version,3);
  assert.equal(calls,1);
  assert.throws(()=>storeModule.createReactStore({definition:def,saved:{version:4,state:{}}}),/newer|version/i);
});

test("dispatch is atomic, synchronous, and guards reentrant and async recipes", () => {
  const store=storeModule.createReactStore({definition});
  const snapshot=store.getSnapshot();
  assert.throws(()=>store.dispatch(d=>{d.count=1;throw Error("stop")}),/stop/);
  assert.equal(store.getSnapshot(),snapshot);
  assert.throws(()=>store.dispatch(d=>{d.count=1;store.dispatch(x=>{x.count=2})}),/nested|reentrant/i);
  assert.equal(store.getSnapshot(),snapshot);
  assert.throws(()=>store.dispatch(async d=>{d.count=1}),/async|Promise/i);
  assert.equal(store.getSnapshot(),snapshot);
  store.dispatch(d=>{d.count=1;d.slots=[undefined]});
  assert.deepEqual(store.getSnapshot(),{count:1,slots:[null]});
  assert.throws(()=>store.dispatch(d=>{d.bad=()=>1}),/invalid_argument/);
  assert.deepEqual(store.getSnapshot(),{count:1,slots:[null]});
});

test("subscriptions and revisions change only for changed JSON snapshots", () => {
  const changes=[];
  const store=storeModule.createReactStore({definition,onRevision:x=>changes.push(x)});
  let notifications=0;
  const stop=store.subscribe(()=>notifications++);
  store.dispatch(d=>{d.count=0});
  assert.equal(store.revision,0);
  store.dispatch(d=>{d.count++});
  assert.equal(store.revision,1);
  assert.equal(notifications,1);
  assert.deepEqual(changes[0].state,{count:1,slots:[]});
  store.replace({count:1,slots:[]});
  assert.equal(store.revision,1);
  store.replace({count:2,slots:[]});
  assert.equal(store.revision,2);
  stop();
  store.dispatch(d=>{d.count++});
  assert.equal(notifications,2);
});

test("continuation after await dispatches against the current state", async () => {
  const store=storeModule.createReactStore({definition});
  let release;
  const gate=new Promise(resolve=>release=resolve);
  const a=(async()=>{await gate;store.dispatch(d=>{d.count+=2})})();
  store.dispatch(d=>{d.count++});
  release();
  await a;
  assert.equal(store.getSnapshot().count,3);
});
