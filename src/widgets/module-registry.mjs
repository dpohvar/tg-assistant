import { AsyncLocalStorage } from "node:async_hooks";
import { widgetError, validateReactState } from "./contract.mjs";

const registration = new AsyncLocalStorage();
const modules = new Map();

/** Bare call during module evaluation. Definitions belong to builds, never instances. */
export function defineStore(definition) {
  const context = registration.getStore();
  if (!context || context.phase !== "loading")
    throw widgetError("invalid_argument", "defineStore must run once during module initialization.");
  if (context.definition)
    throw widgetError("invalid_argument", "defineStore may only be called once per module.");
  if (!definition || !Number.isSafeInteger(definition.version) || definition.version < 0 ||
      !(typeof definition.initialState === "function" ||
        (definition.initialState && typeof definition.initialState === "object" &&
         !Array.isArray(definition.initialState))))
    throw widgetError("invalid_argument", "Invalid defineStore definition.");
  if (typeof definition.initialState !== "function") validateReactState(definition.initialState);
  context.definition = Object.freeze({ version: definition.version,
    initialState: definition.initialState });
}

export function loadWidgetModule(buildId, factory) {
  if (typeof buildId !== "string" || !buildId || typeof factory !== "function")
    throw widgetError("invalid_argument");
  if (modules.has(buildId)) return modules.get(buildId);
  const context = { phase: "loading", definition: null };
  const pending = Promise.resolve().then(() => registration.run(context, async () => {
    try {
      const exports = await factory();
      context.phase = "sealed";
      if (!exports || typeof exports !== "object") throw widgetError("invalid_argument", "Invalid widget module.");
      return Object.freeze({ exports, storeDefinition: context.definition ??
        Object.freeze({ version: 0, initialState: Object.freeze({}) }) });
    } catch (error) {
      context.phase = "failed";
      if (modules.get(buildId) === pending) modules.delete(buildId);
      throw error;
    }
  }));
  modules.set(buildId,pending);
  return pending;
}

export function clearWidgetModule(buildId) { modules.delete(buildId); }
