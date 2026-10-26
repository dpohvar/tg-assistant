// Isolated design experiment, not the production widget SDK or persistence bridge.
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../.runtime-check/react-store-isolation/package.json', import.meta.url));
export const React = require('react');
export const ReactRedux = require('react-redux');
export const Renderer = require('react-test-renderer');
const { createAction, createReducer, configureStore } = require('@reduxjs/toolkit');
const definitionBrand = Symbol('prototype.store.definition');
function freezeTemplate(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTemplate(child);
    Object.freeze(value);
  }
  return value;
}

export function defineStore({ version = 1, initialState, reducers }) {
  // This shared object contains no live store, instance ID, dispatch or database.
  const cases = Object.freeze({ ...reducers });
  const actions = Object.freeze(Object.fromEntries(
    Object.keys(cases).map(name => [name, createAction(`widget/${name}`)]),
  ));
  return Object.freeze({
    [definitionBrand]: true, version, actions, reducers: cases,
    initialState: typeof initialState === 'function' ? initialState : freezeTemplate(structuredClone(initialState)),
  });
}

export function createInstance(module, widgetId, db) {
  const definitions = [...new Set(Object.values(module).filter(value => value?.[definitionBrand]))];
  if (definitions.length !== 1) throw new Error('Export exactly one store definition');
  const definition = definitions[0];
  const row = db.prepare('SELECT version, state FROM snapshots WHERE widget_id = ?').get(widgetId);
  if (row && row.version > definition.version) throw new Error('Saved state is newer than code');
  let state;
  if (row?.version === definition.version) {
    state = JSON.parse(row.state);
  } else if (typeof definition.initialState === 'function') {
    state = definition.initialState(row ? JSON.parse(row.state) : undefined, row?.version ?? 0);
  } else {
    if (row) throw new Error('Migration function required');
    state = definition.initialState;
  }
  // Each live store receives its own initial/preloaded state, including nested data.
  state = structuredClone(state);
  const reducer = createReducer(state, builder => {
    for (const [name, handle] of Object.entries(definition.reducers)) {
      builder.addCase(definition.actions[name], (draft, action) => handle(draft, action.payload));
    }
  });
  const store = configureStore({ reducer, preloadedState: state, devTools: false });
  const save = () => db.prepare(
    'INSERT INTO snapshots(widget_id, version, state) VALUES (?, ?, ?) '
      + 'ON CONFLICT(widget_id) DO UPDATE SET version=excluded.version, state=excluded.state',
  ).run(widgetId, definition.version, JSON.stringify(store.getState()));
  save();
  // Synchronous in-memory SQLite is only a probe for per-instance routing.
  // It does not implement production event transactions or async save barriers.
  const dispose = store.subscribe(save);
  const Runtime = Object.hasOwn(module, 'default') ? module.default : (({ children }) => children);
  return { widgetId, store, Runtime, dispose };
}

export function element(instance, View, props) {
  return React.createElement(ReactRedux.Provider, { store: instance.store },
    React.createElement(instance.Runtime, { instanceId: instance.widgetId },
      React.createElement(View, props)));
}
