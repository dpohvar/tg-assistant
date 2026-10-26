// Offline architecture probe, not a production React widget engine.
// Install isolated dependencies (no project manifest/lock changes):
// npm install --prefix .runtime-check/react-store-isolation --no-save --package-lock=false --ignore-scripts --no-audit --no-fund react@19.2.0 react-test-renderer@19.2.0 react-redux@9.2.0 @reduxjs/toolkit@2.9.0
// Run: node --test test/manual/react-store-isolation.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { React, Renderer, createInstance, defineStore, element } from './react-store-isolation-prototype.mjs';
import * as module from './react-store-isolation-fixture.mjs';
import * as fallback from './react-store-isolation-default-fixture.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE snapshots(widget_id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL)');
  return db;
}
function snapshot(db, id) {
  return JSON.parse(db.prepare('SELECT state FROM snapshots WHERE widget_id = ?').get(id).state);
}

test('a cached module exports a shared definition, not a singleton live store', async () => {
  const cached = await import('./react-store-isolation-fixture.mjs');
  assert.equal(cached, module);
  assert.equal(fallback.counter, module.counter);
  assert.equal(module.counter.dispatch, undefined);
  assert.equal(module.counter.getState, undefined);
  assert.equal(module.counter.subscribe, undefined);
  const db = database();
  const a = createInstance(module, 'A', db);
  const b = createInstance(module, 'B', db);
  try {
    assert.notEqual(a.store, b.store);
    assert.notEqual(a.store.getState(), b.store.getState());
    assert.notEqual(a.store.getState().nested, b.store.getState().nested);
    assert.notEqual(a.store.getState().nested.items, b.store.getState().nested.items);
    a.store.dispatch(module.counter.actions.add(5));
    a.store.dispatch(module.counter.actions.append('A only'));
    assert.deepEqual(b.store.getState(), { count: 0, nested: { items: [] } });
    assert.equal(module.counter.initialState.count, 0);
    assert.deepEqual(module.counter.initialState.nested.items, []);
    assert.throws(() => module.counter.initialState.nested.items.push('shared mutation'), TypeError);
    assert.deepEqual(snapshot(db, 'A'), { count: 5, nested: { items: ['A only'] } });
    assert.deepEqual(snapshot(db, 'B'), { count: 0, nested: { items: [] } });
  } finally { a.dispose(); b.dispose(); db.close(); }
});

test('two React roots route shared action creators, hooks and Context to their own instance', async () => {
  const db = database();
  const a = createInstance(module, 'A', db);
  const b = createInstance(module, 'B', db);
  let observedA, observedB, rootA, rootB;
  const observeA = value => { observedA = value; };
  const observeB = value => { observedB = value; };
  try {
    await act(async () => {
      rootA = Renderer.create(element(a, module.Counter, { observe: observeA }));
      rootB = Renderer.create(element(b, module.Counter, { observe: observeB }));
    });
    assert.equal(observedA.instanceId, 'A');
    assert.equal(observedB.instanceId, 'B');
    await act(async () => {
      await Promise.resolve().then(() => observedA.dispatch(module.counter.actions.add(11)));
    });
    assert.equal(observedA.state.count, 11);
    assert.equal(observedB.state.count, 0);
    await act(async () => { observedB.dispatch(module.counter.actions.add(7)); });
    assert.equal(rootA.toJSON().children[0], 'A:11');
    assert.equal(rootB.toJSON().children[0], 'B:7');
    assert.equal(snapshot(db, 'A').count, 11);
    assert.equal(snapshot(db, 'B').count, 7);
    await act(async () => { rootA.unmount(); });
    rootA = undefined;
    a.dispose();
    const restored = createInstance(module, 'A', db);
    try {
      await act(async () => {
        rootA = Renderer.create(element(restored, module.Counter, { observe: observeA }));
      });
      assert.equal(observedA.state.count, 11);
      await act(async () => { observedA.dispatch(module.counter.actions.add(2)); });
      assert.equal(observedA.state.count, 13);
      assert.equal(observedB.state.count, 7);
    } finally { restored.dispose(); }
  } finally {
    await act(async () => { rootA?.unmount(); rootB?.unmount(); });
    a.dispose(); b.dispose(); db.close();
  }
});

test('missing default export uses a pass-through Runtime and retains the Redux Provider', async () => {
  assert.equal(fallback.default, undefined);
  const db = database();
  const instance = createInstance(fallback, 'fallback', db);
  let observed, root;
  const observe = value => { observed = value; };
  try {
    await act(async () => { root = Renderer.create(element(instance, fallback.Counter, { observe })); });
    assert.equal(observed.instanceId, 'default-runtime');
    await act(async () => { observed.dispatch(fallback.counter.actions.add(4)); });
    assert.equal(root.toJSON().children[0], 'default-runtime:4');
    assert.equal(snapshot(db, 'fallback').count, 4);
  } finally {
    await act(async () => { root?.unmount(); });
    instance.dispose(); db.close();
  }
});

test('initialization and migration run per instance; restoring current data does not reinitialize', () => {
  const calls = [];
  const definition = defineStore({
    version: 2,
    initialState(oldState, oldVersion) {
      calls.push({ oldState, oldVersion });
      return oldState === undefined ? { count: 0, history: [] } : { count: oldState.count, history: [] };
    },
    reducers: { add(state, amount) { state.count += amount; } },
  });
  const db = database();
  const insert = db.prepare('INSERT INTO snapshots VALUES (?, ?, ?)');
  insert.run('old', 1, JSON.stringify({ count: 23 }));
  insert.run('future', 3, JSON.stringify({ count: 99 }));
  const old = createInstance({ definition }, 'old', db);
  const fresh = createInstance({ definition }, 'fresh', db);
  const restored = createInstance({ definition }, 'old', db);
  try {
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(call => call.oldVersion), [1, 0]);
    assert.equal(old.store.getState().count, 23);
    assert.equal(fresh.store.getState().count, 0);
    assert.equal(restored.store.getState().count, 23);
    assert.throws(() => createInstance({ definition }, 'future', db), /newer than code/);
    assert.equal(calls.length, 2);
    assert.deepEqual(snapshot(db, 'future'), { count: 99 });
  } finally { old.dispose(); fresh.dispose(); restored.dispose(); db.close(); }
});

test('the loader rejects multiple different definitions, but accepts export aliases', () => {
  const db = database();
  const other = defineStore({ initialState: { count: 0 }, reducers: {} });
  try {
    assert.throws(() => createInstance({}, 'missing', db), /exactly one/);
    assert.throws(() => createInstance({ counter: module.counter, other }, 'ambiguous', db), /exactly one/);
    const instance = createInstance({ counter: module.counter, alias: module.counter }, 'alias', db);
    instance.dispose();
  } finally { db.close(); }
});
