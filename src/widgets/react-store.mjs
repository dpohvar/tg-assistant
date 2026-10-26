import { produce } from "immer";
import { validateReactState, widgetError } from "./contract.mjs";

const asJson = value => JSON.stringify(value);

/** One independent synchronous store per widgetId. Persistence is coordinated by the runtime. */
export function createReactStore({ definition = {version:0,initialState:{}}, saved, onRevision } = {}) {
  const version = definition.version;
  if (!Number.isSafeInteger(version) || version < 0)
    throw widgetError("invalid_argument", "Invalid store version.");
  if (saved && (!Number.isSafeInteger(saved.version) || saved.version > version))
    throw widgetError("invalid_argument", "Saved store uses a newer version.");
  let revision = saved?.revision ?? 0;
  const initial = definition.initialState;
  let state;
  if (saved?.version === version) state = validateReactState(saved.state);
  else {
    const prior = saved ? validateReactState(saved.state) : undefined;
    const previousJson = prior === undefined ? null : asJson(prior);
    state = validateReactState(typeof initial === "function"
      ? initial(prior, saved?.version ?? 0) : initial ?? {});
    if (prior !== undefined && asJson(prior) !== previousJson)
      throw widgetError("invalid_argument", "Store migration must not mutate old state.");
    if (saved) revision++;
  }
  const subscribers = new Set();
  let dispatching = false;
  function publish(next) {
    const normalized = validateReactState(next);
    if (asJson(normalized) === asJson(state)) return;
    state = normalized;
    revision++;
    onRevision?.({ state, version, revision });
    for (const subscriber of [...subscribers]) subscriber();
  }
  function dispatch(recipe) {
    if (typeof recipe !== "function") throw widgetError("invalid_argument", "Dispatch needs a recipe.");
    if (dispatching) throw widgetError("invalid_argument", "Nested dispatch is forbidden.");
    if (recipe.constructor.name === "AsyncFunction")
      throw widgetError("invalid_argument", "Async recipes are forbidden.");
    dispatching = true;
    try {
      const next = produce(state,draft => {
        const result = recipe(draft);
        if (result !== undefined)
          throw widgetError("invalid_argument", "Dispatch recipes must return void synchronously; async recipes are forbidden.");
      });
      publish(next);
    } finally { dispatching = false; }
  }
  return {
    getSnapshot: () => state,
    subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
    dispatch,
    replace(next) { if (dispatching) throw widgetError("invalid_argument", "Nested dispatch is forbidden."); publish(next); },
    get version() { return version; },
    get revision() { return revision; },
  };
}
