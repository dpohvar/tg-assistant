# Widget Actions Implementation Plan

Implementation and group Wordle live verification are recorded in [verification](../widget-actions-verification.md). The checklist below is the original plan, not an execution log.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add agent-callable widget actions and make state tools wait for confirmed view publication before safe deletion.

**Architecture:** The sandbox resolves a named action from the current module and dispatches its synchronous Immer recipe. Render commits report confirmed edits and failures to the controller. State methods and deletion share one widget lifecycle queue. Wordle/Nerdle export the existing finish recipe.

**Tech Stack:** Node.js, React reconciler, Immer, SQLite, Telegram Bot API.

**Spec:** `docs/dev/widget-actions-design.md`

## Global Constraints

- Preserve owner scoping and JSON-only tool arguments.
- No automatic retry of failed views or uncertain Telegram deliveries.
- Update canonical widget wiki articles alongside code.

## Review Focus

- A render succeeds for one view and fails for another: expose both results and retain widget.
- An edit is pending while delete starts: deletion waits for confirmed edit.
- A prior view error exists: no automatic retry; state method rejects.
- The action returns an invalid or async recipe: reject without altering state.
- A no-op action does not claim any updated view.

---

### Task 1: Runtime action and publication result

**Files:** `src/widgets/reconciler.mjs`, `src/widgets/runtime-react.mjs`, `src/widgets/transport.mjs`; tests in `test/integration/react-widget-root.test.mjs` and `react-widget-process.test.mjs`.

**Interfaces:** `dispatchAction(widgetId,action,args)` and sandbox RPC `dispatchAction`; state methods return `updatedViews` or reject with view results.

- [ ] Write failing tests for successful, no-op, invalid, and partially failed actions and store replacement.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement action dispatch, per-commit outcomes, and error transport.
- [ ] Run focused tests until green.

### Task 2: Controller tool and deletion ordering

**Files:** `src/widgets/contract.mjs`, `src/widgets/api.mjs`, `src/widgets/manager-react.mjs`; tests in `react-widget-tools.test.mjs` and `react-widget-manager.test.mjs`.

**Interfaces:** `dispatch_widget_action({widgetId,action,args?})`; `update_widget_store` and action use same widget lifecycle queue as `delete_widget`.

- [ ] Write failing tests for tool schema, owner scoping, action/delete order, and retained widget on publication failure.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement controller routing and serialization.
- [ ] Run focused tests until green.

### Task 3: Wordle and documentation

**Files:** `examples/widgets/wordle/{widget,nerdle}.tsx`, `examples/widgets/wordle/README.md`, `docs/widgets.md`, `docs/widgets/state.md`; Wordle model/UI and service tests.

- [ ] Write a failing test for exported `finishRound` and final Wordle projection before deletion.
- [ ] Run it and confirm expected failure.
- [ ] Export the action and document usage/results/failures.
- [ ] Run focused tests, full suite, wiki checker, and diff check.
