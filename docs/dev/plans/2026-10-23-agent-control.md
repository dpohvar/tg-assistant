# Agent cancellation, queue eviction and context management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Реализовать согласованные `/agent cancel`, вытеснение ожидающих chat-событий и управление контекстом, включая ручное сжатие, агентский запрос и сохранённое продолжение.

**Architecture:** Контроллер управляет единой очередью агента, рабочими единицами и постоянными записями отмены/сжатия. Codex adapter отвечает за native-метрики, привязку вызовов к конкретным ходам, подтверждённое прерывание и сжатие; сообщения и приватные ответы имеют отдельные обработчики последствий вытеснения. Обычная очередь остаётся в RAM, а состояние обслуживания и continuation сохраняются в SQLite.

**Tech Stack:** Существующий JavaScript ESM, Node.js >=24.18.1, `node:sqlite`, Codex App Server stdio, Telegram Bot API, `node:test`. Проверенная база — `origin/main` на `9fd0fd9`, Codex CLI 0.159.3. Новые npm-зависимости не требуются.

**Spec:** [Context management](../context-management-design.md), [Cancellation and queue eviction](../agent-cancel-design.md).

**Status:** Реализован в изолированной ветке `feat/agent-control`. Полный набор: Windows 844 passed / 11 skipped; Alpine 849 passed / 6 skipped; ошибок нет. Native compaction/cancel/resume проверены на обеих платформах, Telegram-сценарии подтверждены пользователем. Фактическое покрытие и ограничения матрицы — в [verification report](../agent-control-verification.md) и [native/client report](../agent-control-native-verification.md). После завершения проверки пользователь отдельно разрешил commit/merge/push в `main`. Production deployment не выполнялся.

**Test environment (preflight, до реализации):** Доступ к выделенному `dpohvar_test_pub_bot` подтверждён; выполнены read-only API preflight и проверки существующего batching/wiki. Результаты и ограничения — в [preflight report](../agent-control-preflight.md). Новые функции этим не проверены. Для bounded live acceptance использовать существующую приватную конфигурацию, disposable storage и общий bot lock; не запускать второй polling одновременно с другим runner.

## Global Constraints

- Служебные ответы и новые wiki-статьи — на английском; планы и design-документы остаются в `docs/dev/`.
- `/agent context [AGENT_ID]` и `/agent compact [AGENT_ID]` — admin/owner даже для текущего чата. `/agent cancel [AGENT_ID]`: без ID user+ в ЛС, manager+ в группе; с ID admin/owner того же бота. Новых `*`, `in CHAT_ID`, `default` у этих трёх действий нет.
- Контекст, очередь, роль агента и постоянные ресурсы — разные состояния. Cancel не удаляет thread; stop/clear сохраняют существующую семантику, кроме явно согласованного снятия cancel-паузы через start.
- Возобновляет следующее новое допустимое событие любого источника; уже ожидающее событие, изменение служебного статуса и чтение метрик не возобновляют. Фильтрация WebSocket не добавляется.
- Лимит десять относится только к ожидающим элементам `source:'chat'`. Новое допустимое событие вытесняет старейший chat-элемент; остальные источники не занимают эти места и не вытесняются.
- Сбор событий — фиксированные 200 ms от первого ожидающего элемента. Вытеснение и новые события не продлевают срок. Альбом занимает одно место; переданный пакет мест не занимает.
- Пороги заполненности задаются AGENTS.md; контроллер не содержит 65%, 80% или иной автоматической политики сжатия.
- `compact_context({continuation?})` использует только собственный основной thread. Native `thread/compact/start` получает только `threadId`; параметры summary/модели/целевого размера не добавляются.
- После сжатия с продолжением следующий пакет начинается одним `context_status` с разовым `continuation`; без внешних событий этот элемент сам образует пакет. Обычный инструмент `context_status` и административный просмотр continuation не раскрывают.
- Неизвестный исход не превращается в успех, автоматический повтор внешнего действия или повтор запуска continuation. Пауза, запрос сжатия и доставка продолжения переживают restart; обычные события в RAM — нет.
- Новые токены, тексты `/say`, continuation и приватные адреса не попадают в общую историю/диагностические логи. Ошибки приватных ответов не имеют публичного fallback.
- Ведение joan-moreno, перенос канона, пользовательские `/chapter`/`scene`/`show`, общая durable inbox/outbox, игровой календарь и изменение существующего `/rules set` не входят в этот план.

## Review Focus

1. Остановка root не доказывает остановку child/PTY. Проверить живую дочернюю команду и отсутствие поздней записи после подтверждения cancel — Task 1 и Task 7.
2. RPC и terminal notification могут приходить в обратном порядке; crash возможен между каждым durable intent, native write, ACK и terminal event. Проверить все точки без повторного эффекта — Tasks 1, 8–10.
3. Кнопка может быть вытеснена во время предварительного edit или после изменения соседней группы; `/say` может потерять подготовленный ответ. Проверить принадлежность ровно одному событию и отсутствие приватной утечки — Tasks 4–5.
4. Новое событие во время cancelling должно снять только cancel-паузу после quiescence, не maintenance/disabled/unknown hold. Проверить все источники и полную очередь — Tasks 3, 7 и 10.
5. Завершение compute turn перед compaction не завершает scheduled/delegated work. Проверить success/failure/cancel/restart общей работы и исходный маршрут — Tasks 2, 9–10.

## Порядок и границы поставки

Один план содержит три проверяемых результата: A — новая политика очереди и её Telegram-последствия (Tasks 2–5); B — сохранение контекста при cancel и пауза (Tasks 1–2, 7); C — метрики, сжатие и continuation (Tasks 1–3, 6, 8–10). Task 11 завершает общую проверку. Context management обязательно входит в поставку, а не остаётся будущей задачей.

Task 1 проверяет две известные неопределённости native API. При отсутствии положительного доказательства поддерживается `unknown` с удержанием работы; нельзя реализовать удаление thread как скрытый способ cancel или выдавать fixture-тест за native acceptance.

**Перед Task 1 при переходе к реализации:** выполнить `npm ci` и исходный `npm test` в изолированной ветке. Если база падает, зафиксировать конкретные исходные сбои до runtime-изменений. Во время подготовки этого плана зависимости не устанавливаются и продуктовые тесты не запускаются.

## Карта файлов и интерфейсы

План добавляет следующие небольшие модули; существующий controller не переписывается целиком.

| Модуль | Ответственность |
| --- | --- |
| `src/codex/control.mjs` | Native interrupt/compact, correlation и read-only reconciliation |
| `src/codex/process-owner.mjs` | Владение процессом App Server/его потомками и подтверждение остановки; использует проверяемые OS identity, не голый PID |
| `src/codex/context.mjs` | Последняя оценка заполненности основного контекста |
| `src/agents/control-store.mjs` | Постоянные записи паузы, сжатия и доставки продолжения |
| `src/agents/work.mjs` | Рабочая единица поверх compute turns и её scheduled/delegated origins |
| `src/agents/control.mjs` | Сериализованный coordinator cancel/compact/recovery |
| `src/messages/serial.mjs` | Общая сериализация изменений одного обычного сообщения |
| `src/messages/button-rollback.mjs` | Snapshot и условный откат предварительного закрытия одной группы |

Минимальные общие типы для плана (JavaScript objects, без введения TypeScript toolchain):

```text
Scope = {botId, chatId, agentId, controllerId, generation}
NativeIdentity = {threadId, turnId, itemId?, processIdentity?}
Evidence = {state:'not_started'|'running'|'completed'|'interrupted'|'failed'|'unknown', identity?, code?}
ContextSnapshot = {usedTokens:number|null, maxTokens:number|null, measuredAt:string|null}
ControlResult = {status:'accepted'|'already_pending'|'unavailable'|'unknown', operationId?, state?}
ReplyTarget = {botId,chatId,requesterUserId,messageId} | {botId,chatId,requesterUserId,ephemeralMessageId,receiverUserId}
```

Инженерные решения этого плана:

- `continuation` — необязательная непустая строка до 4096 Unicode code points; whitespace-only и лишние поля отклоняются. Это лимит пакета управления, не порог сжатия.
- Отдельное служебное событие отмены: `{eventType:'agent_cancelled', workIds:[...], interruptedTurnIds:[...]}`. Оно добавляется после `context_status`, перед обычными событиями, только когда уже есть причина запустить модель. Его наличие само не возобновляет работу. Массивы нужны, потому что после окончания root могут ещё работать дети более ранней рабочей единицы.
- `usedTokens` — валидный `tokenUsage.last.totalTokens` как явно обозначенная оценка последнего запроса, `maxTokens` — `modelContextWindow`. Task 1 проверяет эту интерпретацию; при неподтверждённой семантике/отсутствии значения возвращается null. `tokenUsage.total` остаётся только accounting.
- Сохраняется состояние обслуживания, но не новая копия приватных сообщений или общей очереди. Записи работы содержат source references и подтверждения эффектов, а не сырой текст `/say`.
- При native unknown администратор видит код и стадию в status/context; повторный запрос не повторяет внешний эффект. Reconciliation выполняется при startup/reconnect, не требует нового LLM turn и не меняет правил доступа.

## Task 1: Подтвердить и изолировать native control

**Files:** Create `src/codex/control.mjs`, `src/codex/process-owner.mjs`, `test/fixtures/agent-control-server.mjs`, `test/integration/codex-control.test.mjs`, `test/manual/agent-control-native.mjs`, `docs/dev/agent-control-native-verification.md`. Modify `src/codex/threads.mjs`, `src/codex/rpc.mjs`, `src/codex/diagnostics.mjs`.

**Interfaces:** `CodexAgent.interrupt(agentId,{workIds}) -> Promise<Evidence>` interrupts all listed owned units; `CodexAgent.compact(agentId,{operationId,onProgress}) -> Promise<Evidence>`; `CodexAgent.reconcileControl(scope,record) -> Promise<Evidence>`; `onProgress(identity)` persists identities through an injected callback. `onControlEvent(agentId,event)` reports owned events. `CodexAgent.run(scope,events,invoke,{workId}={})` retains the existing call shape and `{settled}` result, adding optional `outcome:'completed'|'cancelled'` and `workId`. A steer keeps the active root's workId instead of creating a second unit.

- [x] **Step 1 — RED:** Add fixture assertions for terminal-before-ACK, root interrupted with child still running, late child tool call, startup cancellation, unrelated `contextCompaction`, interrupted compaction, and saved-thread resume after cancel. Capture an immutable binding `{workId,generation,threadId,turnId}` for every dynamic call; native params include turnId, so an old request must not inherit a newer `s.scope`.
- [x] **Step 2 — Verify RED:** `node --test test/integration/codex-control.test.mjs` must fail on missing adapter methods/unsafe root-only completion, not on unrelated imports.
- [x] **Step 3 — Implement adapter:** Interrupt all currently owned active turns, continue discovering children that started before interruption was fenced, track command execution completion, and require confirmed quiescence. Keep persisted root thread ID. Never call `thread/delete` for cancel. If native shutdown cannot prove command termination, stop and reap only the ownership-verified per-agent App Server tree, preserve saved sessions, and verify they remain resumable. Reuse OS identity/termination primitives of the existing process monitor through a narrow adapter; do not change widget ownership semantics.
- [x] **Step 4 — Implement compact observation:** Register notification listeners before RPC write; bind fresh root compaction turn/item IDs and await successful item completion plus successful turn completion. ACK alone is insufficient. Persist evidence through `onProgress`; reconcile using exact known thread/turn/item identity and `thread/read(includeTurns:true)` only where the runtime actually exposes retained evidence. No matching durable evidence means unknown. `RpcProcess` exposes bounded observation/cancellable waiters without retaining prompts or swallowing late evidence after a request timeout.
- [x] **Step 5 — Native capability gate:** The manual runner uses only a designated disposable workspace/thread, refuses an existing game/bot directory, and separates fixture, local-process, native inference and Telegram modes. Verify primary+child+long PTY cancellation, thread resume, manual compaction, notification order and restart readback. Record outcomes with CLI/version/platform, not actual private data. No native inference or Telegram sends are executed during planning; execution requires the explicitly designated test environment. If a capability is unavailable, record unknown and keep the hold rather than weakening the contract.
- [x] **Step 6 — GREEN:** `node --test test/integration/codex-control.test.mjs test/integration/codex.test.mjs test/integration/usage-adapter.test.mjs`. Native report clearly distinguishes executed/fixture-only/unverified cases. Checkpoint the explicit Task 1 file list; commit only if authorized.

## Task 2: Постоянные записи обслуживания и рабочая единица

**Files:** Create `src/storage/migrations/019.sql`, `src/agents/control-store.mjs`, `src/agents/work.mjs`, `test/integration/agent-control-storage.test.mjs`, `test/integration/agent-work.test.mjs`. Modify `src/storage/database.mjs`, `src/storage/retention.mjs`, `src/scheduler/tasks.mjs`; update `docs/storage.md` and `docs/scheduler.md` when behavior lands.

**Interfaces:** `createControlStore(db)` returns `read(agentId)`, `pause(agentId,notice)`, `wake(agentId)`, `requestCompact(agentId,request)`, `transition(operationId,expectedState,patch)`, `invalidate(agentId,reason)`, `pending()`. All mutations are synchronous transactions. `createWorkStore(db)` returns `begin(scope,origins) -> workId`, `addOrigins(workId,origins)`, `bindTurn(workId,identity)`, `suspend(workId,operationId)`, `resume(workId,identity)`, `finish(workId,outcome)`, `open(agentId)`. `Scheduler.interrupt(taskId,{reason})` preserves retryable pending work without automatic retry or the generic model-failure notification.

- [x] **Step 1 — RED:** Test migration from schema 18, rollback of corrupt migration, refusal of newer schema, bot/agent cascades, one active compact operation, conflicting continuation, and terminal transitions applied once. Test one scheduled aggregate across two compute turns, cancellation without success acknowledgement and interagent origins retained through suspension.
- [x] **Step 2 — Verify RED:** `node --test test/integration/agent-control-storage.test.mjs test/integration/agent-work.test.mjs`.
- [x] **Step 3 — Schema:** `agent_control` stores agent FK, persistent epoch, cancel phase (`running/cancelling/paused/unknown`), wake latch and compact reference. `agent_compactions` stores operation ID, agent/work/epoch/thread, kind, queue boundary, continuation, phase (`queued/submitting/running/succeeded/failed/unknown/cancelled`), native identity and continuation phase (`none/pending/submitting/accepted/completed/unknown/cancelled`). Control requests also store reply preparation phase and a confirmed ReplyTarget; unknown initial acknowledgement is never re-sent. `agent_work` stores work ID, agent/epoch, native identities, source references and outcome. A partial unique index excludes terminal compactions. These records contain no credentials or source message bodies; continuation is the explicitly allowed bounded instruction, protected from logs and admin status output.
- [x] **Step 4 — Implement transitions:** Store intent before native effects and launch acceptance separately from completion. Failed definite pre-launch work may return to pending; absence of an ACK is never proof of pre-launch failure. An active root steer adds origins to the same work unit; a new root turn gets its own unit. Bind each child to its spawning work, so completion of a later root cannot acknowledge an earlier child's task. Lifecycle invalidation increments epoch and tombstones old continuations. Update the database schema ceiling from 18 to 19. Terminal operation/work records expire after 30 days; pending/unknown records stay protected. Chat/bot deletion cascades; retention cannot revive or replay anything.
- [x] **Step 5 — GREEN:** Run both new tests plus `test/integration/scheduler.test.mjs` and `test/integration/retention.test.mjs`. Check that unchanged scheduler failure/retry semantics still apply outside control work. Checkpoint the Task 2 files; commit only if authorized.

## Task 3: FIFO-вытеснение, границы очереди и независимые holds

**Files:** Modify `src/agents/queue.mjs`, `test/integration/queue-batching.test.mjs`; create `test/integration/queue-control.test.mjs`. Update old overflow expectations in affected `commands`, `say-controller` and `buttons` tests as integration is connected. Update `docs/agents.md`.

**Interfaces:** Each accepted queue item has internal `id`, `seq`, event/source/admit and fixed `readyAt`. `captureBoundary(id) -> number`; `setBoundary(id,key,seq|null)`; `active(id) -> boolean`; `idleActive(id) -> Promise<void>`. `canStart(id,seq?)` defaults to readiness for the next new item; pump supplies the actual eligible head sequence. `onEvicted(id,event,source,{id:eventId,seq,reason:'overflow'})` is distinct from existing `onDropped`. `onAdmitted(id,{id:eventId,seq,source})` fires only after successful acceptance. Existing enqueue signatures and `accepted/full` result remain; the synchronous commit callback may receive `{id:eventId,seq}` so a callback receipt can bind before insertion completes. IDs are internal and do not change user event JSON.

- [x] **Step 1 — RED:** With fake Date/setTimeout, hold a queue containing ten chat entries interleaved with schedule/agent/inline/guest/widget/websocket entries; admit chat 11 and assert only the oldest chat is removed, total chat count stays ten and all other order remains. Assert an album is one evictable entry and no dispatched entry can be evicted.
- [x] **Step 2 — RED concurrency:** A failed `enqueueCommitted` keeps the old entry and emits no eviction callback. A new entry at t=199 ms retains the original deadline t=200 ms even when it evicts the first item. A boundary processes all eligible entries but never a later steer; an already mature prefix starts without another 200 ms delay. No eligible prefix means no dangling batch timer. `idleActive` never waits on its caller or on blocked collection timers.
- [x] **Step 3 — Implement:** `canAccept` is a nonmutating check for possible admission with eviction, not a destructive reservation. Validate the new entry, commit its synchronous durable admission, then replace the old chat entry atomically in RAM; publish callbacks only after success. Recheck admission before dispatch. A committed compact boundary and cancelling/paused/disabled/reset/unknown holds compose instead of clearing each other. Pump extracts only the prefix permitted by all boundaries.
- [x] **Step 4 — GREEN:** `node --test test/integration/queue-control.test.mjs test/integration/queue-batching.test.mjs test/integration/chat-actions.test.mjs`. Readiness for status and actual dispatch use the same sequence-aware predicate; existing 200 ms behavior for all sources remains. Checkpoint Task 3 files; commit only if authorized.

## Task 4: Последствия вытеснения Telegram и /say

**Files:** Modify `src/controller.mjs`, `src/ephemeral/events.mjs`, `src/ephemeral/store.mjs`; create `test/integration/queue-eviction-effects.test.mjs`; modify `test/integration/say-controller.test.mjs`. Update `docs/ephemeral.md` and `docs/message-events.md`.

**Interfaces:** `createSayEvents(...).evicted(scope,event) -> Promise<void>` uses the confirmed `preparedReply` and the existing serialized ephemeral message editor. `store.markEvicted(scope,address,{reason})` makes the incoming admission terminal without setting it back to unqueued. Controller tracks asynchronous eviction effects separately from queue dispatch and includes them in shutdown drain.

- [x] **Step 1 — RED:** Evict plain input/edit/album in private/group/forum chats and assert one `historyGap` on the next suitable ordinary event of the correct chat/topic. The saved Telegram message remains readable. Evict `/say` and assert one edit of its own prepared private reply, no public send/history insertion, no historyGap, no notification for other removal reasons and no revival from duplicate update delivery.
- [x] **Step 2 — Verify RED:** `node --test test/integration/queue-eviction-effects.test.mjs test/integration/say-controller.test.mjs`.
- [x] **Step 3 — Implement:** Wire only `onEvicted` to overflow effects. Extend gap tracking to private chats for actual evicted history-backed messages; do not consume a gap on `/say` merely because its eventType is message. Ordinary controller commands still do not enter model history. Replace pre-admission capacity rejection so a full queue accepts new `/say` after safe preparation; failed preparation/authorization cannot evict old work. Use a current controller scope for the private edit, with fresh access/address checks, not the old cancelled execution scope.
- [x] **Step 4 — Exact copy:** Edit prepared reply to `Request was removed from the queue because newer messages arrived. Please send it again.` Missing/unknown/private edit failures are recorded without another send or public fallback; they do not prevent the newly admitted request from processing.
- [x] **Step 5 — GREEN:** New tests plus `say-ephemeral`, `ephemeral-agent-tools`, `history-access`, `forum-controller` and `queue-batching`. Checkpoint Task 4 files; commit only if authorized.

## Task 5: Условный откат группы кнопок

**Files:** Create `src/messages/serial.mjs`, `src/messages/button-rollback.mjs`, `src/storage/migrations/020.sql`, `test/integration/button-rollback.test.mjs`. Modify `src/controller.mjs`, `src/messages/callbacks.mjs`, `src/messages/actions.mjs`, `src/storage/database.mjs`, `src/storage/retention.mjs`; extend `buttons`, `button-disabled`, `message-actions` tests. Update `docs/messaging.md` and `docs/storage.md`.

**Interfaces:** `createMessageSerial().run({botId,chatId,messageId},fn)` serializes existing-message mutations across accepted callbacks, model edits/deletes and rollback. `createButtonRollback({db,telegram,serial,access})` returns `prepare(scope,message,group,selected) -> receipt`, `commit(receipt,eventId)`, `handled(eventId)`, `restore(eventId) -> Promise<{status:'restored'|'superseded'|'unknown'|'failed'}>`, `invalidate(target)`. Receipts record group locator, original buttons, expected closed projection, native outcome and exact owning event.

- [x] **Step 1 — RED:** Test rich and ordinary keyboards, icon/no-icon labels, independent groups, changed message text, changed permits, group replacement, deleted message, selection while initial close edit is in flight, failed/unknown initial or restore edit and eviction racing a model edit.
- [x] **Step 2 — Verify RED:** `node --test test/integration/button-rollback.test.mjs`.
- [x] **Step 3 — Implement receipts:** Migration 20 adds agent/message/group-scoped receipts with event ownership and terminal state; database ceiling becomes 20. During callback acceptance, persist group snapshot/closed intent and queue admission together before asynchronous effects. Failed admission cannot consume the group. Native callback acknowledgement is prompt and independent of later model processing. Keep original permits outside rollback.
- [x] **Step 4 — Implement restore:** Under the shared message lock, read current representation and apply only the original buttons of the still-owned unchanged group. Preserve current text, unrelated groups and permits. Structural replacement/ambiguous group locator invalidates the receipt rather than applying an old message snapshot. Only after confirmed native edit reopen controller `closed`; unknown remains closed and is not blindly retried. Mark receipts handled before model dispatch. Plain ungrouped buttons need no restore; inline/widget protocols are unaffected.
- [x] **Step 5 — Lifecycle:** Serialize ordinary message delete/copy-related state and model keyboard/rich edits through the same lock, including existing edits that change permits. Scope keys separate bot/chat/message; no cross-bot contention or private/ordinary address collision. Delete receipts with their source lifecycle and expire safe terminal receipts after 30 days; never replay pending restore after restart without proof.
- [x] **Step 6 — GREEN:** New tests plus `buttons`, `button-disabled`, `message-actions`, `queue-eviction-effects` and `via-bot-edit`. Checkpoint Task 5 files; commit only if authorized.

## Task 6: Метрики контекста, событие и просмотр

**Files:** Create `src/codex/context.mjs`, `test/integration/context-status.test.mjs`; modify `src/codex/threads.mjs`, `src/controller.mjs`, `src/commands/agent.mjs`, `src/commands/help.mjs`. Update `docs/agents.md`, `docs/message-events.md`, `docs/agent-contract.md`, `docs/commands.md`.

**Interfaces:** `createContextTracker({now})` returns `bind(agentId,{threadId,sessionEpoch,model})`, `observe(agentId,notification)`, `invalidate(agentId,reason)`, `snapshot(agentId) -> ContextSnapshot`. `context_status` tool has an empty schema and returns this snapshot; `controller.contextStatus(scope)` adds only technical control phase for the admin view. `serializeAgentEvents(scope,events,{continuation?,interruption?})` inserts exactly one context_status immediately before actual native submission.

- [x] **Step 1 — RED:** Test unknown first run, cached-input inclusion without double addition, cumulative totals ignored, child notifications ignored, late notifications from an old turn/session, out-of-order native terminal events, resume/restart/model change invalidation and a post-compact snapshot with no fresh metric. Test every queue source, both turn/start and turn/steer, and that filtered-empty batches do not create status-only turns.
- [x] **Step 2 — Verify RED:** `node --test test/integration/context-status.test.mjs`.
- [x] **Step 3 — Implement:** Observe only root metrics, validate finite nonnegative counts/window and carry measuredAt. Invalidate last usage at root resume/new model/confirmed compaction; a known valid window may remain separately known, but stale usage must be null. No percentage-based action is present. Keep account totals untouched. Insert status after event filtering so the metadata cannot rescue an empty/expired event batch.
- [x] **Step 4 — Command/tool:** Add `/agent context [AGENT_ID]` with admin/owner before target lookup. No thread/model creation to read status. Output `Context: USED / MAX tokens`, `Measured: TIME`, `Control: STATE`, using `unknown` for nulls. Do not show continuation, private origins or model text. Register tool canonically on start and resume; service instructions explain estimate freshness and owner AGENTS.md policy.
- [x] **Step 5 — GREEN:** New tests plus `codex`, `usage-adapter`, `command-contract`, `help-rules` and `queue-batching`. Checkpoint Task 6 files; commit only if authorized.

## Task 7: /agent cancel и снятие паузы

**Files:** Create `src/agents/control.mjs`, `test/integration/agent-cancel.test.mjs`, `test/integration/agent-cancel-native.test.mjs`; modify `src/controller.mjs`, `src/codex/threads.mjs`, `src/agents/lifecycle.mjs`, `src/commands/agent.mjs`, `src/commands/help.mjs`, `src/commands/replies.mjs`. Update `docs/commands.md`, `docs/agents.md`, `docs/security.md`.

**Interfaces:** `createAgentControl({db,queue,agent,work,store,notify,clock})` returns `cancel(scope) -> Promise<ControlResult>`, `start(scope)`, `admitted(agentId,item)`, `status(agentId)`, `beforeWork(scope,events,{activeWorkId?}) -> {workId,events}`, `afterWork(workId,{outcome,settled})`, `invalidate(agentId,reason)`, `recover()`, `close()`, `idle()`. beforeWork creates a unit or adds origins to the active steered unit; afterWork waits for its actual root/children settlement and leaves a compact-suspended unit open. Add `createCommandReply(...).detachStatus(text) -> Promise<ReplyTarget>`; `updateControlReply(ReplyTarget,text)` only edits a confirmed existing ack using the original ordinary/ephemeral route, with current requester/access checks before the edit.

- [x] **Step 1 — RED:** Cancel primary/child/preflight, repeated cancel, enabled idle agent, disabled/missing agent, next event before interruption acknowledgement, new event from every source, full chat queue, explicit start, status reads and restart pause. Assert no ordinary `agent_failed` cleanup, thread deletion, queue clearing, false success or late controller mutation.
- [x] **Step 2 — Verify RED:** `node --test test/integration/agent-cancel.test.mjs test/integration/agent-cancel-native.test.mjs`.
- [x] **Step 3 — Implement order:** Persist cancelling and queue hold before native interruption. Invalidate the old work generation and immutable thread/turn bindings; allow persistence of outcomes from already-started effects while refusing new effects. Confirm all owned work stopped, then enter paused or consume the wake latch. Unknown keeps a hold. New valid admission after cancel sets wake even if cancellation is not finished; startup offers/recovery of old work do not count as new events. Replaced content of a genuinely new incoming message edit counts as a new ingress signal even when it updates an existing queue item.
- [x] **Step 4 — Commands:** Add only optional agent ID and existing lifecycle roles. No active root means pause an existing enabled agent; no agent/thread is created. Start clears only cancel-pause/wake state, never disabled/reset/unknown/compact holds; a disabled agent follows existing start behavior. Read-only commands do not wake. Cancel remains available while another control transition is pending.
- [x] **Step 5 — Replies:** Accept with `Cancelling current work…`; after proof edit to `Work cancelled. Queue paused until the next event.` or the accurate resumed/unknown state. Do not hold Telegram update polling until native completion. A detached reply target survives handler.finish and restart only as a confirmed address; its write is persisted before effect. An unknown ack/completion edit is not resent or published elsewhere. English errors contain only technical codes.
- [x] **Step 6 — Work accounting:** Mark interrupted work cancelled without reporting success. Preserve interrupted scheduled aggregate as retryable but do not auto-offer its original effects on the next message. Notify delegated requesters once with `agent_error`/`agent_cancelled` metadata, without private content. Persist one cancellation notice for the next real model batch; don't reinsert consumed input as a new request.
- [x] **Step 7 — GREEN:** New tests plus `commands`, `command-contract`, `scheduler`, `chat-actions`, `revoke-access`, `say-controller` and `codex-control`. Verify own process fixture cannot create a delayed marker after cancel; record native and platform skips explicitly. Checkpoint Task 7 files; commit only if authorized.

## Task 8: Ручное и агентское сжатие без continuation

**Files:** Extend `src/agents/control.mjs`, `src/agents/control-store.mjs`, `src/codex/threads.mjs`, `src/commands/agent.mjs`, `src/commands/help.mjs`; create `test/integration/agent-compaction.test.mjs`. Update `docs/commands.md`, `docs/agents.md`, `docs/agent-contract.md`.

**Interfaces:** Coordinator adds `requestCompact(scope,{kind:'manual'|'agent',continuation?,replyTarget?}) -> ControlResult`. Model tool `compact_context` accepts only optional continuation; root-thread-only mutations reject child callers. Request returns `{status:'accepted',operationId,finishTurn:true}` immediately after durable acceptance. Repeats return `already_pending`; a different agent continuation is rejected rather than replacing the first.

- [x] **Step 1 — RED:** Manual request behind active work plus queued prefix, later arrivals held, continuous arrivals without starvation, root finished with child active, agent request at the end of work, no automatic extra turn, disabled/missing context, concurrent manual/agent requests and mutation after accepted compact tool.
- [x] **Step 2 — Verify RED:** `node --test test/integration/agent-compaction.test.mjs`.
- [x] **Step 3 — Implement boundaries:** Manual request captures the current queue sequence and drains only that prefix. Agent request holds the next dispatch/steer immediately, returns from its tool without awaiting idle, and waits for its own compute turn plus children/controller operations to settle. Prevent subsequent controller mutations from the suspended work, instruct the model to end the turn, and never start native compaction while it still runs.
- [x] **Step 4 — Execute:** Persist submitting before native write, use Task 1 adapter and persist its progress, require successful terminal evidence, invalidate the usage estimate and release only this operation's hold. A definite pre-boundary work failure fails the waiting compact request with `precondition_failed`; a definite safe native failure releases the compact hold with an error, while unknown retains it. No auto-retry.
- [x] **Step 5 — Commands/replies:** Add `/agent compact [AGENT_ID]`, admin/owner in all forms, native call only threadId. Detached command ack is `Compaction queued.` and confirmed completion is `Context compacted.` The command doesn't create a missing thread, start a disabled agent, save files through an extra turn or clear context. Error/unknown outcome updates the same response when safe.
- [x] **Step 6 — GREEN:** New tests plus `context-status`, `queue-control`, `codex-control`, `command-contract` and `ephemeral-commands`. Assert no model start after a manual or no-continuation compact with an empty external queue. Checkpoint Task 8 files; commit only if authorized.

## Task 9: Continuation и общая граница завершения работы

**Files:** Extend `src/agents/control.mjs`, `src/agents/work.mjs`, `src/codex/context.mjs`, `src/controller.mjs`, `src/scheduler/tasks.mjs`; create `test/integration/agent-continuation.test.mjs`. Update `docs/message-events.md`, `docs/scheduler.md`, `docs/agents.md`.

**Interfaces:** `coordinator.continuationBatch(agentId,events) -> {workId,operationId,events}` returns a claim for one logical resume. Work units retain scheduled aggregates and delegated origins across turns; `finish(workId,outcome)` acknowledges them once after final root+children completion. A new native turn binds to its actual work ID before tool admission.

- [x] **Step 1 — RED:** Compact with continuation and no input launches one turn; with new input launches one batch beginning with status.continuation followed by new events. Repeated status tool/admin reads and later batches omit continuation. Fail/cancel before native success launches none. Validate 4096 Unicode code points, whitespace-only, wrong types and extra fields.
- [x] **Step 2 — RED accounting/privacy:** A scheduled task survives several compact continuations without premature deletion; final success acknowledges once, failure/cancel preserves retryable state. Another scheduled task arriving during continuation may join the native batch, but its origins stay associated with the correct work unit. Private `/say`/guest/inline origins cannot become a public cancellation/error reply or a new publication grant after resume.
- [x] **Step 3 — Implement:** Save continuation atomically with its request, keep it outside summary, and claim its submission in DB before turn/start. Insert it into the first context_status only. Include newer eligible events without treating the old instruction as higher authority than new input or current bot rules. Preserve ordinary forwarding/private/guest restrictions and request lifetimes; an expired route is reported unavailable, not redirected.
- [x] **Step 4 — Work settlement:** Do not execute existing completeScheduled/releaseOrigins at the intermediate compute boundary. Completion moves to work-unit settlement and is fenced by generation. Preserve source references and known receipts for the original unit through repeated continuations; don't replay earlier user input or completed effects. Cancellation drops the pending resume of this work and leaves new queued input intact.
- [x] **Step 5 — GREEN:** New tests plus `scheduler`, `say-controller`, `guest-controller`, `inline-controller`, `agent-cancel` and `agent-compaction`. Checkpoint Task 9 files; commit only if authorized.

## Task 10: Recovery, lifecycle и конфликтующие операции

**Files:** Create `test/integration/agent-control-recovery.test.mjs`; extend `src/agents/control.mjs`, `src/main.mjs`, `src/controller.mjs`, `src/storage/retention.mjs`, `src/storage/database.mjs`. Extend `revoke-access`, `retention`, `command-contract` tests. Update `docs/operations.md`, `docs/storage.md` and `docs/security.md`.

**Interfaces:** `controller.ready` includes control recovery before scheduler.recover/pollers start; `coordinator.recover()` reconstructs holds and reads native evidence. `invalidate(agentId,reason)` is called by stop/clear/rules/deletion and tombstones pending control work before waiting for active work. `idle()` waits for active I/O and cleanup, not an intentionally paused queue.

- [x] **Step 1 — RED fault matrix:** Reopen the database at each boundary: before native write, after write/before identity, after identity/before ACK, after compaction item/before turn completion, after native success/before local transition, before continuation turn/start, after write/before response, after acceptance/before completion. Assert no duplicated native compact or continuation start. Known persisted terminal identity can settle; insufficient evidence becomes unknown.
- [x] **Step 2 — RED lifecycle matrix:** Interleave cancel/start/stop/clear/rules/bot deletion with queued/running/unknown compact, active children, `/say` preparation, callback restore and inflight Telegram response. Clear/rules keep queue per existing contract; stop retains its existing queue discard policy. No cancelled old scope or continuation restores a deleted/reset/disabled agent.
- [x] **Step 3 — Implement:** Establish persistent holds before admitting startup events. Reconstructed scheduled pending work does not count as the new ingress required to wake an old cancel-pause. A confirmed cancelled or completed native turn isn't relabelled from missing process alone. Cancel during active compact suppresses continuation and waits for its terminal outcome. Stop/clear/rules/delete override queued controls, but preserve unknown-effect evidence until the owning context is safely retired. Clear/rules invalidate the old continuation/notice while preserving an existing cancel-pause; stop leaves the agent disabled. Start cannot release unknown, reset or active compact holds.
- [x] **Step 4 — Process/record lifecycle:** Reconnect to existing threads without deleting their records or replaying root input. Delete agents' rows and replies/receipts on chat/bot deletion; migrate ordinary route metadata on supported chat migration. Bound terminal metadata retention and close listeners/waiters/monitors on shutdown. Protect pending and unknown records. No busy-poll or permanent timer on a paused queue.
- [x] **Step 5 — GREEN:** `node --test test/integration/agent-control-recovery.test.mjs test/integration/retention.test.mjs test/integration/revoke-access.test.mjs test/integration/command-contract.test.mjs`. Checkpoint Task 10 files; commit only if authorized.

## Task 11: Общая проверка и документация

**Files:** Modify `README.md`, `docs/dev/index.md`; finish the current wiki articles listed in Tasks 2–10. Add `docs/dev/agent-control-verification.md`. Keep native report separate from fixture evidence.

- [x] **Step 1 — Inspect execution evidence:** Confirm the preflight baseline was recorded before Task 1 and list the actual Node/Codex/platform versions used. This plan-only task does not claim a green implementation baseline.
- [x] **Step 2 — Focused gate:** Run all newly added integration files and their changed legacy tests once the milestones are integrated. Resolve every new failure with a regression assertion; fake timers/observable-state waits replace arbitrary sleeps.
- [x] **Step 3 — Full gate:** `npm test`, then `node docs/dev/check-wiki.mjs`, then `git diff --check`. The project has no separate TypeScript/build gate; don't invent one. Run another full suite only after changes/failures justify it.
- [x] **Step 4 — Bounded native/platform acceptance:** In the designated disposable environment run Task 1 native checks on Windows and Alpine/Linux, then Telegram cases: cancel long primary+child, send correction during cancellation, trigger each wake source, queue 11 messages and observe gap, evict `/say`, reopen grouped buttons, manual compact ordering, compact continuation and restart. Verify private vs public routes by independent readback. Record actual versions, executed cases and skips; fake Telegram or a passing RPC response is not live acceptance.
- [x] **Step 5 — Wiki accuracy:** Document implemented commands/tools, source-specific ten-entry quota and eviction, grouped-button restore, estimate freshness, unknown outcomes, persistent control state and RAM queue limitations. Do not state that these capabilities existed before this branch. Link plan/spec/report from the English development index.
- [x] **Step 6 — Final review/handoff:** Review only the scoped diff against both specs and the Review Focus matrix. Inspect `git status`, staged/unstaged files and documentation links. Report automated vs live results separately. Commit/push/merge only with user authorization; never stage unrelated files or production runtime/configuration.

## Definition of done

Все согласованные сценарии обоих design-документов имеют реализацию и проверки. В частности, поставка содержит и cancel, и FIFO-вытеснение с Telegram-последствиями, и метрики, и ручное/агентское сжатие с continuation и recovery. Пауза и unknown не снимаются побочным действием, остановка не удаляет контекст, а новая функция не обещает durable inbox/outbox или exactly-once выполнение обычных запросов. Непроверенные native/platform свойства явно перечислены и не выдаются за подтверждённые гарантии.
