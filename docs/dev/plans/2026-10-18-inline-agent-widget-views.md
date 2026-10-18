# Inline agent and widget views — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вызов личного агента через inline-барабан, публикация подготовленных результатов и подключение нескольких сообщений к одному виджету с сохранением текущего Wordle.

**Architecture:** Контроллер хранит временные inline-запросы только в памяти; SQLite хранит выданные кнопки, принятые нажатия, известные inline-сообщения и widget view. Существующий sandbox runtime сохраняет общее состояние, последовательную очередь и таймеры каждого виджета, но рендерит его отдельно для каждого view. Калибровка проходит сначала на небольшом стенде с подставным агентом, затем повторяется на полном тракте с настоящим агентом.

**Tech Stack:** Node.js >=24.18.1, ES modules, node:sqlite, node:test, существующие Codex App Server/OS sandbox, Telegram Bot API, esbuild, Windows и Alpine Linux. Новые runtime-зависимости не требуются.

**Spec:** [Утверждённый дизайн](../inline-agent-concept.md), разделы 1–58. При переносе в рабочий worktree сохранить дизайн как `docs/dev/inline-agent-concept.md` и заменить эту ссылку на `../inline-agent-concept.md`.

**Status:** Main implementation and migrations are in the isolated `feat/inline-agent-views` worktree. Final complete suites:Windows584 tests (576 pass,8 skip), Alpine native584/584 pass. Real unchanged Wordle old→new/shared-state, native inline→widget/image, background/restart/cancellation and agent fallback checks passed. Requested visibility and selection/playback/opening checks for all19 native variants plus rich passed on Desktop/Android, as detailed in [media acceptance](../inline-media-matrix-verification.md). The user confirmed the actual-avatar header and later mixed photos on both clients. Controller priority is child-avatar/master-avatar/plain, with per-child five-minute cache. The user retained6,6,20,20… and2s/5s timing and explicitly waived another size calibration after the avatar change. Ordinary via_bot live control passed:actual agent event preserves user sender and carries viaBot; ordinary edit is rejected and deletion succeeds. The requested unknown-inline reply/reaction observation completed:button callback arrived; no group Message/reply/reaction updates arrived in the bounded nonmember scenario. This is an observed limitation, not a guarantee across every bot role or mode. iOS and actual multiple-agent/participant shared-chat checks are excluded by user decision. Final RF1–RF5 self-review and report reconciliation are complete; no subagents were used. The user subsequently authorized committing and publishing to main; the complete pre-commit Windows suite and wiki checks passed again. Production deployment remains outside this task. Current evidence: [verification](../inline-widget-verification.md).

## Итоговая сверка

Задачи0–15 завершены в согласованном объёме; окончательная сверка и gate-результаты находятся в [итоговом отчёте](../inline-agent-widget-views-completion.md). Исходные пошаговые рецепты ниже сохранены как история, включая заменённые пользователем калибровочные предположения. Результаты не определяются оставшимися нетронутыми чекбоксами первоначального рецепта; актуален итоговый отчёт с явными исключениями и доказательствами.

## Global Constraints

- Вся реализация — в отдельной ветке/worktree; другие checkout и их локальные изменения сохраняются.
- Исследованная база — локальный `origin/main`, `8468767`; в нём схема 14 и исправления после `02456eb`. Основной checkout на `main/14a50f7` не годится как база реализации. При начале работы проверить изменение удалённого main и зафиксировать фактический SHA базы.
- `AGENTS.md` актуального кода требует планы/обсуждения в `docs/dev/`, wiki и controller-owned тексты на английском. Поэтому этот план находится в `docs/dev/plans/`, а не в каталоге по умолчанию навыка. Содержание агента и пользовательские имена не переводить автоматически.
- Работа с настоящими данными — только в выделенном тестовом окружении. Рабочую production-БД не мигрировать для эксперимента; под одним bot token не запускать одновременно два poller.
- Обычные механики widget sandbox, лимиты памяти/очередей/состояния и отсутствие короткого callback ACK-таймера сохраняются. `teardownMs=5000`, `heartbeatMs=5000`, `silenceMs=10000`, `sampleMs=500`.
- Один widget: общее JSON state, одна очередь, общие таймеры, 0..N view. Ноль view не останавливает таймеры. `render(state, view)`, где view — отдельный рекурсивно замороженный снимок `{id,target,props}`.
- Один Telegram-адрес принадлежит максимум одному view в пределах botId. Чужой владелец получает `view_conflict` с `ownerAgentId`, `widgetId`, `viewId` существующей привязки.
- Статусы widget: `active|stopped`. Публичных `stop_widget`, `resume_widget`, `render_widget` нет; восстановление выполняет `update_widget`, добровольное завершение — `delete_widget`.
- Исходник Wordle и игровые зависимости из пользовательского архива не менять. Совместимость доказывается настоящим сообщением старой версии и последующим управлением новой версией, а не только SQL-фикстурой.
- Один текущий inline request на `{botId,userId}`. Новый начальный запрос создаёт новую версию даже при прежнем тексте. Контроллер не прерывает уже начатый model turn.
- Один общий час: `expiresAt=createdAt+3600000`. Текст запроса и готовые ответы только в RAM, без восстановления/кеша по тексту. Результаты готовы только после успешного `set_inline_results`.
- Начальные значения калибровки: trigger 2000 мс; ожидание страницы после запуска до 5000 мс с ранним пробуждением. `cache_time:0`; предела числа страниц барабана нет. В ожидании возвращается один служебный результат.
- Нейтральное сообщение — `✖️` без кнопок. Пустой список результатов завершает работу служебным пунктом. Возврат из ЛС пользователь делает новым inline-запросом.
- Ошибка `answerInlineQuery` или записи кнопок прекращает обслуживание только соответствующей версии. Зарегистрированные до ошибки отправки кнопки не удаляются.
- Кнопки регистрируются перед фактической выдачей страницы, не в `set_inline_results`. Группа `{botId,tipId,group}` одноразова глобально для всех копий заготовки; без group действие повторяемо.
- Закрытие группы и сохранение нажатия атомарны. Граница доставки — приём очередью агента; подтверждение runtime не требуется, после приёма повторной доставки нет.
- Кнопки: 30 дней от первой регистрации; inline-снимки: 30 дней от последней подтверждённой правки. Очистка истории не удаляет действующие view/их рабочие проекции и не открывает группы.
- Прямые uploads, attach:// и локальные пути в inline-результатах запрещены. Файл отправляет сам агент в указанный буфер; по умолчанию — ЛС автора без звука. `file_id` требует доступного `file_sources`; автоматической очистки буферных сообщений нет.
- Все обычные нативные inline-результаты и допустимые внешние URL поддерживаются; Telegram Games, invoice и платёжные кнопки исключены.
- По `chatId/messageId` запрещены агентские правки любых сообщений с `via_bot`, включая permits-only и подключение нового view; обычное разрешённое удаление сохраняется. Внутренний рендер уже зарегистрированных view не блокируется.
- Коммиты — только при отдельном разрешении пользователя; push/merge/deploy в этот план исполнения не входят. До разрешения завершать этапы проверенным diff, без создания обязательной остановки после каждого этапа.

## Review Focus

1. **RF1 — неопределённая доставка:** потеря ответа Telegram после успешной операции или ошибка БД после эффекта не вызывают повторную отправку/смену владельца. Проверки: задачи 4, 9, 13.
2. **RF2 — смена view во время работы:** нажатия, replies, реакции и polls имеют разные правила актуальности; failed replacement не возвращает уже отсечённые кнопки. Проверки: задача 5.
3. **RF3 — истёкшее содержимое и чужой токен:** отсутствие inline-снимка не делает адрес свободным при действующей привязке/владении; старый btnId не перехватывает widget route. Проверки: задачи 9, 11, 12.
4. **RF4 — переход между версиями:** прежние IDs, callback-данные, snapshots, pending active events и Wordle-таймер сохраняют смысл; disabled backlog не воспроизводится. Проверки: задачи 3 и 8.
5. **RF5 — очередь и поздняя работа:** новый запрос/отключение агента и crash между SQLite и RAM не запускают отменённый inline job и не повторяют уже принятое нажатие. Проверки: задачи 1, 11, 13.

## База, worktree и файлы

Создавать worktree на этапе исполнения, после проверки плана. Предпочтительный путь: `.worktrees/inline-agent-views`, ветка `feat/inline-agent-views`. На момент подготовки плана нативного инструмента worktree среди доступных инструментов нет; применим `git worktree add`. Не продолжать feature-ветку `feat/sticker-custom-emoji` и не копировать её незакоммиченные изменения.

Новые модули и ответственность:

| Файл | Ответственность |
| --- | --- |
| `src/inline/requests.mjs` | Версии запросов, курсоры, сроки, ready buffer, отмена и подписки в RAM |
| `src/inline/service.mjs` | Протокол страниц, запуск агента, один ответ на query ID, регистрация перед выдачей |
| `src/inline/contract.mjs` | Политика барабана, schema инструмента, ошибки и проверка внешних аргументов |
| `src/inline/results.mjs` | Friendly/native результаты, поля медиа, нейтральный результат, native validation |
| `src/inline/buttons.mjs` | Action-кнопки, key/group, применение прежнего permits и opaque btnId |
| `src/inline/store.mjs` | SQLite-реестр кнопок, групп, принятых событий, снимков и владения |
| `src/inline/events.mjs` | Inline callback после проверки widget route, приём/передача нажатий |
| `src/inline/messages.mjs` | Подтверждённые inline edits, partial read и deliveryUnknown |
| `src/widgets/views.mjs` | Адреса/props, поиск view, фиксация attach/replace/detach и конфликт владельца |
| `src/widgets/errors.mjs` | Классификация ошибок, lastError latch и аварийные уведомления |
| `src/widgets/migrate.mjs` | Транзакционное преобразование legacy widget rows/events до старта runtime |
| `src/messages/address.mjs` | Строгий выбор ordinary/inline адреса, без `kind` и без угадывания чата |
| `test/helpers/inline-fixture.mjs` | Fake clock/Telegram/agent и fault injection для настоящего inline service |
| `test/helpers/widget-views-fixture.mjs` | Изолированные db/manager/host fixtures для гонок view |
| `test/manual/inline-calibration.mjs` | Опт-ин стенд реального Telegram, подставной агент и контролируемые задержки |
| `test/manual/wordle-migration-acceptance.mjs` | Два запуска старого/нового приложения над одним изолированным хранилищем |
| `test/manual/inline-agent-acceptance.mjs` | Настоящий агент, медиа, карточка запуска и второй view |

Существующие точки изменения: `src/storage/database.mjs`, migrations, retention; `src/widgets/{store,manager,runtime,render,events,context,service,api,contract,polls}.mjs`, `src/widgets/types.d.ts`; `src/agents/{queue,history,lifecycle}.mjs`; `src/controller.mjs`; `src/telegram/{polling,short-message}.mjs`; `src/codex/threads.mjs`; `src/commands/{widget,widgets-format,help,contract}.mjs`; `src/config.mjs`.

Обновляемые wiki: `docs/{index,architecture,widgets,agent-contract,message-events,messaging,storage,commands,agents,operations,security}.md`. Добавить тематическую `docs/inline.md`. Дизайн, план, инструкции экспериментов и отчёты находятся в `docs/dev/`.

## Внутренние интерфейсы и технические решения

Это предлагаемые в плане имена; реализовать и использовать их согласованно, не выдавать за уже существующие функции.

```js
// src/inline/contract.mjs — исходные числа, изменяемые только по замерам
export const INLINE_POLICY = Object.freeze({
  triggerMs: 2000, waitMs: 5000, requestTtlMs: 3600000,
  promptRows: 8, pageSize: 50
});
// promptRows=8 — только стартовая настройка стенда, не результат калибровки.
```

`loadConfig` принимает необязательный `inline` с `triggerMs`, `waitMs`, `promptRows`; merge с defaults, значения finite integer, trigger/wait >=0, promptRows — число 1..50 или непустая шкала таких чисел (повтор последнего; default [6,6,20]). Общий час и Telegram pageSize — константы контракта, не экспериментальные безразмерные лимиты. Изменения таймеров применяются к новым версиям запроса; версия сохраняет свой снимок policy.

```js
// src/inline/requests.mjs
// createInlineRequests({now:Date.now,policy:INLINE_POLICY}) -> requests
// begin({botId,userId,agentId,query,chatType?}) -> Request
// current(botId,userId) -> Request|null
// issueCursor(requestId) -> string; issuedAt фиксируется перед answer
// resolveCursor({botId,userId,cursor}) -> Request|null
// setReady({botId,agentId},requestId,prepared) -> {status:'accepted'|'already_set'}
// close(requestId,reason) -> void; closeOwner(botId,agentId,reason) -> void
// Request: {requestId,botId,userId,agentId,query,chatType?,createdAt,expiresAt,
//           phase:'prompt'|'waiting'|'ready'|'delivered'|'closed',policy}

// src/inline/service.mjs
createInlineService({requests,clock,resolveActor,enqueue,cancelPending,
  normalizeResults,registerPage,answer,observe})
// receive(botId,inlineQuery) -> void: запускает tracked async page work
// setResults(scope,{requestId,results}) -> {status:'accepted'|'already_set'}
// disableOwner(botId,agentId,reason), close(), idle() -> Promise<void>
// resolveActor(botId,userId) -> {botId,userId,agentId,chatId:userId}|null
// enqueue(scope,event,admit) -> 'accepted'|'full'
// registerPage(scope,preparedPage) -> nativeResults, одна SQLite transaction
// clock: {now,setTimeout,clearTimeout}; observe: только sanitized metadata
```

`setResults` проверяет доступ и актуальность, возвращает `already_set` до повторной обработки payload, валидирует весь первый массив и только затем атомарно ставит ready. Каждый query ID получает один выбранный ответ. Для дубликатов query ID держать маленькую служебную запись, не кеш полной страницы. Курсор — случайный короткий токен <=64 bytes с серверной привязкой bot/user/version/issuedAt; клиентское время не используется.

Публичное расширение results не ломает прежние примеры:

```js
// Friendly: прежняя форма и send-shaped message
const friendly={title:'Wordle', description:'Start a shared game', message:{text:'Wordle', buttons:[
  [{text:'Start', key:'start', group:'start', action:'Activate Wordle on this message'}]
]}};
// Native: полный типизированный результат; id задаст контроллер
const native={native:{type:'photo',photo_file_id:'KNOWN_ID',title:'Photo'},
 file_sources:[{chatId:1,messageId:7,fileId:'KNOWN_ID'}]};
```

Второй вариант — взаимоисключающий с friendly title/description/message на внешнем уровне. Нативные `reply_markup`/rich buttons могут содержать согласованные action/key/group до нормализации; клиентский callback_data для произвольной agent action не принимается. Внешний `permits` относится к action-кнопкам native-результата. Контроллер извлекает определения, генерирует opaque IDs, убирает служебные поля перед Telegram. `native.id`, uploads/local references, game/invoice/pay и противоречащие комбинации отклоняются. Native InputMessageContent остаётся отличным от preview; заданный native payload не подменяется крестиком.

Widget manager получает `create`, `update`, `setView`, `deleteView`, `delete`, `list`, `get`, `event`. Renderer: `publish(widgetRef,view,value)` и `disable(widgetRef,view)`; единица кеша/блокировки — viewId, не widgetId. Store предоставляет `getView`, `listViews`, `byTarget`, `createView`, `replaceView`, `detachView`; generation widget и identity view проверяются независимо.

### SQLite 15 и 16

- `015.sql` + `widgets/migrate.mjs`: нормализованные widgets (`active|stopped`, widget.lastError), `widget_views` (target, props, confirmed render/message/hash/buttons, view.lastError, deliveryUnknown), `widget_publication_candidates` и перенос существующих зависимых widget tables.
- `widget_views`: target ровно одного типа; UNIQUE partial index `(botId,chatId,messageId)` и UNIQUE partial index `(botId,inlineMessageId)`. viewId не меняется при обычном рендере; меняется при успешной замене view.
- Нельзя просто удалить legacy widgets с включённым FK cascade: будут потеряны pending events. Создать новые parent/child tables, скопировать и проверить данные, удалить старые child tables перед parent, переименовать новые в исходные имена в общей transaction. Не выключать foreign_keys внутри уже начатой transaction.
- `016.sql`: `inline_buttons`, `inline_closed_groups`, `inline_button_events`, `inline_messages`, `inline_owners`. Ключи включают botId; btnId/eventId уникальны и непредсказуемы. Отсутствие group — NULL, а не общая пустая группа.
- `inline_button_events`: pending/queued, JSON envelope, timestamps; pending не очищается как отработанная история. Состояние queued означает приём очередью, а не обработку моделью.
- `inline_messages`: confirmed JSON, partial, confirmedAt/expiresAt, deliveryUnknown. `inline_owners` независимо от содержимого; обязательные ссылки на view/действующие определения не истекают вместе со снимком.
- Истечение проверяется при доступе/нажатии, а физическая очистка выполняется общим retention. Открытый request и его query/ready buffer в SQLite не попадают.

## Task 0: Подготовить изоляцию и исходную точку

**Files:** существующие `AGENTS.md`, package files; импорт плана/дизайна в `docs/dev/`. Runtime-файлы пока не менять.

**Interfaces:** вход — принятые план/дизайн; выход — новый worktree, зафиксированный base SHA и отчёт baseline.

- [ ] Проверить `git worktree list`, `git status --short`, git-dir/common-dir и актуальную удалённую ветку. Если main сдвинулся, прочитать изменения нужных модулей и номер последней миграции; не перетирать чужие ветки.
- [ ] Создать ветку от проверенного origin/main. Проверить ignore для `.worktrees/inline-agent-views`; если отсутствует, добавить `.worktrees/` в общий `.git/info/exclude`, не коммитить чужой `.gitignore`.

```powershell
git fetch origin main
git rev-parse origin/main
git check-ignore --quiet .worktrees/inline-agent-views
if ($LASTEXITCODE -ne 0) {
  $excludePath = git rev-parse --git-path info/exclude
  Add-Content -LiteralPath $excludePath -Value @('', '/.worktrees/')
}
git check-ignore .worktrees/inline-agent-views
git worktree add .worktrees/inline-agent-views -b feat/inline-agent-views origin/main
```

- [ ] Скопировать только этот план и утверждённый дизайн; для дизайна использовать `docs/dev/inline-agent-concept.md`. Проверить хеш копии, исправить Spec link плана. Остальные untracked файлы исходного checkout не переносить.
- [ ] В новом worktree прочитать `AGENTS.md`, `docs/index.md` и указанные в задачах wiki. Проверить `node --version` на соответствие engines. Сохранить результат `git rev-parse HEAD` в игнорируемом `.runtime-check/base-revision.txt` для последующего old app запуска. Выполнить `npm ci`, `npm test`, `node docs/dev/check-wiki.mjs`; записать пропуски native-reader tests и исходные ошибки отдельно от новых.
- [ ] Создать `docs/dev/inline-widget-verification.md` с base SHA, node/platform, таблицей этапов и пустыми статусами «не выполнено». При падении baseline воспроизвести причину; изменение продуктового объёма или внешняя недоступность обсуждаются с пользователем, существующие ошибки не выдаются за новую регрессию.

**Checkpoint:** новый worktree изолирован; никаких production-сервисов/БД пока не запускали.

## Task 1: Версии inline-запросов и протокол страниц под fake clock

**Files:** Create `src/inline/{contract,requests,service}.mjs`, `test/helpers/inline-fixture.mjs`, `test/integration/{inline-requests,inline-service,inline-config}.test.mjs`; Modify `src/config.mjs`.

**Interfaces:** реализовать контракты выше. Fixture `inlineFixture(t,policy?)` предоставляет service, requests, scope, clock.advance(ms), query({query,offset?,id?}), answers[], queued[], failAnswer(error). query вызывает настоящий service.receive; advance исполняет только управляемые таймеры. Telegram и модель подставные.

- [ ] Написать RED на новую версию того же текста, один общий час, late result, ранний ready, повтор/чужой cursor, гонку timer/ready и ошибку answer.

```js
test('same text starts a new request and rejects old results', () => {
  let now=0;
  const r=createInlineRequests({now:()=>now});
  const old=r.begin({botId:'b',userId:1,agentId:'a',query:'wordle'});
  now=1;
  const next=r.begin({botId:'b',userId:1,agentId:'a',query:'wordle'});
  assert.notEqual(next.requestId,old.requestId);
  assert.throws(()=>r.setReady({botId:'b',agentId:'a'},old.requestId,[]),
    {code:'request_unavailable'});
  assert.equal(next.expiresAt,next.createdAt+3600000);
});
```

- [ ] Run `node --test test/integration/inline-requests.test.mjs test/integration/inline-service.test.mjs`; подтвердить падение по отсутствию нового поведения.
- [ ] Реализовать RAM state machine и facade; нормализация/БД/очередь пока injected adapters. При issued cursor записывать время непосредственно перед answer; быстрый scroll выдаёт новую prompt page; подходящая пауза вызывает enqueue ровно один раз. Waiting page просыпается по ready/cancel/expire и освобождает таймеры.
- [ ] Для RF5 проверить новый initial после выбора queued item и до dispatch; старый admit=false. Добавить прекращение только failed requestId, а не текущего пользователя, и отдельный тест ошибки ответа старой страницы при уже начавшейся новой версии.
- [ ] Run эти тесты и `node --test test/integration/inline-config.test.mjs`; проверить `git diff --check`. Нет автопубликации при одном лишь истечении времени, нет callback ACK timer, нет полной страницы в durable storage.

## Task 2: Ранняя живая калибровка и смешанная выдача

**Files:** Create `test/manual/inline-calibration.mjs`, `test/manual/inline-fixtures.mjs`, `test/integration/inline-calibration.test.mjs`, `docs/dev/inline-calibration.md`, `docs/dev/inline-calibration-results.md`; Modify `src/inline/contract.mjs` только после результатов.

**Interfaces:** стенд использует настоящий service задачи 1 с synthetic enqueue/ready; режимы `prompt`, `waiting`, `mixed`, `production-check`. CLI: `node test/manual/inline-calibration.mjs --config PRIVATE_JSON --case CASE --trigger-ms N --wait-ms N --rows N --duration-seconds 600`. Экспорт `runCalibration({argv,telegramFactory,signal})` позволяет unit-test без сети. Config задаёт выделенные bot/user/chat IDs, путь секретов и пути тестовых media fixtures; токен/история в отчёт не попадают. Без config стенд не делает сетевых вызовов.

- [ ] Написать unit test, что CLI без config не стартует poller; чужой user/update отклоняется, TTL/duration завершают стенд, telemetry не содержит query/answers/token. Run `node --test test/integration/inline-calibration.test.mjs` (RED).

```js
test('calibration cannot start Telegram without an explicit private config', async () => {
  let connections=0;
  await assert.rejects(runCalibration({argv:[],
    telegramFactory:()=>{ connections++; throw new Error('must not connect'); }}),/config/i);
  assert.equal(connections,0);
});
```
- [ ] Реализовать опт-ин runner: проверка bot identity и единственного poller, нейтральные тестовые ответы, ограниченная длительность, cleanup созданных обычных сообщений. Inline-публикации не обещать удалить по одному inline ID; их удаляет тестирующий пользователь либо контроллер по реально известному ordinary адресу с правами.
- [ ] Выполнить матрицу ниже во время реализации. Нужны ручные действия на клиентах; доступность Desktop/Android/iOS уточняется у пользователя. Недоступный клиент отметить «не проверен», не подменять эмуляцией или результатом другого клиента.
- [ ] Выбрать числа по сохранённым замерам; если данные не обосновывают уменьшение, сохранить 2000/5000. promptRows выбрать по реально проверенным клиентам. Изменение правила «одна waiting row» или отказ от смешанных типов при выявленной проблеме вынести пользователю, не вводить обход молча.
- [ ] Снова запустить unit tests; заполнить отчёт конкретными параметрами, версиями клиентов, количеством попыток, ошибками Telegram и ограничениями. Этот этап не доказывает работу настоящего агента или миграции.

### Матрица и критерии живого эксперимента

| Проверка | Процедура | Что записать |
| --- | --- | --- |
| Число prompt rows | 1,2,4,8,12,20,32,50; сначала до первого устойчивого результата, затем 3 повтора вокруг границы | Автозапрос следующей страницы без касания, высота окна/масштаб, необходимость ручного scroll |
| Trigger | Собрать минимум 10 автоматических интервалов на 1-row/другом реально автозагружаемом варианте и 10 намеренных scroll на выбранном размере для каждого доступного клиента; сравнить пороги 250,500,750,1000,1500,2000 мс по этим данным | receivedAt − cursor.issuedAt, отсутствие авто-запроса на выбранном размере, ложные/пропущенные старты; false positive допустимы по дизайну |
| Waiting | Начать с 5000 мс; ready через 800 мс, ready после дедлайна, отсутствие ready, закрытие окна, новая query | Принял ли Telegram ответ, реальное время ответа, раннее пробуждение, прекращение старого ожидания |
| Коррекция wait | Если 5000 даёт ошибки/плохую отзывчивость, сравнить 3000,2000,1000 мс на тех же доступных клиентах | Ошибки и субъективное ожидание; бюджет запроса не объявлять гарантированным Telegram |
| Mixed same page | article text + article rich + cached photo + URL photo + video + document + audio/voice + sticker, затем обратный порядок | Принятие API, видимость каждого результата, порядок, list/gallery, предпросмотр, реальные тип/содержимое опубликованного выбора |
| Mixed across pages | Уже показанные prompt/waiting article, затем page с фото/видео/документом; повторить с перестановкой типов в final page | Сохранность ранее добавленных строк, доступность final items, отсутствие пустой/сломавшейся выдачи |
| Уточнение/заглушка | Выбрать prompt, waiting, final без message и пустой results | Отправлен только ✖️ без кнопок; нет случайной служебной команды агенту |

Не делать полный перебор всех параметров: сначала размер, потом сравнение времён по записанным trace, затем ограниченные waiting/mixed прогоны. Планировать короткие сессии по 10–15 минут; увеличивать только для повторения конкретной ошибки. Обычный агент пока не нужен, генерация изображений не нужна: использовать подготовленные тестовые файлы и явную буферную загрузку.

Метрики: case ID, обезличенные request/cursor IDs, client/version/device/viewport, receivedAt, issuedAt, answerStarted/finished, rows/resultKinds, triggerDecision, readinessAt, error code. Нажатия/прокрутки не угадывать по задержке: ручной этап отмечает тестирующий человек. Это именно калибровка эвристики.

В [answerInlineQuery](https://core.telegram.org/bots/api#answerinlinequery) results — массив union InlineQueryResult; отдельной явной гарантии клиентского поведения всех смесей нет. [MTProto](https://core.telegram.org/api/bots/inline) также имеет режим gallery. Приём API не заменяет проверку клиентов, а same-page проверка не заменяет переход от article-барабана к media page.

## Task 3: Schema 15 — widget и его отображения

**Files:** Create `src/storage/migrations/015.sql`, `src/widgets/{views,migrate}.mjs`, `test/helpers/widget-views-fixture.mjs`, `test/integration/widget-view-migration.test.mjs`; Modify `src/storage/database.mjs`, `src/widgets/store.mjs`, `test/integration/{migrations,widget-storage,widget-state-normalization}.test.mjs`.

**Interfaces:** `store.getView(viewId)`, `store.listViews(widgetId)`, `store.byTarget(botId,target)`; последняя возвращает view с owner/widget metadata. `migrateWidgets(sql)` вызывается внутри общей upgrade transaction до COMMIT. Test helper `legacyWidgetDatabase(t,{schemaVersion,status,messageId,pending})` создаёт файл старой схемы с widgetId=`legacyw`, agentId=`a`, botId=`b`, chatId=1, handler/snapshot/state и указанными событиями. `widgetFixture(t,options)` возвращает настоящие db/store/manager, scope и управляемый fake host/Telegram; его тестовые handler fixtures не заменяют пользовательский Wordle.

- [ ] RED: схемы 13/14, две legacy регистрации с разными owners, известный адрес, unknown first send, active pending event и disabled backlog, повторный openDatabase и forced failure в середине переноса.

```js
test('legacy view ID is stable and disabled backlog is discarded', t => {
  const file=legacyWidgetDatabase(t,{schemaVersion:14,status:'disabled',messageId:7,
    pending:[{name:'idle',source:'local',data:{deadline:123}}]});
  let db=openDatabase(file), store=createWidgetStore(db);
  const view=store.listViews('legacyw')[0];
  assert.deepEqual(view.target,{chatId:1,messageId:7});
  assert.equal(store.get('legacyw').status,'stopped');
  assert.equal(store.get('legacyw').pending,0);
  db.close(); db=openDatabase(file); store=createWidgetStore(db);
  assert.equal(store.listViews('legacyw')[0].id,view.id);
  db.close();
});
```

- [ ] Run `node --test test/integration/widget-view-migration.test.mjs test/integration/widget-storage.test.mjs` (RED).
- [ ] Реализовать новый store и перенос parent/child tables без cascade потери событий. Для active сохранить допустимые pending и прежнюю политику already-started events; добавить правильный source view snapshot там, где известен исходный legacy message. User payload/callback data не переписывать. Для stopped очистить все ожидающие события/control jobs. Неизвестную первую публикацию перенести в отдельную diagnostic candidate без адреса/view.
- [ ] Добавить `bindingEpoch` — внутреннюю идентичность непрерывной привязки widget к адресу: при замене view того же widget/адреса сохраняется, после detach/rebind создаётся заново. В публичный `{id,target,props}` поле не входит. Оно понадобится для replies/reactions/polls в задаче 5.
- [ ] GREEN: повторный open не меняет IDs, failed migration оставляет старую схему/данные целиком. RF4: сравнить state JSON, callback registry, hash, snapshots, очередь active, чужие tables (agents/tasks/vault/MCP/usage/sticker_sets). Обновить ожидаемую schema version существующих migration tests, без удаления старых сценариев. Run целевой набор и `git diff --check`.

**Checkpoint:** перенос данных проверен автоматически; это ещё не live acceptance Wordle. Полную работоспособность нормализованного widget тракта проверяем после задач 4–7.

## Task 4: Рендер нескольких view, адреса и атомарная замена

**Files:** Create `src/messages/address.mjs`, `test/integration/widget-views.test.mjs`, `test/integration/widget-view-render.test.mjs`; Modify `src/widgets/{manager,render,runtime,context,service,media,views}.mjs`, `test/integration/{widget-render,widget-media,widget-runtime}.test.mjs`, `test/helpers/widget-views-fixture.mjs`.

**Interfaces:** manager.create(scope,{handler,description,state?}) создаёт без view; manager.setView(scope,{widgetId,send?|target?,props?}) -> `{viewId,target}`; manager.deleteView(scope,{viewId}). Runtime рендерит один раз на каждый view; каждый вызов получает frozen snapshot. Helper предоставляет `blockNextPublish(viewId)` -> `{entered,release,fail}`, `telegramCalls[]`; публикации проходят настоящий renderer и fake Telegram, а не фиктивную запись view без эффекта.

- [ ] RED: zero views; два обычных view с разными props; inline target без chatId; первый target только chatId; успешная/неуспешная replace; конфликт другого widget/agent; рекурсивная заморозка; независимые ошибки публикаций.

```js
test('replacement waits for publication and preserves the old binding on failure', async t => {
  const f=await widgetFixture(t), w=await f.manager.create(f.scope,
    {handler:'counter.tsx',description:'Counter',state:{count:1}});
  const old=await f.manager.setView(f.scope,{widgetId:w.widgetId,send:{},props:{part:'game'}});
  const block=f.blockNextPublish(old.viewId);
  const repaint=f.manager.update(f.scope,{widgetId:w.widgetId});
  await block.entered;
  const replacement=f.manager.setView(f.scope,{widgetId:w.widgetId,target:old.target,props:{part:'results'}});
  assert.equal(f.store.byTarget('b',old.target).id,old.viewId);
  f.failNextEdit('telegram_failed');
  block.fail(Object.assign(new Error('temporary'),{code:'telegram_failed'}));
  await repaint;
  await assert.rejects(replacement);
  assert.equal(f.store.byTarget('b',old.target).id,old.viewId);
});
```

- [ ] Run `node --test test/integration/widget-views.test.mjs test/integration/widget-view-render.test.mjs` (RED). `manager.update` в этой задаче поддерживает минимальный `{widgetId}` rerender; полный lifecycle добавляет задача 6.
- [ ] Разделить commit state и fan-out: game event исполняется один раз; состояние сохраняется независимо от отказа отдельного view; остальные view всё равно рендерятся. Hash/media cache привязать к viewId, не переиспользовать callback/media projection другого адреса. Без view commit сохраняет state без Telegram вызовов.
- [ ] Attach/replace: подготовить candidate view ID, дождаться текущего widget исполнения/публикации, вызвать render с candidate snapshot; подтвердить привязку после подтверждённой публикации. Ошибка, включая delivery_unknown, сохраняет старую локальную привязку; это не обещание отката сообщения в Telegram. После подтверждённой успешной Telegram-правки и сбоя финальной записи БД сохранить uncertainty прежней привязки и возможного нового результата, не повторять edit автоматически (RF1).
- [ ] Первый send с delivery_unknown сохраняет candidate diagnosis без fake messageId и без повторного send. Обычный render с delivery_unknown сохраняет view/state, запрещает его callbacks до подтверждённой публикации, следующий запрошенный render обходит hash cache. Успех очищает uncertainty, но не latched lastError.
- [ ] GREEN: `node --test test/integration/widget-views.test.mjs test/integration/widget-view-render.test.mjs test/integration/widget-render.test.mjs test/integration/widget-media.test.mjs test/integration/widget-runtime.test.mjs`. Проверить inline methods передают только inline_message_id, ordinary creation-only параметры не попадают в edit.

**Implementation rule:** deepFreeze применяется к копии plain JSON view. Для state сохраняется normalizeWidgetState из текущего кода. В strict module попытка записи даёт TypeError; отдельные proxy/ловушки не нужны.

## Task 5: Очередь событий, отсечение кнопок и исчезновение сообщения

**Files:** Modify `src/widgets/{events,queue,store,runtime,manager,polls,contract,views}.mjs`, `src/widgets/types.d.ts`; Create `test/integration/widget-view-events.test.mjs`, `test/integration/widget-view-delete.test.mjs`; Modify `test/integration/{widget-events,widget-callback-data,widget-lifecycle}.test.mjs`.

**Interfaces:** внутренняя admission metadata `{viewId,bindingEpoch,target,callbackData?,pollId?}` отделена от пользовательского события. `event.view` — снимок при приёме. `onViewDelete(ctx,event)` получает `{view,reason}` и обычные source metadata; reason — `message_deleted|message_not_found|access_lost`.

- [ ] RED: render + queued buttons/reply/reaction/poll, successful/failed replacement, explicit detach/reattach и перенос к другому widget. Проверить exact callback_data только у source view, а не union всех кнопок.

```js
test('replacement cutoff drops buttons but keeps a reply on continuous binding', async t => {
  const f=await widgetFixture(t), {widgetId,viewId,target}=await f.withOneView();
  const block=f.blockNextPublish(viewId);
  const repaint=f.manager.update(f.scope,{widgetId}); await block.entered;
  const replace=f.manager.setView(f.scope,{widgetId,target,props:{compact:true}});
  await f.receiveButton(target,'key:A');
  await f.receiveReply(target,'hello');
  block.release(); await repaint; await replace; await f.idle();
  assert.equal(f.handled.filter(e=>e.source==='button').length,0);
  const reply=f.handled.find(e=>e.source==='reply');
  assert.equal(reply.view.id,viewId); // source snapshot preserved, not new view
  assert.notEqual(f.store.byTarget('b',target).id,viewId);
});
```

- [ ] Run `node --test test/integration/widget-view-events.test.mjs test/integration/widget-view-delete.test.mjs` (RED).
- [ ] Обычный render сохраняет все события; перед выполнением кнопки повторно проверяются active, тот же view ID и exact callback в последнем успешном normal/rich render. Неподходящая кнопка получает пустой ACK. С момента admission replace закрыть button admission до завершения операции, включая ожидание текущей работы; уже принятые до cutoff завершаются. Failed replace не возвращает отсечённые кнопки. Несколько pending replacements не дают промежутка открытия.
- [ ] Reply/reaction привязать к bindingEpoch, сохраняя исходный event.view через непрерывную same-widget замену. Explicit detach, delete, stop или перенос обрывает epoch. Poll projection сохранять только для того же pollId и непрерывной привязки; новый poll/другой widget не наследует старые answers.
- [ ] Классифицировать подтверждённое удаление/недоступность при publish как detach view, а не render error; запланировать один onViewDelete после durable detach. Network/429/bad payload не считать удалением. Explicit detach/replace/delete_widget не вызывают этот хук; stopped его не исполняет и не сохраняет на будущее. Локальный read miss ничего не говорит об удалении Telegram-сообщения.
- [ ] GREEN: новые тесты плюс существующие event/lifecycle/callback suites. RF2: отдельно повторить сценарий failed replace, группы ordinary/rich кнопок, получение reply до смены view и после detach/rebind, удаление двух view независимо. Обычный callback ACK по-прежнему без нового короткого таймера.

## Task 6: Lifecycle, onInit, ошибки и аварийная остановка

**Files:** Create `src/widgets/errors.mjs`, `test/integration/widget-view-errors.test.mjs`; Modify `src/widgets/{manager,runtime,context,store,host,service,views}.mjs`, `test/integration/{widget-manager,widget-lifecycle,widget-host,widget-monitor,widget-runtime}.test.mjs`.

**Interfaces:** manager.update(scope,{widgetId,handler?,description?,state?}) -> `{widgetId,renderErrors:[{viewId,code,message}]}`; manager.get включает widget/view.lastError и `possiblePublications`. Diagnostic item: `{viewId,target:{chatId},createdAt,reason:'delivery_unknown'}`; это candidate, не активный view. error.view — failed candidate snapshot; error.previousView — прежний при replace.

- [ ] RED на onInit partial state, onStop throw/hang, zero views timers, update stopped `{}`, description-only active, self-delete из handler, повторные unhandled errors и очистку latch только соответствующими действиями агента.

```js
test('repeated unhandled view failures notify once until an agent repairs that view', async t => {
  const f=await widgetFixture(t), {widgetId,viewId,target}=await f.withOneView();
  f.rejectEdits(viewId,'telegram_failed');
  await f.localRender(widgetId); await f.localRender(widgetId);
  assert.equal(f.notifications.length,1);
  assert.equal(f.store.getView(viewId).lastError.code,'telegram_failed');
  f.allowEdits(viewId);
  const repaired=await f.manager.setView(f.scope,{widgetId,target,props:{}});
  assert.equal(f.store.getView(repaired.viewId).lastError,null);
});
```

- [ ] Run `node --test test/integration/widget-view-errors.test.mjs test/integration/widget-lifecycle.test.mjs` (RED).
- [ ] Реализовать prepare-before-retire update: handler/state валидировать до остановки старого экземпляра. Active handler/state update: прежний onStop → cleanup → новые поля → onInit → render всех view; pending сохранить до init failure. Active `{}`/description-only: rerender без lifecycle и latch reset. Stopped любой update: попытка init/recovery; init failure оставляет stopped с новым кодом и частично изменённым state, без fallback старой версии. description обязателен только для create. Первичное создание сохраняет используемый порядок инициализации/onCreate; onCreate вызывается только впервые, не при миграции/восстановлении. Сбой обязательного onInit при create возвращает widget_init_failed с widgetId, phase, status:stopped и исходной причиной, сохраняя доступную для исправления регистрацию; аналогично при замене.
- [ ] Stop закрывает admission и чистит все pending немедленно; ждёт текущую работу и onStop один раз на рабочий цикл, освобождает resources/disable buttons даже при ошибке хука. Self-delete помечает intent и завершает удаление после возврата handler, без ожидания самого себя. При watchdog/teardown failure fence bot+agent runtime, stopped всем его widgets, purge queues, kill, одно объединённое уведомление, без автоматического resume.
- [ ] Ошибки view независимы. onError вызывается один раз на конкретную ошибку, его собственная ошибка не рекурсирует. lastError хранит последнюю unhandled ошибку; уведомление только empty→filled. Widget latch для общих ошибок/attach без view. Фоновые успехи/read/restart/failed edits/description-only active latch не сбрасывают; successful соответствующий agent repair сбрасывает. Прямой tool error не дублировать отдельным model event. Possible publication diagnostic не зависит от того, обработан ли onError, и удаляется только явным deleteView candidate либо delete widget.
- [ ] GREEN: перечисленные suites; проверить lost access без renderErrors, unknown publication не считается view, deleteView candidate не вызывает Telegram/hooks. Все внешние и внутренние кнопки отключаются best effort при detach/stop/delete; URL-кнопку, которую не удалось изменить в Telegram, нельзя объявлять физически выключенной.

## Task 7: Новый widget API, команды и совместимость вызовов Wordle

**Files:** Modify `src/widgets/{api,contract}.mjs`, `src/widgets/types.d.ts`, `src/codex/threads.mjs`, `src/controller.mjs`, `src/commands/{widget,widgets-format,help,contract}.mjs`; Create `src/commands/message-chunks.mjs`, `test/integration/widget-view-commands.test.mjs`; Modify `test/integration/{widget-api,widget-contract,widget-commands,codex}.test.mjs` и тесты прежних tools.

**Interfaces:** публично `create_widget`, `update_widget`, `set_widget_view`, `delete_widget_view`, `delete_widget`, `list_widgets`, `get_widget`, `widget_event`. Результаты соответствуют §8–13 дизайна; list -> `{canCreate,items}`; setView -> `{viewId,target}`. Wordle сохраняет ctx.api.delete_widget/notify_agent, ctx.render/enqueue/setTimeout/clearTimeout и прежний callback event payload.

- [ ] RED: tool schemas реально регистрируются вместе, old tool names отсутствуют, create без description отвергается, list quota считает stopped/zero-view registrations, state replacement сохраняет view IDs. Не оставлять контракты только в JS invoke без model schema.

```js
test('public widget tools exclude stop, resume and render commands', () => {
  const names=new Set(dynamicTools.map(x=>x.name));
  for(const name of ['create_widget','update_widget','set_widget_view','delete_widget_view',
    'delete_widget','list_widgets','get_widget','widget_event']) assert.ok(names.has(name));
  for(const name of ['set_widget','widgets','widget_state','render_widget','resume_widget','stop_widget'])
    assert.equal(names.has(name),false,name);
});
```

- [ ] Run `node --test test/integration/widget-api.test.mjs test/integration/widget-contract.test.mjs test/integration/widget-view-commands.test.mjs test/integration/codex.test.mjs` (RED).
- [ ] Связать schemas с manager; обновить generated widget SDK и model authoring guidance. `widget_event` принимает активный собственный widget, не lifecycle hook, отвечает после admission. `get_widget`/`list_widgets` не запускают runtime и не очищают ошибки. `set_widget_view` выбирает ровно send или target, не вводит kind; send:{} использует текущий чат, target inline не требует fake chatId. Проверять существующие permission limits для соседнего чата; не расширять их из-за наличия view.
- [ ] `/widget list/show`: сохранить существующие permissions/owner filters/пагинацию по widgets. Выводить status/description/Owner/Pending/Views и каждый address. Для любых private — только chatId/messageId без ссылки. Для доступной group/channel ссылки сделать text_link на самом адресе; basic group/unknown — без выдуманного t.me/c. Inline-only адрес подписывать group лишь при известном типе. Длинный вывод разбивать на сообщения, сохраняя UTF-16 offsets entities и полный текст; не резать surrogate pair, code ID или text_link внутри одного адреса.
- [ ] Убрать прежние stop/resume/render subcommands, если они присутствуют в router/help; новые такие команды не добавлять. Исправление stopped выполняет агент через update_widget. Операции нового API не должны обходить существующий owner/access контроль или создавать reentrant ожидание самого себя через controller gate.
- [ ] GREEN: API/command suites + полный `npm test` для widget этапа. Исправлять существующие tests, которые проверяли прежние tools/status/backlog, в пользу принятых требований, сохраняя самостоятельные проверки sandbox/permissions/media/state normalization.

## Task 8: Настоящий Wordle — публикация старой версией и миграция

**Files:** Create `test/manual/wordle-migration-acceptance.mjs`, `test/helpers/wordle-fixture.mjs`, `test/integration/wordle-legacy-contract.test.mjs`, `docs/dev/wordle-migration-verification.md`; Modify `test/manual/widget-runtime-acceptance.mjs` для нового API. Игровые файлы не изменять и архив не добавлять в репозиторий.

**Interfaces:** CLI `node test/manual/wordle-migration-acceptance.mjs --config PRIVATE_JSON --archive ARCHIVE --old-root OLD_CHECKOUT --phase before|after --state-dir PRIVATE_FIXTURE_DIR`. Old root — отдельный read-only checkout сохранённого base SHA; запускать код именно старой версии, не эмуляцию старого SQL через новую библиотеку. Оба этапа используют одну изолированную БД/бота/агента/botsDir/snapshots.

Подготовить old source export, не занимая и не меняя существующие worktree. Команды выполняются из feature worktree; установить зависимости экспортированной версии отдельно:

```powershell
$wordleBaseSha = Get-Content -LiteralPath .runtime-check/base-revision.txt
git archive --format=tar --output=.runtime-check/legacy-source.tar $wordleBaseSha
New-Item -ItemType Directory -Force .runtime-check/legacy-source | Out-Null
tar -xf .runtime-check/legacy-source.tar -C .runtime-check/legacy-source
npm ci --prefix .runtime-check/legacy-source
```

Использовать относительное имя tar-архива, чтобы GNU tar на Windows не трактовал `C:` как удалённый host. После экспорта source tree не изменяется; runtime fixture хранится в другом каталоге. При изменении исходной базы на этапе 0 номера 015/016 и тестовые schemaVersion должны быть пересчитаны до первого изменения storage.

- [ ] Подтвердить SHA256 архива `f3279705d3873ed9588c6f2a88bf6e41a07ab4b8480865a4300238dc65a3d084`. Прочитать `widgets/wordle/AGENTS.md` перед работой с извлечённым деревом. Извлечь в тестовую wiki без правок кода/словарей; сохранить manifest хешей и сравнивать до/после. `dictionary-admin.tsx` не входит в обязательную игровую совместимость.
- [ ] RED automated contract: с текущими игровыми exports проверить старую render(state) сигнатуру, callback payload/event.respond и state normalization; тест использует настоящие игровые модули/скомпилированный snapshot, а не заменённый counter handler. Run `node --test test/integration/wordle-legacy-contract.test.mjs`.

```js
test('unmodified Wordle ignores the extra view argument',
  {skip:!process.env.TG_WORDLE_ARCHIVE}, async t => {
    const f=await loadWordleFixture(t,process.env.TG_WORDLE_ARCHIVE);
    const state=f.initializedState;
    assert.deepEqual(f.module.render(state,{id:'v',target:{chatId:1,messageId:7},props:{}}),
      f.module.render(state));
    assert.deepEqual(f.sourceHashesAfter(),f.sourceHashesBefore);
  });
```

`loadWordleFixture` проверяет archive hash, извлекает неизменённые файлы, компилирует их тем же widget compiler, выполняет начальную инициализацию в тестовом runtime с подставным Telegram и возвращает module/state/hash manifest. TG_WORDLE_ARCHIVE обязателен в нашей приёмке; skip на CI без пользовательского архива явно отражать в отчёте. Это только offline contract check, не замена BEFORE/AFTER.
- [ ] BEFORE: старая версия создаёт Wordle своим API, публикует настоящее сообщение, пользователь начинает игру и делает ход. Записать private manifest widgetId/owner/address/state/hash/callback/timer deadline и base SHA. Подтвердить, что кнопка действует до обновления. Корректно остановить старый poller/controller и сделать резервную копию изолированного fixture.
- [ ] AFTER: запустить новую версию над тем же fixture, выполнить обычную миграцию. Новые list/get находят прежний ID и один stable view с прежним адресом. Нажать старую кнопку; продолжить ту же партию. Подключить второй полный view, проверить общий activeId/state в двух сообщениях и один таймер. Выполнить update с тем же handler, replacement/detach второго view, повторный restart, затем delete widget с отключением кнопок.
- [ ] Отдельно различать естественное истечение Wordle idleDeadline и потерю state. Успешный old→new результат должен включать управление реальным прежним сообщением. При несовместимости сообщить пользователю нарушенный контракт и исправлять платформу; не менять Wordle, не ослаблять тест и не объявлять миграцию принятой по offline fixtures.
- [ ] Заполнить отчёт реальными шагами/наблюдениями и сохранностью source hashes. Подготовленный runner без выполненных before/after не даёт статус PASS. Повторно использовать этот сценарий после финальной schema 16 в задаче 14.

## Task 9: Schema 16 — выданные кнопки, события, владение и снимки

**Files:** Create `src/storage/migrations/016.sql`, `src/inline/store.mjs`, `test/integration/inline-storage.test.mjs`; Modify `src/storage/{database,retention}.mjs`, `test/integration/{migrations,retention}.test.mjs`.

**Interfaces:** `createInlineStore(db,{now})` -> `registerPage(owner,page)`, `button(botId,btnId)`, `acceptButton({botId,callback,owner})`, `pendingEvents()`, `markQueued(eventId)`, `claimOwner(owner,inlineMessageId)`, `saveConfirmed(owner,inlineMessageId,change)`, `read(owner,inlineMessageId)`, `cleanup(now)`. `acceptButton` проверяет актуальные permits/expiry/группу и сохраняет полный принятый event в одной transaction с закрытием группы и claim владельца. При повторном callback.id возвращает существующий event, не создаёт второй. Foreign owner не перезаписывается.

- [ ] RED: idempotent register, consumed group, concurrent callbacks, DB rollback, button expiry без запуска cleanup, partial snapshots, retention с живым view и pending event.

```js
test('page registration cannot resurrect a consumed group', t => {
  const f=inlineStorageFixture(t), page=f.preparedPage({group:'start'});
  f.store.registerPage(f.owner,page);
  const accepted=f.store.acceptButton({botId:'b',owner:f.owner,
    callback:f.callback(page.buttons[0].btnId)});
  assert.equal(accepted.status,'accepted');
  f.store.registerPage(f.owner,page);
  assert.equal(f.store.button('b',page.buttons[0].btnId),null);
  assert.equal(f.store.pendingEvents().length,1);
});
```

- [ ] Run `node --test test/integration/inline-storage.test.mjs test/integration/retention.test.mjs` (RED). `inlineStorageFixture` определять в этом test file, используя настоящий openDatabase и createInlineStore; fake только now/нативный callback.
- [ ] Создать таблицы/индексы и транзакционные методы. Сохранять исходные `createdAt/expiresAt` при повторе; closed-group tombstone не исчезает раньше зависимых definitions. Новая подготовка получает новый tipId; прежние IDs не переиспользуются для нового action. На ошибке регистрации страницы откатить все её записи и закрыть request через service, не отправляя готовую страницу.
- [ ] Настроить retention: button 30 дней от первой регистрации; snapshot 30 дней от последней confirmed edit; owner минимум на срок view/действующих кнопок и 30 дней после последней confirmed edit/accepted callback адреса. read/uncertain edit не продлевают. Pending event не очищается до admission. Истечение request после часа и controller restart не удаляет выданные кнопки. Отсутствие snapshot не снимает owner/view (RF3).
- [ ] GREEN: fault injection до/после SQL commit; неизвестный результат answer после зарегистрированной страницы оставляет registry, ошибка БД до commit не оставляет частичных кнопок. Повторный open не дублирует группы/events; schema 13/14→16 проходит целиком и сохраняет пользовательские данные, включая sticker_sets.

## Task 10: Все обычные inline-результаты, кнопки и permits

**Files:** Create `src/inline/{results,buttons}.mjs`, `test/integration/inline-results.test.mjs`, `test/integration/inline-buttons.test.mjs`; Modify `src/inline/{contract,service}.mjs`, `src/messages/callbacks.mjs` только для общего неизменённого permits evaluator, `test/integration/buttons.test.mjs`.

**Interfaces:** `normalizeInlineResults(scope,results,{db,access,ids})` -> `PreparedResult[]`, без записи БД; `prepareActionButtons(input,{tipId,permits,ids})` -> `{native,definitions}`. PreparedResult хранит native payload и определения; registerPage задачи 9 выполняется только service непосредственно перед выдачей. Конструктор IDs injected в unit tests, случайный в production.

- [ ] RED: friendly совместимость, native URL/cached variants, rich InputMessageContent, optional fields, несколько рядов/несколько rich button blocks, exact/prefix permits, вложенные uploads и запрещённые Game/invoice/pay.

```js
test('mixed results preserve native types and reject nested uploads atomically', () => {
  const f=resultFixture(), prepared=normalizeInlineResults(f.scope,[
    {title:'Text',message:{text:'hello'}},
    {native:{type:'photo',photo_file_id:'p',title:'Photo'},
      file_sources:[{messageId:7,fileId:'p'}]}
  ],f.adapters);
  assert.deepEqual(prepared.map(x=>x.native.type),['article','photo']);
  assert.equal(f.writes.length,0);
  assert.throws(()=>normalizeInlineResults(f.scope,[
    {title:'Bad',message:{rich_message:{blocks:[
      {type:'photo',photo:{type:'photo',media:'attach://x'}}
    ]}}}
  ],f.adapters),{code:'inline_upload_forbidden'});
});
```

- [ ] Run `node --test test/integration/inline-results.test.mjs test/integration/inline-buttons.test.mjs test/integration/buttons.test.mjs` (RED). resultFixture использует saved outer message с реальным file_id proof в изолированной БД и spy отсутствия registry write.
- [ ] Реализовать native variant validation: article; URL photo/gif/mpeg4_gif/video/audio/voice/document; location/venue/contact; cached photo/gif/mpeg4_gif/sticker/document/video/voice/audio. Для каждого типизированный набор обязательных/допустимых полей, MIME/native combinations и InputMessageContent. Сохранять entities/caption_entities, previews/thumbnails, descriptions, formatting, media-specific flags и native keyboards там, где поддерживаются. Нельзя переносить ограничения URL-document на cached document.
- [ ] Все file_id ссылки, включая вложенные rich media, проверять по сохранённым внешним сообщениям и access. Public URLs проходят существующие ограничения; token-bearing Telegram URL запрещён как в обычном messaging. Локальные пути/attach:// и uploads отвергаются на любой глубине. Game/callback_game/invoice/pay отвергаются до принятия всего массива, без скрытых отправок или частичного ready.
- [ ] Кнопки: message.buttons matrix, плоский список → один ряд; каждый rich block → один ряд. Служебные key/group не попадают в Telegram callback_data. Прежний permits: exact, longest terminal-* prefix, fallback '*', null/IDs/[]/no match; в inline применяется независимо от chatType. URL/copy/disabled не превращаются в action; permits не скрывает их и не регулирует клиентское действие. Отсутствующий key назначается контроллером; ограничения group/key и wire length проверяются отдельно.
- [ ] GREEN: table-driven cases для каждого разрешённого семейства и optional fields; один неверный элемент отклоняет весь set. Friendly без message создаёт ✖️; native media без InputMessageContent сохраняет свою нативную нагрузку. Смешанный массив в unit test доказывает только нормализацию; live результаты остаются за задачами 2/14.

## Task 11: Принятые нажатия и точная граница приёма очередью

**Files:** Create `src/inline/events.mjs`, `test/integration/inline-events.test.mjs`, `test/integration/inline-admission-race.test.mjs`; Modify `src/agents/queue.mjs`, `src/inline/store.mjs`, `test/integration/{runtime,maintenance}.test.mjs`.

**Interfaces:** `createInlineEvents({store,widgets,queue,resolveOwner,telegram})` принимает native callback. Новый queue метод `enqueueCommitted(id,event,source,admit,commit)` возвращает `accepted|full`; commit синхронен и вызывается до pump. Обычный enqueue сохраняет прежнюю сигнатуру/поведение. `cancelWhere(id,predicate)` удаляет только ещё ожидающие элементы, вызывает прежний onDropped; busy turn и остальные события не затрагивает.

- [ ] RED: два допустимых человека нажали общую group, повтор callback.id, недопустимый permit, отключённый preparing agent, другая текущая personal-agent assignment, старый токен на уже подключённом view, DB failure перед queue acceptance, crash-подобный restart после queued marker.

```js
test('a queued button event is not replayed after restart', async t => {
  const f=await inlineEventFixture(t);
  const event=await f.acceptClick({group:'start'});
  assert.equal(f.queued.filter(x=>x.eventId===event.eventId).length,1);
  assert.equal(f.store.pendingEvents().length,0);
  await f.restartController(); // same DB, fresh RAM queue, no model ACK
  assert.equal(f.queued.filter(x=>x.eventId===event.eventId).length,0);
  assert.equal(f.groupOpen('start'),false);
});
```

- [ ] Run `node --test test/integration/inline-events.test.mjs test/integration/inline-admission-race.test.mjs` (RED).
- [ ] Маршрутизация: сначала widget byTarget; его игровой callback не становится model action. Затем known inline owner/snapshot или registry btnId. Проверить bot/owner/active/access/expiry/permits/current keyboard где известна; неизвестный/чужой/expired callback получает пустой ACK. Только допустимое действие атомарно закрывает group и сохраняет event. Модельный envelope — §32, action из registry, настоящий пользователь нажатия, inlineMessageId, eventId/btnId/tipId/btnGroup; без fake ordinary IDs/view/from запроса.
- [ ] Реализовать reserve→durable queued marker→pump без async разрыва: добавить item в RAM без pump, синхронно зафиксировать marker, при ошибке убрать reservation и сохранить pending для допустимой последующей передачи; только после commit запускать pump. На момент durable marker item уже находится в очереди. Crash до marker не считается admission и допускает recovery pending; после marker event не переигрывается даже без runtime ACK. Отдельно fault-test каждый разрыв (RF5).

```js
// Внутри enqueueCommitted; capacity/admit проверки идут до reservation.
const item={event,source,admit};
state.events.push(item);
try { commit(); } catch(error) {
  state.events.splice(state.events.indexOf(item),1);
  throw error;
}
this.pump(id);
return 'accepted';
```

- [ ] Добавить idempotent drain только pending events после restart/разблокировки очереди. Recheck agent и widget ownership до admission. Queue full до приёма не создаёт потерянное событие без durable записи; если запись уже pending, не открывать её group автоматически. После queued marker не ждать и не требовать подтверждения model/runtime. Перед run/steer повторно фильтровать отменённый первоначальный inline event после любого await подготовки scope/rules/background; не отбрасывать обычные chat/button events вместе с ним.
- [ ] GREEN: новые тесты + runtime/maintenance. Потеря уже принятого RAM event при сбое модели допустима; автоматического повторения и открытия group нет. Публичная кнопка маршрутизируется preparing agent, не личному агенту нажавшего пользователя.

## Task 12: Inline read/edit, via_bot и краткие сообщения

**Files:** Create `src/inline/messages.mjs`, `test/integration/inline-messages.test.mjs`, `test/integration/via-bot-edit.test.mjs`; Modify `src/agents/history.mjs`, `src/messages/{actions,address}.mjs`, `src/telegram/short-message.mjs`, `src/controller.mjs`, `src/inline/{events,store}.mjs`; Modify `test/integration/{message-actions,short-message,history-access,history-gap}.test.mjs`.

**Interfaces:** `read(scope,{inlineMessageId})` -> `{messages:[{inlineMessageId,partial,...confirmed,deliveryUnknown?}]}` либо item error message_not_found. `edit(scope,{inlineMessageId,...components})` выбирает inline methods, требует established ownership, не допускает direct edit widget-owned адреса. Ordinary read/edit формы сохраняются.

- [ ] RED: read до первой правки, keyboard-only partial, full text/rich known snapshot, unknown edit поверх полного/частичного, foreign owner, expiry без потери view, raw via_bot пример пользователя и permits-only bypass.

```js
test('via_bot is exposed without read and blocks ordinary permits-only edit', async t => {
  const f=await inlineMessageFixture(t);
  const message={message_id:7,chat:{id:1,type:'private'},from:{id:1,is_bot:false},
    text:'test',via_bot:{id:42,is_bot:true,username:'bold'}};
  f.db.saveMessage('b',message);
  assert.equal(shortMessage(message).viaBot,'bold');
  const result=await f.messages.edit(f.scope,{messageId:7,permits:{'*':null}});
  assert.ok(result.error);
  assert.equal(f.telegramCalls.length,0);
});
```

- [ ] Run `node --test test/integration/inline-messages.test.mjs test/integration/via-bot-edit.test.mjs test/integration/short-message.test.mjs` (RED).
- [ ] Address validator строго разделяет inlineMessageId и ordinary selectors. Наличие callback устанавливает route/owner, но не даёт исходный текст. Подтверждённые правки сохраняют только известные компоненты; partial:false только при известном полном представлении. Unknown delivery оставляет последний confirmed snapshot с отдельным флагом; никакого fake автора/чата/времени. Media edit сохраняет обычные source/access проверки и запрет inline upload.
- [ ] Known inline обычные callback-кнопки обрабатывать по сохранённой клавиатуре/owner с общими permit/group helpers и inline-адресом; registry action сохраняет свой конверт. Не выдумывать key/text для unknown исходного сообщения. Новая action-клавиатура при edit получает новые definitions/tip, не восстанавливает израсходованные группы. Прямой edit зарегистрированного widget view запрещён; его меняет set_widget_view/runtime.
- [ ] Бан via_bot поставить до любых локальных или Telegram effects обычного edit и ordinary set_widget_view, включая собственный via bot и чужой. Удаление ordinary адреса с существующими правами вызывает detach ровно его view. Внутренний рендер/disable migrated view проходит по своим проверенным правам. `viaBot` добавляется в short message/edit/history/search: username без @, true без username, absent без via_bot; from пользователя не меняется.
- [ ] GREEN: новые tests + существующие message/history/short suites. RF1/RF3: подтверждённая правка + DB failure не разрешает перехват и не сохраняет неподтверждённый текст как прочитанный; истёкший read не равен Telegram delete.

## Task 13: Подключить inline к контроллеру, polling и настоящим model tools

**Files:** Modify `src/controller.mjs`, `src/telegram/polling.mjs`, `src/codex/threads.mjs`, `src/agents/{lifecycle,queue}.mjs`, `src/main.mjs`, `src/commands/agent.mjs`, `src/inline/{service,contract,events}.mjs`; Create `test/integration/inline-controller.test.mjs`, `test/integration/inline-tools.test.mjs`; Modify `test/integration/{pollers,codex,private-dialog,revoke-access,stop-race}.test.mjs`.

**Interfaces:** добавить set_inline_results tool schema для friendly/native union; read/edit schemas — альтернативные адреса. Incoming inline event: `{eventType:'inline',requestId,query,chatType?,expiresAt}`, без from. Service создаётся в createController и участвует в close/idle; отсутствие модели в master bot не создаёт inline-agent route.

- [ ] RED: нет личного агента; disabled; enabled personal agent; optional chat_type; обычное сообщение не затронуто; same text новая initial; paginate другого пользователя; поздний callback результата после нового request; background result после конца root turn; disable/delete/revoke во время waiting/ready; restart; register DB/answer errors.

```js
test('turn completion keeps waiting until explicit results arrive', async t => {
  const f=await inlineControllerFixture(t);
  await f.startAndTrigger('generate a cat');
  await f.completeModelTurn();
  const requestId=f.inlineEvent.requestId;
  assert.equal(f.requests.current('b',1).phase,'waiting');
  const response=await f.controller.invoke(f.scope,'set_inline_results',
    {requestId,results:[{title:'Ready',message:{text:'cat'}}]});
  assert.equal(response.status,'accepted');
  await f.scroll();
  assert.equal(f.lastAnswer.results[0].title,'Ready');
});
```

- [ ] Run `node --test test/integration/inline-controller.test.mjs test/integration/inline-tools.test.mjs test/integration/pollers.test.mjs` (RED).
- [ ] Добавить inline_query в allowed_updates и выделенную receive ветку до обычного message route. Принимать страницу быстро, удерживать до waitMs в отслеживаемой async работе, не блокировать весь Telegram polling на 5 секунд. close отменяет subscriptions/timers; ошибки старого page task не отменяют новую версию. Не использовать chosen_inline_result для гарантии single-use и не требовать его для работоспособности.
- [ ] Сначала закрывать предыдущую версию на новом initial, затем разрешать private personal agent без автосоздания/включения. Если его нет — принятая header-кнопка в ЛС с обычным start_parameter. Disable/delete/revoke закрывают requests, очищают buffers и pending initial jobs; обычный root completion/временный model error этого не делают. Все rechecks выполняются перед delayed enqueue, result accept, registerPage и answer. Если новая версия появилась во время in-flight answer старой, уже начатый внешний эффект не откатывать и новую версию не закрывать (RF1/RF5).
- [ ] Финальные массивы выдавать страницами <=50 результатов, без произвольного ограничения общего числа. Хранить готовый остаток до общего часа/закрытия; кнопки регистрировать только для реально выдаваемой страницы. Сериализовать короткие решения о page allocation внутри request, не удерживать lock так, чтобы setResults/cancel не могли разбудить ожидание. Одновременные повторы не генерируют новые IDs или группы; после полной выдачи вернуть terminal empty. Только одна answer attempt на query ID, не retry при ошибке.
- [ ] Обновить model guidance: текущий private собеседник — автор inline event; chatType не даёт адреса/истории; результат только set_inline_results с исходным requestId, включая background continuation; явный buffer send→read→file_id/file_sources, default private disable_notification:true; запрещён upload; normal final text не публикуется. First accepted final/empty/already_set, недоступный request и самостоятельное новое inline после ЛС описать явно. Подсказки виджетов заменить новым API без устаревших stop/resume/render tools.
- [ ] GREEN: новые suites и существующие lifecycle/polling/Codex tool registration tests. Проверить root+subagent tool schema registration текущим fake provider: не смешивать форматы dynamicTools, не ослаблять sandbox. Это не самостоятельное разрешение запускать субагентов для выполнения плана.

## Task 14: Полный живой тракт, смешанные типы и повторная калибровка

**Files:** Create `test/manual/inline-agent-acceptance.mjs`, `test/integration/inline-agent-acceptance.test.mjs`; Modify `test/manual/{inline-calibration,wordle-migration-acceptance}.mjs`, `docs/dev/{inline-calibration-results,wordle-migration-verification,inline-widget-verification}.md`.

**Interfaces:** `node test/manual/inline-agent-acceptance.mjs --config PRIVATE_JSON --case wordle|media|background|ownership|mixed|matrix --duration-seconds 600`. Runner экспортирует `runInlineAcceptance({argv,createRuntime,signal})` для unit tests. Каждый case ограничен указанным bot/user/chat scope и числом ожидаемых внешних действий; unknown delivery тоже расходует бюджет и не вызывает повторную отправку. Native model/Telegram проверяются отдельно от подставного агента ранней калибровки.

- [ ] RED unit для runner: без opt-in config нет сети/модели; лишний send/edit или чужой target отвергается; аварийная остановка завершает только fixture-процессы. Run `node --test test/integration/inline-agent-acceptance.test.mjs`.

```js
test('live acceptance requires a designated environment before starting a model', async () => {
  let starts=0;
  await assert.rejects(runInlineAcceptance({argv:[],
    createRuntime:()=>{ starts++; throw new Error('must not start'); }}),/config/i);
  assert.equal(starts,0);
});
```
- [ ] **Wordle end-to-end:** пользователь пишет inline-поручение; после порога личный агент выдаёт карточку с one-shot action. Выбрать, нажать Start, получить button event с настоящим нажимающим; агент подключает неизменённый Wordle к этому inlineMessageId. Игровая кнопка идёт в runtime без model turn. Добавить ordinary view в разрешённом тестовом чате, проверить общую партию и отсутствие дублирования таймера. Публичный/закрытый permit проверить разными тестовыми участниками, если они доступны; отсутствие второго участника не заменять поддельным реальным Telegram update.
- [ ] **Медиа:** агент явно отправляет готовый тестовый файл в буфер без звука, читает outer message и выдаёт cached photo/document. Выполнить один настоящий generation→save_image→buffer send→read→inline сценарий; только выделенный тестовый пользователь/буфер. Внешние URL проверить на публичных стабильных fixtures, не на token-bearing адресах. Буфер не удаляется автоматически.
- [ ] **Mixed:** повторить полностью матрицу задачи 2 через production normalizer и agent tool: same-page разных типов и переход article drum→media. На доступных клиентах выбрать каждый тип и проверить фактически отправленное содержимое. Где destination известен тестовому контроллеру, сверить сохранённый native Message; в неизвестном чате требуется визуальная проверка человеком, бот не выдумывает read исходной публикации.
- [ ] **Фоновый результат:** настоящий root turn заканчивается без set_inline_results, барабан продолжает ожидать; дальнейшая работа передаёт результат с тем же requestId. Новый initial во время работы отменяет обслуживание старого и не регистрирует его поздние action-кнопки. Проверить restart контроллера: RAM request потерян, уже выданная кнопка по БД ещё обрабатывается. Проверить отключение агента и отсутствие автоматического восстановления request при включении.
- [ ] **Владение и события:** второй агент с правом писать в тот же тестовый канал/группу получает view_conflict с existing owner/widget/view IDs. Проверить known ordinary via_bot edit ban и разрешённое удаление в пределах текущих прав. Reply/reaction для unknown inline destination — отдельный live case: фиксировать только реально полученные updates и необходимые права/тип чата. Guest Mode не добавлять как новую неоговорённую подсистему ради прохождения теста; недоступность источника события оформить ограничением Telegram/окружения.
- [ ] Повторить выбранные trigger/wait/rows из задачи 2 на production path, включая смешанные строки. Измерить actual received/issued timing под нагрузкой реального агента. При ухудшении изменить только измеренные policy defaults и тесты; отличие поведения клиентов/необходимый fallback обсуждаются с пользователем. Не считать Desktop результатом Android/iOS.
- [ ] Выполнить Wordle BEFORE/AFTER заново на финальной schema 16 и итоговом коде, либо использовать заранее сохранённую pristine backup BEFORE для изолированного повторения. Отдельно проверить handler update по тому же пути без изменения игровых файлов, игру по старой кнопке и второй restart новой версии. Прежний промежуточный PASS задачи 8 не заменяет финальную приёмку.
- [ ] В этом финальном миграционном fixture дать настоящему агенту через зарегистрированные новые tools найти прежний widgetId, прочитать его get_widget и выполнить безопасное update_widget без сброса state. Проверить actual tool results и прежнее Telegram-сообщение, а не только завершение model turn. Model tool-session refresh не удаляет agent record или widget state.
- [ ] Завершить runner, снять только его poller/процессы, очистить созданные fixtures там, где адреса и права известны; сохранить private before/after manifest и sanitized отчёт. Для Alpine применять identity-checked `npm run service:alpine_stop -- PRIVATE_CONFIG`, а не общий kill процесса/контейнера. Требуемое участие пользователя или недоступный bot/device — явное незавершённое live acceptance, не успех по умолчанию.

## Task 15: Wiki, итоговая проверка и готовность ветки

**Files:** Create `docs/inline.md`; Modify `docs/{index,architecture,widgets,agent-contract,message-events,messaging,storage,commands,agents,operations,security}.md`, `docs/dev/index.md`, `docs/dev/check-wiki.mjs`, `docs/dev/inline-widget-verification.md`, `docs/dev/examples/widgets/*.tsx` при использовании удалённых agent tools. Проверить README только если его ссылки/обзор стали неверными.

**Interfaces:** wiki описывает реализованные schemas/tools/команды и подтверждённые ограничения; дизайн/план остаются в dev. `docs/dev/inline-widget-verification.md` содержит один итоговый статус по каждому автоматическому и живому этапу и ссылки на отдельные подробные отчёты.

- [ ] Обновить wiki по итоговым контрактам: 0..N view/state/timers, новые widget tools, stopped/recovery, errors/latches/candidates; inline lifecycle/RAM loss/expiry/drum; friendly/native result union и исключённые Game/payments; action/permits/groups; partial read/edit/viaBot; buffers/file_sources/retention. Привести реальные примеры аргументов/ответов. Controller-owned labels на английском; русские формулировки дизайн-документа не копировать буквально в runtime prompts.
- [ ] Обновить ожидаемые имена tools в `docs/dev/check-wiki.mjs`: сейчас checker жёстко требует set_widget/widgets/widget_state/render_widget. Проверить executable widget examples, не сохраняя удалённый публичный API ради старого примера; предоставленный Wordle при этом не редактируется. Все ссылки dev-документов после переноса проверить на фактические локальные файлы.
- [ ] Описать апгрейд: остановка и backup перед migration; новая schema; прежняя версия не должна открывать уже мигрированную БД. Для возврата к старому коду нужен pre-upgrade backup, а не обратная миграция на месте. Refresh model tool contract выполнить штатным clear/reset native session в изолированном тесте, сохраняя agent identity и widget state; production clear/deploy в план исполнения не входит.
- [ ] Выполнить один свежий полный `npm test` в Windows и на целевом Alpine с установленными зависимостями. Native readers запускать отдельно только в окружении Chromium/Poppler, не выдавать их отсутствие за проверку. После нового изменения/исправления повторить затронутые тесты и затем полный итоговый набор. Production runtime flags, sandbox и permissions не ослаблять ради зелёного отчёта.

```powershell
npm test
node docs/dev/check-wiki.mjs
git diff --check
git status --short
```

```sh
npm test
TG_READERS_NATIVE=1 npm test
node docs/dev/check-wiki.mjs
git diff --check
```

- [ ] Самостоятельный финальный review по пяти Review Focus и таблице покрытия ниже: нет неподтверждённого read, двойного send/ACK/agent job, cross-owner takeover, revival stopped backlog, скрытого изменения Wordle. Отдельный независимый reviewer используется, только если пользователь выбрал такой способ исполнения; автоматически субагентов не запускать.
- [ ] Итоговый отчёт: ветка/worktree/base SHA, что реализовано, точные пройденные проверки и пропуски, измеренные trigger/wait/rows с клиентами, Wordle old→new evidence, ограничения смешанных результатов, список изменённых wiki. Полностью готовой ветку называть только после обязательных live этапов, а не только `npm test`. Передать diff пользователю; не merge/push/deploy без отдельного разрешения.

## Покрытие утверждённого дизайна

| Разделы дизайна | Задачи и основная проверка |
| --- | --- |
| 1–6: цель, drum, выбор, старт Wordle, Telegram limits | 1–2, 10, 13–14; один async job, выбранное содержимое, реальные клиенты |
| 7: оставшиеся вопросы/эксперименты | 2, 8, 14–15; статусы выполнено/не проверено не смешиваются |
| 8: shared state/view/lifecycle/API/lastError | 3–7; независимые view и одна game queue |
| 9: legacy Wordle/migration | 3, 8, 14; реальная старая публикация и неизменённый код |
| 10–11: list/show/ссылки | 7; private без URL, group/channel address text_link, длинный вывод |
| 12–13: stopped/update/widget_event | 5–7; purge/нет stop-resume-render public tools |
| 14–15: replies/reactions/unknown inline chat | 5, 14; continuity и реальные update capabilities |
| 16–20: errors/conflicts/polls/cutoff/unknown delivery | 4–6; RF1–RF3 |
| 21: отсутствие короткого ACK timer | 5–7; прежний callback response contract |
| 22–24: unknown first send/candidate diagnosis | 3–4, 6–7; нет fake active view/resend |
| 25–27: personal agent/permits/невозможность server read | 11–13; no autoagent, self-contained action, local confirmed read |
| 28–32: registry/single-use/durable button/event envelope | 9–11; transaction и queue acceptance без runtime ACK |
| 33–36: partial read/edit/via_bot/viaBot | 12; подтверждённые компоненты и ordinary-address ban |
| 37–38: одна request version/set results | 1, 10–11, 13; same text новое поручение, stale result rejected |
| 39–42: media/background/clarification/✖️ | 1, 10, 13–14; explicit upload и no result от завершения turn |
| 43–45: RAM/hour/inline event/final result | 1, 13; no persistence, optional chatType, first final wins |
| 46–48: timing/wait/cursors | 1–2, 13–14; issued time и live calibration |
| 49: any answer/DB registration failure closes request | 1, 9, 13; failed version only, registry retained after uncertain send |
| 50: keyboard rows/key/group/permits | 10–12; rich/native matrix и прежние правила |
| 51–52: retention/buffers/source loss | 9–10, 12, 14–15; independent expiry и no auto buffer delete |
| 53: agent disabled/deleted/revoked | 1, 11, 13–14; close/wake/no revival |
| 54–55: freeze/current runtime mechanics | 4, 6; deepFreeze snapshot, прежние watchdog limits |
| 56–57: широкий native scope/Wordle unchanged/manual return | 8, 10, 13–15; no Game/invoice, новое inline после ЛС |
| 58: смешанные типы same page и после drum | 2, 10, 14; API acceptance + клиенты + фактически отправленное сообщение |

## Участие пользователя и критерий завершения

При исполнении могут потребоваться: выделенный inline-enabled тестовый бот/конфигурация; ручная прокрутка и выбор на доступных клиентах; второй участник и разрешённая тестовая группа/канал для публичных permits/ownership. Эти сведения не требуются для написания кода и offline tests: продолжать независимые задачи, пока они уточняются. Если для конкретной живой проверки нет доступа/действия, назвать точное недостающее условие и оставить её незавершённой.

Завершение означает: итоговые автоматические проверки пройдены, известные обязательные live этапы реально выполнены либо пользователь явно сократил их объём, таймеры/rows основаны на записанных замерах, неизменённый Wordle пережил old→new переход, документация соответствует коду. Не выбирать значения по ощущениям и не закрывать калибровку имитацией Telegram-клиента.

Execution adjustment accepted by the user: compile handlers in a separate temporary sandbox rather than the shared widget runtime. Same owner restrictions; build RPC/result limits and memory watchdog remain bounded. Per-owner builds serialize. Kill compiler after completion; compilation failure preserves running widgets. Re-run real Wordle and final suites after this adjustment.
