# React Widgets, Wordle, Nerdle and Dictionary Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task; superpowers:subagent-driven-development is an alternative only if the user chooses delegation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Полностью заменить прежний движок настоящим React runtime; перенести свежие Wordle, Nerdle и редактор базы из предоставленного wordle.zip, добавив двум играм многопользовательские overlays, общую таблицу и отдельное inline/guest-представление.

**Architecture:** Один sandbox-процесс на агента, один React root и собственный сохраняемый store на widgetId; вьюхи и overlays входят в Runtime.children. React/reconciler/SDK загружаются один раз на процесс, исходные модули кешируются по сборке, живые данные экземпляров изолированы. Контроллер владеет адресами, разрешениями, SQLite и native публикациями; runtime передаёт JSON-проекции и стабильные callback-токены, но не React nodes/замыкания между процессами.

**Tech Stack:** Node.js >=24.18.1, ESM/TSX, node:sqlite, esbuild 0.28.2, ws 8.22.0; планируемые точные зависимости react 19.3.1, react-reconciler 0.34.0, immer 11.2.9, ajv 8.20.0. Версии и peer `react: ^19.3.0` проверены по официальному npm registry при подготовке плана; установку/lockfile выполнять в задаче 1, не в ходе планирования. react-dom, Redux и react-redux не требуются.

**Spec:** [Согласованная концепция](../react-widgets-design.md), [Wordle](../react-wordle-spec.md). Для реализации читать оба документа, но не переносить исторические альтернативы tg-message/Redux/useMessage/onSent поверх окончательных решений плана.

**Статус:** реализация идёт в отдельном worktree `feat/react-widgets`; новый runtime, три React entrypoint и основные sandbox проверки готовы, живой Wordle-прогон ещё не выполнен. Пользователь подтвердил внешнее завершение раунда, например суточной ротацией агентом, и все 0–6 принятых слов в ячейке «Прогресс». Новый источник миграции — wordle.zip SHA-256 `53d0690df1b0ba9522073134903a60b9a42c2eede7f973afbdff579f41ccf88b`, 486183 байта. Переписываются действующие widget.tsx, nerdle.tsx, dictionary-admin.tsx, а не исторический tar.gz. Быстрые inline/guest-скрипты отложены и в план не входят.

## Global Constraints

- База планирования — актуальный `origin/main` `9c28a723452781eb36c035cc6360e0e0d81f96d4`, проверенный через `git ls-remote`; документация обсуждения находится в прежнем worktree group-file-help на fd34d09. Реализацию начинать в новом изолированном worktree от актуального main, перенося только согласованные документы. Не откатывать main до старой ветки и не терять исправление participant-specific inline callback routing: `src/widgets/callbacks.mjs`, тест `widget-inline-callbacks.test.mjs`.
- Полная замена legacy, без совместного запуска и без автоматического переноса игр. Старые Telegram-сообщения остаются с отключёнными кнопками best effort; пользовательские исходники/архивы не удаляются. Поведение старого публичного SDK не поддерживается новым движком.
- Исходный wordle.zip сохраняется; безопасно распаковать проверенные paths в отдельную рабочую копию и мигрировать действующие три entrypoints. Все broad/select словари и Nerdle assets сохранять byte-for-byte до намеренной проверки/правки; не восстанавливать слова из старой версии. Результат упаковать отдельно с manifest/hash и обновлёнными инструкциями, оригинал не перезаписывать.
- Никаких MTProto, !widget/*, !exec/*, новой inline-пагинации или механизма регистрации inline-скриптов. Существующие inline/guest транспорт и приватные команды остаются рабочими.
- Все controller labels/errors/instructions/wiki — English. Dev-документы могут быть Russian; язык пользовательского Wordle — Russian, как в исходном приложении. Wiki обновляется с реализующим этапом, а не заранее выдаётся за текущий контракт.
- Сохраняемые данные — plain JSON, нормализация store сохраняет согласованное поведение undefined object fields/array slots; первый аргумент requestAgent и агентский ввод строго JSON без потерь. Functions/resources в диагностике ephemeral props показываются ограниченно, функции как `[Function]`.
- Квоты не повышать молча: 10 widgets/agent, 10 runtime processes/bot, 256 MiB/runtime tree, state 1 MiB, event 64 KiB, pending 1000/8 MiB, RPC frame 2 MiB; heartbeat 5_000 мс, silence 10_000 мс, teardown 5_000 мс, sample 500 мс. Переиспользовать действующий sandbox/monitor; compiler остаётся отдельным временным процессом.
- Overlay: одно на пользователя в родительской вьюхе; 20 минут неактивности получателя, фоновые edits TTL не продлевают. Самостоятельные ephemeral views имеют тот же TTL, могут быть несколькими; при рестарте отключаются все ephemeral views.
- Одна попытка Telegram edit, без автоматического resend/fallback. Неизвестный исход не считается ни успехом, ни доказанным отсутствием внешнего эффекта. Только явное deleted/unavailable удаляет регистрацию.
- Store save предшествует управляемой Telegram-публикации. Синхронный dispatch неделим; await не удерживает widget-wide lock. После аварии локальная очередь и начатые handlers не переигрываются; восстанавливаются сохранённые store/ordinary views, effects запускаются заново.
- Автоматические error-уведомления: первая ошибка сразу; затем новые ошибки агрегируются не чаще одного раза в 5 минут на agentId. Явные notifyAgent/requestAgent этим лимитом не подменяются.
- На текущем этапе разрешены план/документы, не product code, установка зависимостей, миграция БД, реальные публикации, коммит или push. При реализации выполнять проверки этапов; промежуточные commits и merge/push требуют отдельного разрешения.

## Review Focus

1. Второй участник inline/guest-публикации получает другой opaque inline ID: callback должен попасть в каноническую вьюху, не перепривязать её и не обойти чужую регистрацию — задачи 8 и 16.
2. Завершение раунда/parent edit/TTL во время незавершённого overlay mount: поздний ответ не должен вернуть активную приватную клавиатуру — задачи 7, 9 и 16.
3. Telegram уже принял отправку, но ответ/SQLite commit потерян: не создавать повторный widget message и не приписывать сообщение не тому owner — задачи 7 и 14.
4. Две вьюхи/два widgetId одного модуля используют state, Context, hooks, selectors и ресурсы одновременно: общий модуль не должен означать общий живой store — задачи 3–5 и 13.
5. Отмена requestAgent до dispatch/во время batch/после передачи агенту, а также создание widget из effect с запросом к этому же агенту: не будить отменённое событие, не прерывать постороннюю работу и не создавать deadlock — задачи 11–12.

## Порядок и границы

Этап A (задачи 1–6) — проверяемое ядро React без Telegram. Этап B (7–14) — полная интеграция и удаление legacy. Этап C (15–19) — Wordle, Nerdle, редактор, полная регрессия и ограниченная live-приёмка. Нельзя выпускать промежуточный код, который удаляет legacy, но ещё не умеет восстановить/публиковать React widgets.

Проверки ниже — будущие команды и ожидаемые результаты, не отчёт о пройденных тестах. `TG_*` live credentials и исходный архив задаются явно в ignored локальном конфиге, не коммитятся. Команды показаны для запуска из нового implementation worktree с PowerShell `login:false`.

## Карта файлов и интерфейсов

Существующие точки интеграции main: `src/widgets/{service,build,builder,host,runtime,render,store,views,events,callbacks,contract,api,transport,sandbox,monitor,receipts,errors}.mjs`, `src/widgets/types.d.ts`, `src/controller.mjs`, `src/agents/queue.mjs`, `src/codex/threads.mjs`, `src/storage/database.mjs`, `src/storage/migrations/020.sql`, `src/messages/{actions,callbacks,serial}.mjs`, `src/inline/{messages,store}.mjs`, `src/ephemeral/messages.mjs`, `src/guest/service.mjs`. Direct edit/delete находятся в actions.mjs/inline/messages.mjs/ephemeral/messages.mjs, отдельного messages/edit.mjs нет.

Новые focused модули:

| Файл | Ответственность |
| --- | --- |
| `src/widgets/module-registry.mjs` | Изолированная регистрация defineStore одного загруженного build |
| `src/widgets/build-cache.mjs` | Манифест зависимостей и кеш build/module по содержимому |
| `src/widgets/react-store.mjs` | Immer recipes, JSON validation, revision, selectors |
| `src/widgets/react-context.mjs` | Контексты instance/view, публичные SDK hooks |
| `src/widgets/reconciler.mjs` | React host config, один root/instance и error boundaries |
| `src/widgets/host-tree.mjs` | Host nodes и последовательность дочерних узлов, без Telegram I/O |
| `src/widgets/projection.mjs` | JSX host tree → rich/sticker/dice и клавиатура |
| `src/widgets/view-handles.mjs` | mount/unmount, stable IDs, parent/user, live/snapshot разделение |
| `src/widgets/publications.mjs` | Save barrier, сериализация по адресу, native ack, partial outcomes |
| `src/widgets/subscriptions.mjs` | useOnMessage/useOnReply/useOnReaction и текущие closures |
| `src/widgets/overlays.mjs` | Ephemeral адреса, TTL, parent invalidation, cleanup |
| `src/widgets/agent-requests.mjs` | Controller-side requestId/responseSchema/queue cancellation |
| `src/widgets/error-notifications.mjs` | Общая на agentId агрегация ошибок |
| `src/widgets/legacy-cleanup.mjs` | Возобновляемое best-effort отключение старых публикаций |
| `src/storage/migrations/021.sql` | Новая схема и intent очистки legacy, номер перепроверить перед реализацией |
| `examples/widgets/wordle/*` | Обновлённый комплект Wordle/Nerdle/редактора с теми же действующими entrypoints |
| `test/helpers/react-widget-fixture.mjs` | Настоящий reconciler, временная SQLite, controllable native transport/clock |
| `test/helpers/react-wordle-fixture.mjs` | Фиксированные broad/select/equations/часы, общий игровой fixture и два участника |

Не превращать service/controller в новые монолиты: они связывают эти модули. Не менять глобальный messaging serializer ради ограничений renderer.

### Авторский SDK, который должны согласованно использовать задачи

- `defineStore({version:number, initialState:object | ((oldState, oldVersion)=>object)}): void`; максимум один вызов во время загрузки module build, иначе ошибка. Без вызова version 0 / {}. New вызывает initializer(undefined, 0), равная версия восстанавливается без вызова, старая мигрируется, более новая отклоняется.
- `useSelector(selector)` с `Object.is`, `useDispatch()` со стабильным sync dispatch(recipe); recipe void/sync, без вложенного dispatch/I/O. Реализатор может использовать Immer и useSyncExternalStore с кешируемым selector snapshot; отдельный equality API в v1 не вводить.
- `useWidget(): WidgetHandle`, `useView(): ViewHandle`, `useViews(): readonly ViewHandle[]`, `useTelegram(): ScopedTelegramAPI`. useView вне view subtree даёт понятную ошибку; остальные hooks доступны Runtime. Объекты/списки реактивны только по изменению их публичных снимков.
- `widget.mount(targetOrViewId, node, {force?:boolean}?): Promise<ViewHandle>`; `widget.unmount(selector): Promise<void>`; `widget.closeOverlays(selector): Promise<void>`; `widget.getView(selector): ViewHandle|null`.
- `view.mount(node?, {force?:boolean}?): Promise<ViewHandle>`; без node сохраняет последний renderer. `view.unmount(): Promise<void>`, `view.closeOverlay(): Promise<void>`, `view.getOverlays(): readonly ViewHandle[]`. `closeOverlay` — строго `view.user ? view.unmount() : undefined`. Для закрытия оверлеев публичного родителя использовать `widget.closeOverlays(view.id)`, не добавлять несогласованный публичный alias.
- Readonly view.id/props/target/message/parent/user/status/error. Public: user=null,parent=null; overlay: user=receiver,parent=public; standalone ephemeral: user=receiver,parent=null. Handle после await выполняет операции по актуальному ID/generation; захваченный снимок остаётся снимком.
- Button event: `{from, view, callbackQueryId, overlay(node,options?):Promise<ViewHandle>, respond(answer?):Promise<void>}`. Overlay от public создаёт/обновляет личную вьюху; от overlay обновляет её же; от standalone ephemeral отклоняется. event.mount отсутствует.
- `useOnMessage(callback)`, `useOnReply(callback,{disabled?:boolean}?)`, `useOnReaction(callback,{disabled?:boolean}?)` с автоматическим cleanup и актуальным callback после commit. `useDice(): readonly [number|null,string|null]`; unchanged pair сохраняет identity. view.message пассивен, useMessage/onSent не вводить.
- `widget.notifyAgent({text}):Promise<void>`; `widget.requestAgent({text,responseSchema?,data?},{timeoutMs?,signal?}):Promise<JSONValue>`. Требуется timeoutMs или signal. Первый аргумент строго JSON, второй локальный. Отмена/timeout заканчивают request и снимают ещё не переданное событие. Ответ — `answer_widget_request({requestId,result})`.

JSX: rich-теги по Telegram Rich HTML (`p`, `b`, `u`, `mark`, `table`, `tr`, `td`, `img`, медиа и rich tg-button); специальные `tg-sticker src` и `tg-dice emoji`; внешняя клавиатура `tg-keyboard`/`tg-button-row`/`tg-button`. Не нужен tg-message. Несколько tg-keyboard объединяют ряды в порядке дерева. Callback-кнопки имеют onClick, а не авторские routing IDs. Обычный текстовый JSX становится rich paragraph.

Поддерживаемые адреса: обычный `{chatId,messageId}` / новая отправка `{chatId,topicId?,reply_parameters?,...}`, opaque `{inlineMessageId}`, первая guest-отправка `{guestRequestId}`, отдельный ephemeral `{chatId,receiverUserId,ephemeralMessageId?}` со свежим callbackQueryId при необходимости. Эти варианты взаимоисключаются; creation options не становятся правом отправки в неизвестный чат. Агентский send/target adapter разрешает привычный текущий чат; renderer не получает выдуманного chatId для inline.

## Task 1: Закрепить новый контракт SDK и тестовое ядро

**Files:** Modify `package.json`, `package-lock.json`, `src/widgets/types.d.ts`, `src/widgets/contract.mjs`; Create `test/helpers/react-widget-fixture.mjs`, `test/integration/react-widget-contract.test.mjs`; update `docs/widgets.md` только после подключения новых tools в задаче 11.

**Interfaces:** Produces типы SDK/targets/nodes/errors по разделу выше, `validateReactMount(input)`, `validateReactState(value)`, `validateAgentRequestPayload(value)`; fixture строит новый runtime без реального Telegram.

- [ ] Написать failing assertions: смешанные target selectors/потеря JSON/неэкспортированный ordinary root отвергаются; arbitrary live props допускаются только для ephemeral node из runtime; state нормализует undefined так же, как действующий framework.
- [ ] Run `node --test test/integration/react-widget-contract.test.mjs`; ожидается FAIL до появления нового контракта.
- [ ] Добавить точные dependencies без ReactDOM/Redux и обновить lockfile; разработать types/helpers и skeleton fixture. Проверить peer совместимость react/reconciler, SDK hooks нельзя импортировать из react-redux.
- [ ] Run тот же тест и `npm ls react react-reconciler immer ajv`; ожидается PASS и одна совместимая пара React/reconciler. Записать версии и результат в журнал выполнения плана.

## Task 2: Схема данных и безопасная граница замены legacy

**Files:** Modify `src/storage/database.mjs`, `src/widgets/{store,views,migrate}.mjs`; Create `src/storage/migrations/021.sql`, `src/widgets/legacy-cleanup.mjs`, `test/integration/react-widget-upgrade.test.mjs`.

**Interfaces:** `createWidgetStore(db)` хранит engine generation, store/schema revision и metadata ordinary/ephemeral views; `runLegacyCleanup({db,telegram,authorize})` удаляет только intents подтверждённых прежних публикаций и не стартует legacy runtime.

- [ ] Зафиксировать старую SQLite v20 с несколькими widgets, обычной и inline-вьюхой, pending/started events, publication receipt и исходным файлом. Assert после upgrade нет старых работающих registrations/events, исходник неизменён, таблицы других подсистем сохранены, cleanup intents содержат только подтверждённые owned targets.
- [ ] Run `node --test test/integration/react-widget-upgrade.test.mjs` → FAIL. Не открывать production DB.
- [ ] В upgrade transaction сохранить cleanup intent, удалить legacy rows/queues и создать новую схему без переноса games. Новые widgets: active/error, runtimeProps, storeVersion, storeRevision, generation/buildId. Views: viewId/widgetId, parent/receiver, target kind, status/error, ordinary exportName/JSON props/key, last confirmed projection/message, binding epoch/deliveryUnknown. Ephemeral nodes/props не сериализуются. Номер migration взять следующий после фактического main, не перезаписывать существующий SQL.
- [ ] Реализовать идемпотентный cleanup при старте до приёма новых widget events. Disable кнопок best effort; неопределённые receipts остаются диагностикой, без guessed target/resend. Прерывание cleanup допускает повтор только оставшихся подтверждённых cleanup jobs.
- [ ] Run тот же тест, включая rollback schema error и restart mid-cleanup → PASS. Снимок БД для ручной приёмки отдельно резервируется перед переходом; это не игровая миграция.

## Task 3: Общий module build и регистрация defineStore

**Files:** Modify `src/widgets/{build,builder,compiler-runtime,service}.mjs`; Create `src/widgets/{module-registry,build-cache}.mjs`, `test/integration/react-widget-build.test.mjs`, `test/fixtures/react-widgets/{counter,second-store,late-store,shared-context}.tsx`.

**Interfaces:** `loadWidgetModule(buildId, factory): Promise<{exports,storeDefinition}>`; `registerModuleStore(moduleKey,definition):void`; cached module descriptor повторно используется, store здесь не создаётся. Build result включает manifest input path/mtimeNs/size/contentHash, sdk/compiler options и immutable snapshotId.

- [ ] Failing tests: два экземпляра импортируют файл один раз, defineStore виден обоим; duplicate/late call throws; отсутствующий call даёт v0/{}; failed import не кеширует partial metadata. Две параллельные сборки не перехватывают регистрацию друг друга.
- [ ] Run `node --test test/integration/react-widget-build.test.mjs` → FAIL.
- [ ] Создать module-scoped SDK binding, связанный с конкретным moduleKey/factory, без переменной «текущий виджет». Bare defineStore не удаляется tree shaking. Окончание регистрации — успешное завершение evaluation factory; top-level await в widget entry v1 отклоняется понятной build error.
- [ ] Материализовать доверенные React/reconciler/SDK в одном runtime asset node_modules; runtime bundle и widget snapshots используют тот же external React и react/jsx-runtime. Запретить переопределение этих imports workspace-копией; arbitrary React-компоненты/Context/hooks поддерживаются. Кешировать все входы esbuild metafile и resolver/package.json/options; смена mtime при прежнем содержимом не пересобирает, изменение/исчезновение зависимости пересобирает. Compiler остаётся вне persistent runtime.
- [ ] Run тест с lazy local dependency, изменением nested import/package resolution, отсутствующим input, общей React identity и отказом чужого path/symlink → PASS; старый build работает до успешного переключения.

## Task 4: Сохраняемый instance store и селекторы

**Files:** Create `src/widgets/{react-store,react-context}.mjs`, `test/integration/react-widget-store.test.mjs`; Modify `src/widgets/contract.mjs`.

**Interfaces:** `createReactStore({definition,saved,onRevision}): {getSnapshot,subscribe,dispatch,replace,version,revision}`; `useSelector`/`useDispatch` получают store из instance Context, не из module registry.

- [ ] Failing tests: два stores одного descriptor независимы; new/equal/older/newer schema versions; sync recipe atomic; exception/reentrant/async recipe не применяет draft; undefined normalization и не-JSON ресурсы; selector unchanged сохраняет snapshot и не создаёт feedback-loop.
- [ ] Run `node --test test/integration/react-widget-store.test.mjs` → FAIL.
- [ ] Реализовать Immer produce и cached selector snapshot на useSyncExternalStore. Dispatch синхронен, возвращает void, revision растёт только при принятом изменении; external replace(state) делает полную замену без expectedRevision. Клонировать initialState на widgetId; initializer/migration pure.
- [ ] Тест продолжения после await: A ждёт, B dispatch уже применён, A dispatch работает с текущим state; захваченное старое значение не переписывается автоматически. Ошибка после await не откатывает B или прежние dispatch A.
- [ ] Run тесты → PASS; сохранить точный формат store version/revision для controller bridge. Асинхронную запись в SQLite из произвольного subscribe не добавлять.

## Task 5: Настоящий reconciler, Runtime и жизненный цикл views

**Files:** Create `src/widgets/{reconciler,host-tree,view-handles}.mjs`, `test/integration/react-widget-root.test.mjs`; Rewrite `src/widgets/runtime.mjs`; extend `src/widgets/react-context.mjs` and fixture.

**Interfaces:** `createReactRuntime({bridge,moduleRegistry})` поддерживает load/create, mount/update/unmount, describe, retire; один instance root = `<Runtime {...props}>{views}</Runtime>`. `commitProjection(ref,viewId,projection,revision,epoch)` задаётся следующими задачами; здесь controlled fake sink.

- [ ] Failing tests с реальным reconciler: useState/useEffect/useRef/Context, default Runtime и wrapper без default, Runtime с нулём views, общий socket Context для двух views без перекомпиляции, отдельные roots двух widgets; не тестировать это fake component evaluator.
- [ ] Run `node --test test/integration/react-widget-root.test.mjs` → FAIL.
- [ ] Реализовать host config закреплённого react-reconciler, error boundary для каждой вьюхи и Runtime-root boundary. Standard React hooks/effects не патчить; исключение callback/Promise ловится explicit wrapper. Эффекты async-start не удерживают create/mount или widget-wide lock.
- [ ] Реализовать handles/hook snapshots: same root type+key, изменённые props → hooks сохраняются; смена type/key/force → cleanup/remount; error-view mount remounts без force; mount() удерживает последнюю ноду; public unmount отключает регистрацию, ephemeral просит delete. Parent lookup и stale handles проверяют generation.
- [ ] Run тесты, включая `useViews` без бесконечного рендера, no-view Runtime, unmount одного view без удаления store и независимый view error → PASS.

## Task 6: JSX projection и неизменяемые native тела

**Files:** Create `src/widgets/projection.mjs`, `test/integration/react-widget-projection.test.mjs`; replace `src/widgets/jsx-runtime.mjs` с новым React/SDK entry adapter, update `src/widgets/types.d.ts`.

**Interfaces:** `projectHostTree(tree,{priorBody,creating}): {kind,body,replyMarkup,callbacks}`; callbacks содержат live closure identity в runtime, JSON wire definitions готовятся отдельно. Все projections валидируются целиком до Telegram I/O.

- [ ] Failing tests: rich tags/text/escaping/table cells/u/mark/media, row/keyboard merge, native dice/sticker disjoint с rich, null/Fragment/keyboard-only → один пустой paragraph. Незнакомый host tag или unsupported attribute не теряется молча.
- [ ] Run `node --test test/integration/react-widget-projection.test.mjs` → FAIL.
- [ ] Реализовать type inference без tg-message и whitelist из Telegram rich HTML. Img всегда rich photo. Неподдерживаемые live location/poll/contact/native media roots не вводить; scoped useTelegram всё ещё может вызывать разрешённые методы отдельно. Media принимает действующий `file:` контракт main, без регрессии ordinary string vs InputMedia.
- [ ] Реализовать callback identity по React host node/key path, включая key родительского списка. Новый closure обновляется при commit без смены wire ID. Удалённая кнопка/поддерево invalidates tokens; callback_data не хранит ответ Wordle. Ровно один native body: first mount только new send; неизменный body rerender/restore допустим, keyboard изменяем; смена dice emoji/sticker/type или переход в empty — render error. Force не бросает dice заново.
- [ ] Run тесты keyed player rows без key у внутренней кнопки, равных props, blank rich, изменённого native body с одновременно новой keyboard → PASS и ноль частичных edits.

## Task 7: Controller publications, адреса и подтверждение mount

**Files:** Create `src/widgets/publications.mjs`, `test/integration/react-widget-publications.test.mjs`; Modify `src/widgets/{render,receipts,views,service,errors}.mjs`, `src/messages/{actions,serial}.mjs`, `src/inline/messages.mjs`, `src/ephemeral/messages.mjs`.

**Interfaces:** `publish(ref,viewId,{projection,storeRevision,bindingEpoch}):Promise<PublicationOutcome>`; `PublicationOutcome` сообщает confirmed/unchanged/view-error/removed/unknown, receipt и target в рамках реально полученного native результата. `mount` преобразует outcome в согласованную таблицу reject/View(error).

- [ ] Failing tests: send/ordinary edit/inline boolean ack/guest initial answer, save-before-send, старый ack после нового generation, более новая projection не перетирается поздним ответом; no-op не делает native request. Mock transport умеет отдельно задерживать request и acknowledgement.
- [ ] Run `node --test test/integration/react-widget-publications.test.mjs` → FAIL.
- [ ] Объединить публикации на одном botId+canonical address в существующую serialization main; persist barrier сохраняет нужную revision перед edit. Coalesce ещё не отправленные projections до последней актуальной, но не завершать ожидание mount до соответствующего подтверждения/ошибки. Поддержать initial guest target → confirmed inline target без guessed chat ID. Render never uploads by inline; file media готовится действующим adapter main.
- [ ] Реализовать исходы: validation before adoption rejects unchanged; adopted node render/send failure returns View(error); explicit missing/access loss removes and rejects; unknown send/DB-after-send returns диагностику partial effect и не повторяет. Одна попытка edit. Direct API edit/delete по опубликованному target после подтверждения снимает registration; failed call не выполняет speculative delete, unknown call переводит binding в error/deliveryUnknown. Renderer-owned edit exempt; cleanup не перезаписывает явно отредактированную клавиатуру.
- [ ] Run tests с fault injection до/после native ack/DB commit, повторным mount при unknown, конфликтом двух owners и замершим direct edit → PASS. Реальная функция ошибки не приравнивает любой HTTP 400 к deleted.

## Task 8: Callback routing и подписки компонентов

**Files:** Create `src/widgets/subscriptions.mjs`, `test/integration/react-widget-events.test.mjs`; Modify `src/widgets/{events,callbacks}.mjs`, `src/controller.mjs`; port assertions `test/integration/widget-inline-callbacks.test.mjs`, `widget-callback-diagnostic.test.mjs`.

**Interfaces:** `registerViewSubscription(ref,viewId,type,slot,callback,enabled)`, `routeWidgetEvent(botId,update):Promise<boolean>`; ButtonEvent соответствует контракту SDK. Новый runtime не требует named module exports для каждого callback.

- [ ] Failing tests: button invokes latest committed closure; keyed parent survives reorder; removed token отвергается; уже запущенный handler не отменяется лишь из-за removal. Два разных inline ID участников одного known view адресуют один canonical owner; conflicting known ID или чужой bot/token не проходит.
- [ ] Run `node --test test/integration/react-widget-events.test.mjs` → FAIL.
- [ ] Заменить named callback routing closure registry с generation/view binding; сохранить принцип current main `resolveInlineWidgetCallback`: unknown participant ID не становится канонической регистрацией, никакой нормализации opaque ID. Политика callback rotation после restart: новые callbacks создаются при перепубликации, прежние не соответствуют новому generation и отклоняются.
- [ ] Реализовать hooks с disabled/cleanup/latest callback и фиксированным порядком регистрации внутри одного commit. Активный reply handler эксклюзивно забирает событие виджету; отсутствие/disabled — обычный маршрут. Команды/permissions контроллера сохраняют приоритет. После выбора маршрута disabled change/error не отправляет тот же reply агенту. Reaction removal/anonymous counts не превращать в fictional user events.
- [ ] useOnMessage вызывается только после новой подтверждённой отправки/успешного edit; boolean inline ack даёт partial message snapshot, не выдуманный Message. Изменение callback identity, no-op render, restore и само подключение хука не генерируют событие. useDice обновляет только изменившуюся пару и допускает keyboard update без повторного send.
- [ ] Проверить явный feedback-handler, который сам dispatch-ит три изменения после публикаций: три следующих edits разрешены. Движок не вводит скрытую защиту, подавляющую согласованные useOnMessage/effect updates; бесконечный авторский цикл остаётся ошибкой дизайна приложения.
- [ ] Run tests hooks unmount, anonymous reactions, render exceptions/async reject, два реальных actor IDs и stale token → PASS. Новые reply маршруты для неизвестного inline/guest chat не обещать.

## Task 9: Overlays и самостоятельные ephemeral views

**Files:** Create `src/widgets/overlays.mjs`, `test/integration/react-widget-overlays.test.mjs`; Modify `src/widgets/{views,publications,view-handles,react-context,service}.mjs`.

**Interfaces:** `openOverlay(ref,parentViewId,actor,callbackQueryId,node,options)`, `closeOverlays(ref,parentSelector)`, `expireEphemeralViews(now)`. Контроллер знает parent/recipient/epoch, node/несериализуемые props остаются в runtime.

- [ ] Failing tests: one actor/parent replacement, two actors independent, same component props preserve state/force resets, overlay-on-overlay updates same view, standalone overlay() rejects, standalone closeOverlay unmounts, public closeOverlay no-op.
- [ ] Run `node --test test/integration/react-widget-overlays.test.mjs` → FAIL.
- [ ] Native send с receiver/callback/replace flag, ephemeral edit/delete по полному адресу. Проверить owner/actor, fresh callback/admin permissions через native API; никаких public fallbacks и MTProto. Ordinary root/export restriction не навязывается runtime-created ephemeral node; agent-created ephemeral input остаётся JSON/named export.
- [ ] TTL = recipient interaction +20 минут; background edits/refresh timers не продлевают. Перед реальным parent edit закрыть/отвязать его overlays, unchanged projection не закрывает. Родительские callbacks блокируются generation/epoch во время teardown. Сохранять достаточно адресов для restart cleanup, но не function props.
- [ ] Run fake-clock tests TTL boundary, user vs background touch, parent edit failure не воскрешает overlay, close/finish/TTL во время delayed overlay send с поздним ack → PASS: поздно созданный ephemeral receipt удаляется/деактивируется, ни одного активного orphan handle. Отсутствие full Message у edit учитывается.

## Task 10: Управляемые ресурсы, generation и ошибки

**Files:** Modify `src/widgets/{host,runtime,manager,service,transport,sandbox,monitor}.mjs`; Create `src/widgets/error-notifications.mjs`, `test/integration/react-widget-lifecycle.test.mjs`.

**Interfaces:** host session остаётся keyed botId+agentId; runtime instance keyed widgetId+generation. `retireGeneration(ref)` отклоняет новые операции и очистку старого поколения, закрывает resources/ephemeral, не уничтожая другие instances. `reportWidgetError(ref,viewId,error)` сохраняет диагностику и агрегирует agent wake.

- [ ] Failing tests: async A не блокирует B; old async continuation после update/delete не меняет новый store/native message; view render error остаётся локальным; Runtime effect/storage/process failure даёт widget error, другие widgets живут если процесс доступен.
- [ ] Run `node --test test/integration/react-widget-lifecycle.test.mjs` → FAIL.
- [ ] Переработать manager вместо keepPending/replay: sync segments ordered, межоперационные locks не удерживаются на пользовательский await, resources/effects очищаются, Runtime живёт при 0 views. Build/export validation до остановки старой версии; переключение выбранного instance сохраняет store/ordinary targets и перезапускает tree, не обновляет прочие widgets этого build.
- [ ] Реализовать widget/view error, quota/failure diagnostics, bounded first-immediate/5-minute summaries. Repeated same error и explicit failed repair не спамят owner. Monitor сохраняет native Windows/Linux ownership и kills только свой runtime tree; formatter не называет error состоянием stopped.
- [ ] Run тесты instance deletion, root-wide crash, failed migration/version downgrade, description update, socket lifecycle 0↔2 views, request cancellation и repeated errors с fake clock → PASS. Не ослаблять sandbox или увеличивать memory limit ради прохода.

## Task 11: Запросы и уведомления агенту

**Files:** Create `src/widgets/agent-requests.mjs`, `test/integration/react-widget-agent-requests.test.mjs`; Modify `src/widgets/{api,service,react-context,contract}.mjs`, `src/agents/queue.mjs`, `src/controller.mjs`, `src/codex/threads.mjs`.

**Interfaces:** controller creates requestId and owner/generation-bound pending record in RAM; SDK methods по разделу API. Agent event `{eventType:'widget_request',widgetId,requestId,text,data?,responseSchema?,expiresAt?}`; notify event retains widget_message. Agent tool `answer_widget_request({requestId,result})` resolves именно этот request, не весь model turn.

- [ ] Failing tests: timeout includes queued time; signal already aborted queues nothing; queued cancellation uses AgentQueue.cancelWhere and does not wake owner; delivered request cancellation doesn't kill unrelated model work; late/wrong owner response rejects; payload is immutable JSON snapshot, AbortSignal не передаётся агенту.
- [ ] Run `node --test test/integration/react-widget-agent-requests.test.mjs` → FAIL.
- [ ] Реализовать owner/generation check и race единственного settlement. Схема: JSON Schema draft-07, локальные `$ref` только внутри переданной схемы, без сети/custom keywords/coercion/default insertion. Ajv strict validation, error paths возвращаются инструменту. Invalid schema rejects before enqueue; invalid result оставляет request pending до исходного deadline, без нового wake/продления. Без schema любой plain JSON.
- [ ] Связать drop/evict/owner disable/delete/restart/generation retire с rejection waiting Promise. После handoff событие нельзя отозвать из уже работающего хода, но result недействителен. RPC request/response и AbortSignal сериализуются как отдельные request/cancel frames без передачи signal object.
- [ ] Run deadlock test: create_widget запускает effect→requestAgent тому же owner, create возвращает до ответа агента; callback B работает во время ожидания A, valid answer resolves A. Run batch cancellation до и после dispatch-start и malformed result correction → PASS. Существующий AgentQueue readiness/fixed 200 ms batching не менять.

## Task 12: Инструменты агента и команды управления

**Files:** Modify `src/widgets/{api,contract,manager}.mjs`, `src/widgets/types.d.ts`, `src/controller.mjs`, `src/codex/threads.mjs`, `src/commands/{widget,widgets-format}.mjs`; Create `test/integration/react-widget-tools.test.mjs`; Update `docs/{widgets,agent-contract,commands,messaging,guest-mode,ephemeral,storage}.md`.

**Interfaces:** create_widget({handler,description,props?}); update_widget({widgetId,handler?,description?,props?}); set_widget_view({widgetId,component,props?,send?|target?|viewId?,force?}) с create vs update exclusive selectors; delete_widget/view; list_widgets quota `{limit,used,available}`; get_widget полного instance/store/views; update_widget_store({widgetId,state}); answer_widget_request. Исторический widget_event legacy hook не переносить автоматически: убрать из публичного реестра вместе с named-export callbacks; app control осуществляется store/mount и request responses, как в согласованном API.

- [ ] Failing tests tool schema rejects legacy initial state/callback actions, cross-owner IDs, mixed selectors; quota/status/component/props/message/error доступны без render/init; ephemeral function diagnostics = `[Function]`, cycles/resources ограничены безопасным formatter. named exported component обязателен на agent boundary.
- [ ] Run `node --test test/integration/react-widget-tools.test.mjs` → FAIL.
- [ ] Обновить dynamic tools, registry invocation и widget-specific instructions, не перезаписывая новое agent control/compaction main. set_widget_view update по viewId сохраняет адрес/ID и omitted props; переданные props полностью заменяют прежние. Нет expectedRevision, no stealth compare-and-swap. update_widget_store применяет replace к живому store, ждёт persistence, инициирует projections, не вызывает искусственные callbacks/events.
- [ ] Свести runtime statuses и CLI/help formatter, убрать описания render(state,view)/named actions/onInit/onSent из действующей wiki и model instructions. Сохранить исторические доказательства в docs/dev; новые rich/dice/ephemeral examples соответствуют реальному SDK. Direct scoped send/edit/delete также используют новый registration invalidation.
- [ ] Перевести active example/fixture tests на новый контракт. Удалить неиспользуемые legacy `src/widgets/context.mjs`, `src/widgets/queue.mjs`, `src/widgets/polls.mjs`, `src/widgets/native-stop.mjs` после замены всех imports; не убирать общий scoped Telegram API. Старые TSX в docs/dev оставлять только явно историческими, а не обещать их выполнение новым engine. Как минимум counter, Runtime WebSocket и dice hooks переписать в выполняемые новые примеры.
- [ ] Run новые tools tests, затронутые command/schema tests и `node docs/dev/check-wiki.mjs` → PASS; проверка docs не подменяет runtime tests. Старые legacy-specific tests заменить/архивировать явно, не заставлять их ложно проходить через compatibility shims.

## Task 13: Повторное использование модулей и ресурсы в sandbox

**Files:** Modify `src/widgets/{service,build-cache,host,sandbox}.mjs`; Create `test/integration/react-widget-isolation.test.mjs`, `test/manual/react-widget-memory.mjs`; обновить профильные sandbox tests.

**Interfaces:** service materializes trusted dependency set once per agent process; module registry caches build until last instance generation retires, live stores/roots never shared. Compiler snapshots remain immutable/read-scoped.

- [ ] Failing tests: один файл запускается дважды, A/B Context/store/socket не смешиваются; обновление A использует новый build, B продолжает прежний; recover A при работающем B не сбрасывает B; ошибка view A не затрагивает view B.
- [ ] Run `node --test test/integration/react-widget-isolation.test.mjs` → FAIL.
- [ ] Подключить runtime assets с одной React identity и все transitive external dependencies внутри sandbox-readable assets. Удаление cached build возможно только без живых instances, не по одному mtime. Revalidate paths/manifest prior build; существующие secrets/filesystem gates не ослаблять.
- [ ] Запустить bounded memory runner: пустой agent runtime, один counter, пять instances одного файла, двадцать views, до двадцати overlays, retire/delete. Записать RSS/runtime tree и эффекты cleanup; compiler child не остаётся в runtime. Проверить реальные Windows sandbox и Alpine smoke, если доступна Docker-среда.
- [ ] Run профильные sandbox/monitor tests → PASS. Если действующие 256 MiB не выдержаны, найти источник удержания/duplicate React/build child и пересмотреть реализацию; повышение квоты только отдельным решением пользователя.

## Task 14: Recovery без переигрывания и закрытие upgrade

**Files:** Modify `src/widgets/{manager,store,receipts,legacy-cleanup,service}.mjs`; Create `test/integration/react-widget-recovery.test.mjs`; Update `docs/dev/react-widgets-verification.md`.

**Interfaces:** restore loads persisted store version/ordinary export root/props/target only; effects restart, ephemeral cleanup адреса используются для delete/disable, а не восстановления private trees. Никакого replay RAM pending handlers/requests.

- [ ] Failing crash-point tests: pending callback/reply/reaction теряются, started handler не продолжается, сохранённый до await dispatch остаётся, несохранённый не появляется; useOnMessage пропущенного ack не воспроизводится. Ещё не принятые Telegram updates не удалять из poller.
- [ ] Run `node --test test/integration/react-widget-recovery.test.mjs` → FAIL.
- [ ] Связать bootstrap со store/module/root restore, новым generation и callback invalidation. Закрыть все ephemeral registrations; cleanup failure не допускает их прежние handlers. Restore прежнего dice не sends/rolls. Publication unknown остаётся diagnostic block до явного разрешения, без blind retry.
- [ ] Инъекция отказа до/после cleanup intent, store save, Telegram ack, receipt persist и binding commit; repaired local receipt не публикует старую projection поверх более новой. Runtime error/state migration failure сохраняет пригодные данные для исправления, не даёт default reset.
- [ ] Run recovery+upgrade+publications tests → PASS. Зафиксировать, что legacy больше не запускается ни в одном startup path, а многопользовательские inline routes main сохранились.

## Task 15: Чистая модель и сохраняемый store нового Wordle

**Files:** Create `examples/widgets/wordle/{model,selectors,dictionary-store}.mjs`, `examples/widgets/wordle/store.ts`, `examples/widgets/wordle/wordle-dictionary-{4,5,6,7,8}.txt`, `examples/widgets/wordle/wordle-dictionary-{4,5,6,7,8}-select.txt`, `test/helpers/react-wordle-fixture.mjs`, `test/integration/react-wordle-model.test.mjs`; исходный wordle.zip не менять.

**Interfaces:** `scoreGuess(guess,answer): ('absent'|'present'|'correct')[]`; `startPlayer({user,answerCandidate,now})`, `typeKey({userId,key,now})`, `submitGuess({userId,guess,valid,now})`, `finishRound({now})` — pure recipe factories; `selectRankedPlayers(state)` и `selectProgress(state,userId)` по спецификации. Time/random/dictionary validity поступают как уже вычисленные значения, не I/O внутри recipe; submit проверяет, что проверенный guess всё ещё равен текущему input и игрок/раунд активны.

- [ ] Написать tests для shared answer once, per-player answer, только selected pool при выборе/union broad+select при проверке, отсутствия fallback при пустом select, сохранения при resume/restart и правке словаря, корректного дублирования букв, Ё→Е, 4–8 букв/6 attempts, no lost input между двумя пользователями.
- [ ] Run `node --test test/integration/react-wordle-model.test.mjs` → FAIL. Тесты используют маленький явный словарь и фиксированные часы, без TG_WORDLE_ARCHIVE.
- [ ] Перенести правила/словарные assets из свежего ZIP в рабочую копию комплекта. Проверить SHA-256/entry paths/manifest всех 10 словарей; не запускать архивные скрипты при распаковке, не копировать credentials/temp/widget state. Сохранить актуальные titleSuffix/notify и blocked-user policy как конфигурацию, не зашивать реальные IDs в public fixtures. Переписать mutable timers/activeId на instance store/effects. defineStore один раз на entry module; config bootstrap из Runtime props до attach первых views, без случайности в render/скрытого reset.
- [ ] Реализовать timestamps: начало на первом принятом слове, invalid Enter не начинает/не тратит попытку; finish только won/lost; global finish незавершившему не создаёт ложный loss/duration. Sorting rank→attempts asc→duration asc→joinedAt/userId; никакого сравнения по числу зелёных/жёлтых клеток.
- [ ] При notify:true сохранить явное уведомление владельца о новом player won/lost из обработчика принятого Enter после persistence, с прежними смысловыми полями результата; не вычислять одноразовую отправку из каждого render/effect по сохранённому won. Restart не дублирует старое уведомление; общий framework по-прежнему не обещает exactly-once при аварии.
- [ ] Tests arbitrary callback after externally finished round, same player stale async input, equality/tied sorting, finishing before first word, duration zero, repeated finish, frozen config и history progress length 0–6 → PASS. Суточный таймер/самостоятельное завершение раунда не встраивать; rounds ротирует внешний агент/сценарий.

## Task 16: Players, GameInput, GameInputShared и GameShared

**Files:** Create `examples/widgets/wordle/{widget,Players,GameInput,GameInputShared,GameShared,Board,Keyboard}.tsx`, `examples/widgets/wordle/README.md`, `test/integration/react-wordle-views.test.mjs`, `test/integration/react-wordle-concurrency.test.mjs`; update example references.

**Interfaces:** widget.tsx экспортирует default Runtime и четыре именованных roots. Внутренние Board/Keyboard не обязаны экспортироваться из entry. Общие hooks/store принадлежат instance, player identity берётся из event.from/overlay receiver, lease — view.id. Runtime effects поддерживают cleanup round-finish без global current widget.

- [ ] Failing real-reconciler tests: двухпользовательские GameInput overlays вводят одновременно; Players изменяется после принятой попытки, launcher hash не меняется и overlays не закрываются. В общей игре публичный Players не содержит букв/ответа ни в text, ни в callbacks, ни после личного won/lost до конца раунда.
- [ ] Run `node --test test/integration/react-wordle-views.test.mjs test/integration/react-wordle-concurrency.test.mjs` → FAIL.
- [ ] Players: три столбца, все 0–6 принятых слов отдельными строками в progress cell, длительность только finished player, title/titleSuffix. Общий режим скрывает буквы во всех строках до внешнего finish; final показывает весь буквенный history и ответ. GameInput: public Start→event.overlay(<GameInput playerId=.../>); private name/board/keyboard/backspace/delete/enter, без Back. Для обычных ходов не править public launcher. Input/keyboard сохраняют fresh custom-emoji оформление; JSX LetterTile заменяет legacy raw RichText helper, финал деактивирует callbacks без потери emoji.
- [ ] GameInputShared: only individual mode, public active actor lease/viewId, owner checks на каждый key/Enter, Back и 60_000 мс idle. Таймер записывает/проверяет deadline, не продлевается чужими нажатиями/фоновым рендером; после restart expired lease освобождается до нового key. GameShared = Players + GameInputShared с общей outer view ID. Оба roots отклоняют shared-word config до публикации.
- [ ] Round finish: все Buttons disabled, закрыть overlays всех root views, остановить/сбросить shared lease, сохранить итоговые сообщения/store; поздний callback и delayed overlay ack не открывают игру заново. Не delete_widget как старый finish. Тест restart finished round и продолжающегося individual lease → PASS.
- [ ] Integration assertions: GameInput reply target равен подтверждённому Players messageId в том же topic; failure первой отправки не создаёт reply в другой чат; второй participant inline ID вызывает свою player model без перепривязки общего view → PASS.

## Task 17: Nerdle на том же React-приложении

**Files:** Create `examples/widgets/wordle/{nerdle.tsx,game-application.tsx,game-config.mjs,nerdle-math.mjs,classic_equations.txt,classic_equations.source.json}`, `test/integration/react-nerdle-model.test.mjs`, `test/integration/react-nerdle-views.test.mjs`; Modify `examples/widgets/wordle/widget.tsx`, общий model/store/components и `test/helpers/react-wordle-fixture.mjs`.

**Interfaces:** `createGameApplication(gameConfig)` возвращает Runtime и экспортируемые Players/GameInput/GameInputShared/GameShared для конкретного entrypoint; defineStore вызывается один раз в самом entry module с общим initializer, не лениво внутри React component. Wordle/Nerdle одного агента остаются разными widgetId/roots/stores, несмотря на общий код.

- [ ] Перенести математические assertions свежего ZIP: нормализация ×/÷/−, приоритет операций, отрицательные числа/правые части, ведущие нули, --, один =, деление на ноль, дробные промежуточные значения и точное равенство без float/eval. Assert Enter invalid не тратит попытку; JSON store никогда не содержит BigInt.
- [ ] Run `node --test test/integration/react-nerdle-model.test.mjs test/integration/react-nerdle-views.test.mjs` → FAIL.
- [ ] Перенести nerdle-math без изменения арифметической семантики и оба equation assets с проверкой manifest; adapter фиксирует length 8, свой набор клавиш и уведомления. appendEquationKey после = дописывает только допустимый целый результат, укладывающийся в длину. Фактический ответ выбирается один раз из валидного equation pool, не при каждом render.
- [ ] Вынести общий React layout из Wordle без копии legacy shared.mjs. У обоих entrypoints named exports компонентов разрешаются module registry независимо, common/individual mode и shared fallback подчиняются общим правилам. Сохранить titleSuffix/notify, не переносить частную Wordle-only blocked policy на Nerdle.
- [ ] Tests одновременно открытых Wordle+Nerdle, параллельных Nerdle overlays, тайм-аута shared input, all-attempt progress/сортировки/внешнего finish и restart с прежним ответом → PASS. Ошибка Nerdle view не ломает Wordle; общие компоненты не создают глобальную activeId.

## Task 18: React-редактор broad/select базы

**Files:** Create `examples/widgets/wordle/{dictionary-admin.tsx,DictionaryEditor.tsx,dictionary-editor-model.mjs}`, `examples/widgets/wordle/DICTIONARY-ADMIN.md`, `test/integration/react-dictionary-editor.test.mjs`, `test/integration/react-dictionary-files.test.mjs`; Modify `examples/widgets/wordle/dictionary-store.mjs`, `test/helpers/react-wordle-fixture.mjs`.

**Interfaces:** `createDictionaryRepository({base,auditChatId,clock})` предоставляет words/selectionWords/has/find/isUsed/edit и изменение версии file snapshot; effect/resource принадлежит Runtime экземпляра, а immutable file cache может переиспользоваться по canonical path+signature. Editor entry регистрирует store `{mode,pages,input,notice,auditChatId}`; mutations берут actor из ButtonEvent.from, не из authored string.

- [ ] Failing assertions исходного функционала: 20 entries/page, ±1/±20/clamp, letter modes, поиск '* = ровно одна буква' с шаблонами К*Т/К**Т/*****, пустой поиск, 0–8 ввода, Ё→Е, Add в оба файла и Use enabled, disable оставляет допустимость guess, remove из обоих, plain text в списке при сохранённом оформлении поля/клавиатуры.
- [ ] Run `node --test test/integration/react-dictionary-editor.test.mjs test/integration/react-dictionary-files.test.mjs` → FAIL; temp-копия small broad/select, без правки пользовательского ZIP или рабочих словарей.
- [ ] Перевести UI на React hooks/store/closures без ctx.state/ctx.message/render exports. Callback содержит сохранённое слово/желаемое состояние Use и повторно проверяет актуальные listing/input; stale closure после смены страницы/поиска отклоняется. Повторный Use(target=true) не делает обратное действие. Кнопки для всех валидных Telegram users, audit с фактическим actor; отсутствие actor не меняет файлы.
- [ ] Сохранить repository файловую семантику: union broad/select для чтения/guess, только select для будущего ответа, все пять select-файлов обязательны, общий interprocess lock, tmp/rename/rollback и requested/committed/rolled_back audit. BigInt stat identity/mtimeNs не округлять; две editor instances/два процесса корректно перечитывают изменения. Ошибка до commit не пишет «добавлено»; ошибка после неизвестного исхода пишет диагностику, а не инвертирует повторный Use.
- [ ] Audit chat берётся из защищённого publisher config/обычного известного адреса; inline publication требует явный auditChatId. Отсутствие адреса/права на audit отклоняет mutation до изменения файлов. Fresh application admin/owner publication policy документируется для owner agent и проверяется installer/live runner; callback permissions остаются открытыми, role lookup на каждый клик не добавлять.
- [ ] Run tests lock busy, partial second-file rename failure/rollback, audit failure, direct external edit, same-size/close-time file identity, unchanged active answer after pool edits, новый выбор только из изменённого select, Editor restart/input/pages restore и duplicate-click desired state → PASS. Новый store не восстанавливает выключенные Use из исходной поставки.

## Task 19: Регрессия, комплект миграции и ограниченная live-приёмка

**Files:** Create `test/manual/react-wordle-acceptance.mjs`, `test/manual/install-react-wordle.mjs`, `test/manual/package-react-wordle.mjs`, `docs/dev/react-wordle-verification.md`; Modify `docs/dev/react-widgets-verification.md`, `docs/dev/index.md`, реализованные wiki и затронутые integration fixtures.

**Interfaces:** installer принимает явные source/destination/backup path, проверяет границы owner workspace и не перезаписывает исходник без backup. Live runner принимает designated bot config/participants/group, shared lock, срок <=30 минут и stop command, сохраняет offset и удаляет/отключает только свои публикации. Все результаты разделены на automated/native API/client acceptance/not tested.

- [ ] Полная offline-проверка: `npm test`, `node docs/dev/check-wiki.mjs`, `git diff --check` → 0 failures; не включать реальные TG_* credentials. Сравнить skip список с baseline: отсутствие архива/среды не считается прохождением; новые React/Wordle core tests не должны быть skipped.
- [ ] Windows + Alpine sandbox smoke: compile/restore/read dependency, два instances, memory/teardown, данные БД и native address invariants. Если среда недоступна, записать конкретный непроверенный пункт, не отмечать PASS. Сохранить текущие media file:, queue batching, agent control/compaction и inline participant regression tests main.
- [ ] В обозначенной пользователем обычной группе publish Players, затем GameInput reply; два участника одновременно вводят в shared-word режиме. Убедиться, что таблица обновляется без закрытия клавиатур, буквы общего слова не видны публично. Записать подтверждение пользователей, не считать поддельные actors полной live-приёмкой.
- [ ] Проверить individual mode, историю всех 0–6 слов, итоговую таблицу/sort/duration, внешний finish и restart: overlays закрылись, данные остались, ходы больше не принимаются. Затем отдельный inline/guest GameShared с двумя участниками, Back и expiry 60 секунд, выбор публикации после restart, без MTProto/новых quick scripts. Повторить основной ввод/проверку/завершение для Nerdle. По предпочтению пользователя достаточно одного реального клиента, Android/iOS не требуются автоматически.
- [ ] Проверить React Editor: modes/search/page/Use/Add/Remove из fixture-копии базы, обычный участник может нажимать, публикация требует admin/owner, audit соответствует реальным действиям. Новая игра выбирает только текущий select, действующий ответ не меняется, редактор после restart сохраняет input/pages. Рабочие словари пользователя не использовать для destructive live-проверки.
- [ ] Сформировать новый ZIP из мигрированной рабочей копии: три активных React entrypoints, все dependencies/assets и компактные AGENTS/DICTIONARY-ADMIN instructions. Manifest фиксирует SHA-256 исходного архива/каждого выходного файла, build/SDK versions и что dictionary assets не изменены. Исторические варианты пометить неактивными и исключить из runtime entrypoints; архив пользователя не перезаписывать. Проверить свежую установку из результата без локальных ignored paths/зависимости от старого tar.gz.
- [ ] Остановить runner/модельные прогоны, подтвердить shared lock released и cleanup; архивировать исключения/API ошибки без токенов/чужих сообщений. Выдать обзор diff, фактические проверки, ограничения. Commit/merge/push main — только после явного разрешения пользователя.

Для новых артефактов runtime/examples включить self-contained tests с fixture dictionary/equations; `TG_WORDLE_ARCHIVE` не нужен для core suite. Путь к предоставленному ZIP передаётся при проверке настоящего комплекта явно, не зашивается в исходники. Пакетирование обязано включить raw data `russian-mnemonic-words.txt`, все custom-emoji helpers/assets и исторические source variants там, где они остаются частью пользовательского архива; только три назначенных entrypoints активны.

## Покрытие спецификации и самопроверка плана

| Требование | Задачи |
| --- | --- |
| Настоящий React, shared code/singleton React, instance Context/resources | 1, 3, 4, 5, 10, 13 |
| Bare defineStore, migrations, JSON, selectors, full external replace | 2–4, 12, 14 |
| Rich/sticker/dice, пустой rich, keyboard merge, useDice/useOnMessage | 5–8 |
| Обычные/inline/guest/ephemeral адреса, participants canonical ID | 7–9, 12, 16–19 |
| Overlay identity/TTL/parent-edit/restart, live props exceptions | 5, 7, 9, 14 |
| Nonblocking await, generation fences, error/retry/status/notify | 7–11, 14 |
| Agent request data/schema/cancel/queue removal | 11–12 |
| Full legacy deletion без source/state migration, unknown receipts | 2, 10, 14, 19 |
| Все owner tools/quota/view metadata/store editing | 1, 12 |
| Wordle common/individual answers, parallel input, все 0–6 слов, Players privacy/time/sort | 15–16, 19 |
| GameInput reply+overlays, shared inline fallback+timeout, внешний finish+disable | 9, 15–17, 19 |
| Nerdle exact arithmetic/normalization/auto-result/equation assets + React | 17, 19 |
| React Editor, broad/select, single-letter wildcard, open buttons/admin publication, audit | 18–19 |
| Новый ZIP: три entrypoints, свежие словари/metadata, source/output manifests | 15, 17–19 |
| Deferred !widget/!exec scripts | Явно исключены; не являются зависимостью |

Перед передачей плана проверить одинаковые имена методов/полей и ownership target across задач, отсутствие legacy onSent/useMessage/tg-message в новом контракте, реальные исходники текущего main, SHA-256 свежего ZIP и покрытие всех трёх entrypoints. Уточнения пользователя о внешнем finish и всей истории попыток уже включены. Следующий шаг после обсуждения плана — отдельное выполнение этапов, не автоматическое применение БД или запуск live-сервиса.

## Первичные технические источники

- [React useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore), [custom reconciler](https://github.com/facebook/react/tree/main/packages/react-reconciler).
- [Immer produce](https://immerjs.github.io/immer/produce/), [Ajv / JSON Schema dialects](https://ajv.js.org/json-schema.html).
- [Telegram rich HTML](https://core.telegram.org/bots/api#rich-html-style), [ephemeral parameters](https://core.telegram.org/bots/api#ephemeralmessageparameters), [inline query](https://core.telegram.org/bots/api#inlinequery).
- Точные пакеты проверять по `https://registry.npmjs.org/<name>/<version>` и lockfile, а не выводить совместимость reconciler из одного совпадения major React.
