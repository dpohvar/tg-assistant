# Active WebSocket Implementation Plan

**Execution status (2026-10-10):** implementation complete. Transport/config/storage/commands/runtime refresh and review fixes are committed in feat/websocket-mcp. The original checklist below is retained as the planning record; final delivered files and verification are recorded in [../../websocket-mcp-check-results.md](../../websocket-mcp-check-results.md). Live probes are consolidated in test/live/websocket-mcp.mjs, websocket-tls.mjs and mcp-failure.mjs. No merge/push is included in this task.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if explicitly selected. Steps use checkbox syntax for tracking.

**Goal:** Агент открывает WebSocket, получает короткие уведомления и извлекает текст/бинарные сообщения из буфера; админ управляет соединениями.

**Architecture:** WebSocketManager контроллера владеет сокетами, буферами и TTL; Codex получает только динамические инструменты и короткие события через существующий AgentQueue. Файловые операции используют BotFiles; сокет никогда не считается фоновым ходом Codex.

**Tech Stack:** Node >=24.18.1, ws 8.22.0 (точная зависимость), node:test, Alpine Docker, текущий Codex App Server.

**Spec:** [../../websocket.md](../../websocket.md).

## Global Constraints

- 10 записей на агента, включая closed; 1 MiB буфер; 10 MiB входящее сообщение.
- Binary: записать, если до записи файлов ≤10 MiB, иначе skipped; максимум 20 MiB.
- Closed TTL 1 час, не продлевается; общая .temp очистка 24 часа по mtime.
- .temp/AGENT_ID/websocket/CONNECTION_ID; Git исключает .temp; соседний агент недоступен.
- close сохраняет данные; delete удаляет запись/буфер/оставшиеся файлы.
- URL и секреты не включать в list, уведомления, ошибки или инструкции.
- Не менять лимит 10 chat-событий, cron, межагентный протокол, sandbox или typing.
- Только документы на стадии плана; реализация начинается после принятия плана.

## Предлагаемые уточнения для принятия вместе с планом

1. Записи/буферы в памяти, без миграции для WS; восстановление после рестарта отсутствует.
   На старте очищать только выделенные websocket-поддиректории прошлых запусков
   безопасными файловыми операциями; другие temp и wiki не затрагивать.
2. ws_open принимает также необязательный headers: string map. URL/headers агент
   может собрать внутри JS из vault_get. Возврат и события не содержат credentials.
3. binary files, выданные ws_pull, остаются в директории соединения и удаляются
   при delete/TTL. Для долговременной работы агент заранее переносит их.
4. notifications source='websocket' не входят в chat limit; ready coalesce по
   connectionId. Устаревшие ready подавляются admit-проверкой; closed/deleted
   сохраняют минимальные ID/reason после удаления записи.
5. Ошибки: websocket_not_found, websocket_closed, websocket_limit,
   websocket_connect_failed, websocket_send_failed, invalid_argument;
   всегда английское безопасное description.

## Review Focus

1. Админ удаляет сокет одновременно с message callback: поздний callback не воскрешает запись.
2. Агент подменяет бинарную директорию symlink: контроллер не пишет/удаляет вне sandbox scope.
3. Данные пришли между pull и постановкой ready: нет потерянного пробуждения или дубликатов.
4. Очистка temp удаляет бинарник до/после pull: корректный skipped/ошибка файла.
5. Агент/бот удалён во время handshake или send: нет доставки в чужой/новый scope.

## File map

- Create src/websocket/manager.mjs: соединения, буфер, counters, TTL, close/delete.
- Create src/websocket/files.mjs: безопасное хранение/подсчёт binary через BotFiles.
- Create src/commands/websocket.mjs: admin команды/форматирование, только текущий botId.
- Modify src/codex/threads.mjs, src/controller.mjs: tools, dispatch, lifecycle.
- Modify src/commands/router.mjs, contract.mjs, help.mjs: маршрутизация/справка.
- Modify package.json/package-lock.json; docs/websocket.md, commands.md, agent-contract.md.
- Create test/integration/websocket.test.mjs, websocket-files.test.mjs,
  websocket-controller.test.mjs, websocket-commands.test.mjs.
- Create test/live/websocket.mjs: конечный live probe, синтетические секреты.

### Task 1: Транспорт и конечные состояния

**Files:** manager.mjs, package files, test/integration/websocket.test.mjs.
**Interfaces:** WebSocketManager({botsDir,clock,onEvent,createSocket?});
open(scope,{url,description,headers?})->Promise<{connectionId}>;
list(scope), pull(scope,{connectionId,count}), send(scope,args)->Promise;
close(scope,id,{reason?}), delete(scope,id,{reason?}), closeAgent(agentId),
deleteAgent(agentId), deleteBot(botId), sweep(now), shutdown().
scope содержит botId/agentId; admin targeting отдельно проверяется controller.

- [ ] Написать тест локального WebSocketServer: text echo, frame fragmentation,
  delayed message, binary, send text/path, серверное close и повторный close.
  Основные assertions:
  ```js
  assert.equal(manager.list(scope)[0].status, 'closed');
  assert.equal(manager.pull(scope,{connectionId,count:1}).remaining, 1);
  assert.equal(events.filter(e=>e.eventType==='websocket_ready').length,1);
  ```
- [ ] Запустить `node --test test/integration/websocket.test.mjs`; подтвердить RED.
- [ ] Установить точный ws; использовать maxPayload=10*1024*1024,
  perMessageDeflate=false. Не хранить wire frame, headers/URL не включать в результат.
  open резервирует слот до handshake; параллельные open не обходят 10 записей.
- [ ] Считать Buffer.byteLength(text,'utf8'), реальные binary bytes и сериализованные
  metadata bytes; FIFO append/pull атомарны. Настоящий send успех — callback ws.send,
  не попытка вызова; большие/невалидные входящие сообщения завершают соединение.
- [ ] Тестировать 11-й open, exactly-limit, unicode, close с пустой очередью,
  late callbacks после delete, failed handshake освобождает reserved slot.
- [ ] Повторить focused тест до GREEN; commit транспорт и tests.

### Task 2: Binary files, buffer limits и TTL

**Files:** files.mjs, manager.mjs, websocket-files.test.mjs.
**Interfaces:** хранение использует BotFiles(root,agentId); файлы относительные,
IDs генерирует контроллер, не сервер. pull возвращает {messages,remaining}.

- [ ] Создать RED тесты: 10 MiB + 10 MiB допускается, следующий binary skipped;
  удаление агентом файла освобождает квоту; 1 MiB metadata/text закрывает сокет.
  ```js
  assert.equal(result.messages[0].reason,'binary_storage_full');
  assert.equal(result.messages[0].skipped,true);
  ```
- [ ] Реализовать сериализованную проверку фактического размера директории
  перед записью, O_NOFOLLOW/exclusive write через существующий BotFiles.
  Нельзя полагаться на cached binaryBytes: агент сам удаляет/переносит файлы.
- [ ] Тест symlink-подмены и path traversal; проверка не следует чужим ссылкам.
  Файловую ошибку безопасно отразить как skipped либо закрытие с понятной причиной.
- [ ] Fake clock: повторный close не меняет closedAt; до 1 часа запись существует,
  в 1 час удаляется и испускает deleted expired. TTL sweep работает независимо
  от суточной retention, таймер unref, shutdown его снимает.
- [ ] cleanTemp удаляет старый файл: pull возвращает file_expired; отсутствие
  после pull — обычная ошибка чтения. delete удаляет только ещё находящиеся здесь файлы.
- [ ] Run `node --test test/integration/websocket-files.test.mjs test/integration/websocket.test.mjs`;
  GREEN, commit.

### Task 3: Агент, уведомления и lifecycle

**Files:** threads.mjs, controller.mjs, manager.mjs,
websocket-controller.test.mjs, agent-contract.md.
**Interfaces:** dynamicTools ws_open/list/pull/send/close/delete; controller.invoke
берёт scope из текущей авторизованной сессии, никогда из arguments.

- [ ] RED integration tests: соседний агент не может list/pull/send/delete;
  busy агент получает ровно один ready в очереди, payload там отсутствует.
- [ ] Ввести schemas точных инструментов; в tool descriptions указать FIFO,
  destructive pull, файлы/TTL, запрет печати секретных URL/headers, использование
  code-mode для больших потоков. ws_send требует ровно text либо path.
- [ ] При onEvent поставить source websocket с admission проверкой agentEnabled,
  bot/agent generation и существования connection для ready. Не переносить
  старый ready в новый контекст; delete отменяет queued ready по connectionId.
  Для closed/deleted уведомлений хранить исходный owner, не искать его по записи.
- [ ] Close при clear/stop, delete при удалении чата/агента/бота; shutdown прекращает
  callbacks до закрытия БД. Новые соединения не позволяют старым callbacks пройти.
- [ ] Тест pull-to-empty + simultaneous arrival, clear в busy режиме, stop,
  delete bot во время opening, реальные binary send проверки BotFiles.
- [ ] Run `node --test test/integration/websocket-controller.test.mjs`; GREEN, commit.

### Task 4: Команды администратора

**Files:** commands/websocket.mjs, router.mjs, contract.mjs, help.mjs,
websocket-commands.test.mjs, commands.md.
**Interfaces:** handleWebSocketCommand({botId,message,args,manager,db,send});
использует общий parseTarget; admin access проверяется до lookup/mutation.

- [ ] RED: user/manager denied; owner/admin current/agent/in-chat target,
  cross-bot denied, отсутствие агента даёт понятный пустой результат.
- [ ] Реализовать `/ws [list [AGENT_ID|in CHAT_ID]]`, close/delete ID; reply,
  syntax errors с /help ws; компактная выдача с description/origin/status,
  openedAt, receivedBytes/sentBytes, queued/queuedBytes/binaryBytes.
- [ ] Внешняя строка description безопасно форматируется entities, без HTML
  конкатенации. Не показывать URL userinfo/path/query или callback error text.
- [ ] Тест admin close -> closed admin, delete -> deleted admin и отмена ready,
  mask canary secret в URL/headers; вывод обрезается по общему правилу команд.
- [ ] Run focused commands tests и существующий command-contract; GREEN, commit.

### Task 5: Полная и живая проверка

**Files:** test/live/websocket.mjs, docs/websocket-check-results.md.

- [ ] `npm test`, syntax check всех src, `git diff --check`.
- [ ] В Docker Alpine под обычным пользователем прогнать автоматические тесты.
- [ ] Live Codex в текущем tg-agent sandbox: open, vault-built URL, delayed ready
  реально запускает новый ход без Telegram/таймера модели, pull в JS печатает
  только итог, send ответ, binary read/send, admin close/delete.
- [ ] Проверить busy очередь, лимиты, reconnect как новое соединение, TTL fake
  clock; не ждать час в живом тесте. ws/wss проверить локальным TLS fixture
  с доверенным CA, не отключать certificate verification в продукте.
- [ ] Stop/clear не меняют typing при idle сокете; зафиксировать версию Codex,
  что протестировано реально и что mock. При сбоях не объявлять реализацию готовой.
- [ ] Остановить все процессы/контейнер, удалить synthetic secret, обновить docs.
  Финальный review; merge/push только при отдельной авторизации пользователя.
