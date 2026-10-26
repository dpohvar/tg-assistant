// This module is evaluated once and reused by both widget instances in the probe.
import { React, ReactRedux, defineStore } from './react-store-isolation-prototype.mjs';
const { createElement, createContext, useContext, useEffect, useState } = React;
const { useSelector, useDispatch } = ReactRedux;
const InstanceContext = createContext('default-runtime');

export const counter = defineStore({
  version: 1,
  initialState: { count: 0, nested: { items: [] } },
  reducers: {
    add(state, amount) { state.count += amount; },
    append(state, text) { state.nested.items.push(text); },
  },
});

export default function Runtime({ children, instanceId }) {
  const [value] = useState(instanceId);
  return createElement(InstanceContext, { value }, children);
}

export function Counter({ observe }) {
  const count = useSelector(state => state.count);
  const dispatch = useDispatch();
  const instanceId = useContext(InstanceContext);
  useEffect(() => { observe({ state: { count }, dispatch, instanceId }); }, [count, dispatch, instanceId, observe]);
  return createElement('output', null, `${instanceId}:${count}`);
}
