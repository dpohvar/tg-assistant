# Протокол обсуждения React-сообщений

Начало обсуждения: 2026-10-11.

Это протокол проектирования, а не описание реализованного функционала. Реализация не начата. Последующие решения по этой теме записываем в этот файл, явно различая согласованные решения, предложения и открытые вопросы. Примеры API предварительные.

## Цель

Дать агенту возможность создавать интерактивные Telegram-сообщения, кнопки которых обслуживаются программой без обращения к модели. Примеры: ежедневная рулетка, голосования, пагинация. Обработчик может сохранять результаты, обновлять сообщение, отвечать на callback и при необходимости уведомлять агента.

Существующие кнопки передают нажатие агенту; новые обработчики должны экономить контекст и реагировать независимо от занятости модели.

Дополнительное требование пользователя (2026-10-12): агент должен простым способом готовить интерактивное сообщение с программной логикой. При выборе API учитывать вероятность ошибок при написании кода, скриптов и команд; React не является обязательным выбором.

### Предложение: варианты авторского API

Пока не согласовано. Рассматриваем три подхода: декларативный JSON со встроенными действиями, TypeScript-модуль с явными render/actions/state, либо TSX SDK. Рекомендация обсуждения: типизированный TypeScript API как основа, готовые помощники для частых сценариев и необязательный TSX позднее. JSON удобен для ограниченного набора готовых сценариев, но сложная логика может превратить его в отдельный язык программирования.

Для уменьшения ошибок предложены: один файл без ручной сборки и регистрации callback_data; стабильные имена действий; проверяемое сериализуемое состояние; получение пользователя и сообщения через контекст; встроенные проверки структуры, типов, прав и путей; предварительный рендер и тестовые нажатия в изоляции без реальных Telegram-эффектов. Конкретный API проверки и шаблоны ещё не определены.

## Согласованные решения

### Согласовано: все разрешённые Telegram преобразования типов (2026-10-12)

Пользователь подтвердил: в widgets разрешаем все переходы, которые позволяет Telegram, а не только переходы из проверенной матрицы. Матрица — доказательства/справка, не дополнительный allowlist приложения. Нормализуем render к соответствующему native edit method и input type, включая native live_photo как допустимую цель editMessageMedia; отсутствие реализации конкретного native input в SDK надо закрыть в плане, не выдавать за запрет Telegram. Правила альбомов/inline-mode, права и ограничения файлов сохраняются. Неподдерживаемый API переход возвращает ошибку без delete/resend; при успехе сохраняем messageId/widgetId и обновляем ctx.message по возвращённому Message. Непроверенный переход не объявляем гарантированно работающим. Runtime-код этой фиксацией не изменяется.


### Согласовано: финальные уточнения 2–6; преобразования типов исследуем (2026-10-12)

Пользователь принял рекомендации 2–6 из widgets-spec.md: остановка агента отключает его widgets с сохранением state/backlog; удаление агента удаляет регистрации, но не опубликованные сообщения; явное удаление Telegram-сообщения через controller удаляет регистрацию. При отсутствии соответствующего export накопленное событие пропускается со счётчиком, без неожиданного перенаправления модели. Poll-answer projection ограничивается с явной отметкой неполноты; полный voter-history не обещаем, отдельное query-хранилище при необходимости уточняется в плане. callback_data равно точному имени action export, без закодированных аргументов. Запрет workers — правило авторства и проверка прямых импортов, не гарантия OS-защиты от намеренного обхода arbitrary Node/npm.

Рекомендацию фиксировать тип сообщения пользователь отклонил: разрешаем native-преобразования, поддерживаемые Telegram. Поручено изучить разрешённые/запрещённые преобразования и проверить спорные случаи на живом стенде. Доказательства и матрица будут в widget-type-conversions.md; продуктовая реализация edit ещё не изменяется.


### Согласовано: административные команды /widget (2026-10-12)

Пользователь подтвердил приведённый набор команд. Все команды только для admin/owner текущего бота; не дают доступа к другим ботам. Селектор agent/in относится к владельцу виджета, а не к чату публикации. По умолчанию список относится к агенту текущего чата.

| Команда | Действие |
| --- | --- |
| `/widget`, `/widget list [RANGE]` | Виджеты агента текущего чата, active и disabled |
| `/widget list [RANGE] agent AGENT_ID` | Виджеты выбранного агента |
| `/widget list [RANGE] in CHAT_ID` | Виджеты агента выбранного чата |
| `/widget list [RANGE] all` | Все виджеты данного бота |
| `/widget show WIDGET_ID` | Метаданные: владелец, чат/сообщение публикации, topicId, handler, description, состояние, причина отключения, очередь |
| `/widget delete WIDGET_ID` | Удалить регистрацию, state и очередь; само Telegram-сообщение сохранить |
| `/widget delete *` | Удалить все виджеты агента текущего чата |
| `/widget delete * agent AGENT_ID` | Удалить все виджеты выбранного агента |
| `/widget delete * in CHAT_ID` | Удалить все виджеты агента выбранного чата |

RANGE и формат `FROM-TO / TOTAL` как в действующих командах. Список: code widgetId, italic status; следующая строка description; далее code agentId, code chatId/messageId публикации и размер pending queue. Сортировка oldest first. `/widget show` не раскрывает state автоматически: там могут быть секреты. Нет ручного stop/disable, restart/render/state-edit: восстановление и исправление остаются через set_widget/render_widget у агента. Нет глобального `/widget delete * all` в начальном наборе. Удаление выключает кнопки best effort, после удаления reply снова обслуживается обычным маршрутом. При административном удалении уведомляется агент-владелец. При удалении не обещать, что onStop закончит за 5 секунд: после grace period возможна остановка общего runtime и отключение остальных виджетов владельца.


### Согласовано: debug render для disabled (2026-10-12)

Пользователь подтвердил disabled режим render_widget. Разрешён одноразовый вычислительный render/publish отключённого widget, state explicit заменяет saved state, omitted использует saved; status остаётся disabled, кнопки не активировать, onInit не вызывать и backlog не проигрывать. Только sandbox владельца, без unrestricted выполнения в controller. render_widget возвращает принятие, не ждёт render; на async failure уведомляет владельца, успешный render сам по себе не возобновляет handler. Продолжение обычной обработки выполняется set_widget. Debug execution не даёт права обойти process/memory quota и watchdog, точное использование общего runtime при наличии/отсутствии active widgets согласовать в финальном spec. Для not_found/deleted или delivery_unknown с неизвестным messageId — ошибка, не новая send.

### Уточнение пользователя: fire-and-forget render_widget со state (2026-10-12)

Пользователь заменил предыдущее предложение forced render: render_widget({widgetId,state?}) предназначен для отладки после ошибок, не ожидает исполнения render. Переданный state заменяет целиком, отсутствующий использует текущий. Ответ инструмента означает принятие задания, не успешную публикацию. Это supersedes предложение awaited render_widget, direct ctx.api self shortcut и dependency-cycle guard специально для render: общий render_widget в agent tools/ctx.api возвращается после enqueue; ctx.render() внутри handler сохраняет отдельно ранее принятый awaited save/render контракт.

Предлагаемые уточнения, пока не приняты: входной state проверить до принятия (JSON, <=1 MiB); применить замену при исполнении задания в единой FIFO, затем commit before render/publish по прежнему контракту. При активном handler задание не прерывает его, так старый auto-commit не перезапишет state, установленный одновременно инструментом. Queue_full/not_found/oversized validation errors возвращать при submission; render/Telegram error после принятия сообщать владельцу, не скрывать за успешным enqueue. Возвращаемое полезное значение не нужно (void).

Для заявленной отладки после render error нужен disabled target. Предложение: разрешить одноразовый render disabled из saved/переданного state в прежней sandbox владельца без activation, без onInit/timers/проигрывания backlog; status остаётся disabled, callback кнопки остаются disabled/не dispatchятся, queue сохраняется. Success не активирует регистрацию; для возобновления отдельно set_widget. Для deleted/not_found или delivery_unknown без messageId — submission error, не новая отправка. Требуется sandbox runtime для вычисления JS render; загрузка snapshot может выполнить top-level/import code, не обещать отсутствие side effects произвольного module. Runtime квота и прекращение временного debug исполнения нужно согласовать в spec, не запускать unrestricted evaluator в контроллере. Этот disabled debug режим — рекомендация из цели пользователя, а не уже подтверждённое поведение. Не восстанавливать недействительный старый ctx посредством debug render.

### Согласовано: first-send failures; предложение forced render (2026-10-12)

Пользователь принял предыдущие три случая first send: confirmed Telegram rejection возвращает ошибку и освобождает resources/provisional quota; known sent message + failure onCreate/render оставляет disabled регистрацию с known messageId и уведомляет агента; uncertain delivery не auto-resend, disabled registration с messageId:null, delivery_unknown, description/handler/last saved state. Agent может читать state/delete, а если actual messageId выяснился — attach новую регистрацию. Resume без messageId ошибочен, не является повторной отправкой. Кнопки неизвестного сообщения best effort нельзя обещать выключить без его id; dispatch не активен. Final implementation должна учесть send/DB ack gaps, не обещает exactly-once creation.

Следующее предложение forced render, ещё не принято: render_widget({widgetId}) применим только к active registration, возвращает void после успешного render/edit (или отказ от edit если representation unchanged); disabled -> widget_disabled, отсутствующая -> widget_not_found. Вызов извне handler владельца попадает в единую FIFO queue target widget как контроллерное render задание, ждёт своей очереди и завершения; вызывает render из последнего committed state на момент исполнения. Не отдельный user export/system action, не подделка event от агента; widget registry/hooks не позволяют нажатиями вызвать render. Queue_full отдаётся вызывающему инструменту, не потеря задания. Same-widget ctx.api.render_widget вызывает ctx.render напрямую внутри текущего handler, включая текущий working state и обычный save-before-publish контракт, чтобы избежать ожидания собственной очереди. Same-widget ctx.render — рекомендуемый короткий способ. Concurrent requests не получают автоматическое coalescing/dedup. Внешний render без изменённого content всё равно повторно вычисляет render, но не обязательно вызывает Telegram edit.

Важно для согласования: cross-widget render является awaited queued operation, поэтому взаимные A->B->A вызовы могут deadlock при нескольких awaiting handlers; heartbeat не обнаружит async deadlock. Предложение защитить controller wait dependencies от cycles и возвращать widget_call_cycle, не тайно повторять/откладывать операцию. Это не меняет принятый self-render direct shortcut и self-replace teardown exemption. Другая допустимая альтернатива: cross-widget forced render возвращает только accepted enqueue, как widget_event, тогда await не означает завершённый edit. Нужно выбрать sync-result contract vs accepted-only прежде final spec; не заявлять обе semantics одновременно. Рендер при ошибке использует ранее принятое onError/disable, не вызывает бесконечный onError/render recursion.

### Следующее предложение: first-send failure / uncertain delivery (2026-10-12)

После уточнения description пользователь спросил о следующей теме. Предложение для согласования: first send с подтверждённым Telegram rejection не создаёт active регистрацию, возвращает ошибку и освобождает provisional quota/resources; если messageId уже достоверно известен и onCreate/render после отправки не удался, сохранять disabled с known messageId/saved state и уведомлять агента, как ранее принято. Если запрос мог быть принят, но ответ потерян (timeout/connection failure), автоматически не повторять send и не запускать onCreate: сохранять provisional widget как disabled с messageId:null, description, handler snapshot и last saved state, reason delivery_unknown. Widget slot занят, runtime при отсутствии других active не нужен. Возвращать ошибку с widgetId/неопределённым исходом; агент может прочитать saved state и удалить provisional регистрацию. Возобновление по widgetId при неизвестном messageId не должно неявно отправлять ещё одно сообщение. Если фактический messageId позже выяснился, новая attach регистрация через set_widget({messageId,handler,description,state}) после удаления provisional; отдельный repair-ID API пока не вводить.

Это дизайн, ещё не принят. Последние известные внешние effects не откатываются. Telegram buttons у unknown message невозможно обещать отключить без messageId, но widget handler не dispatchится; неизвестный message не считается безопасно удалённым из Telegram. onCreate failure after known send не повод повторять первую отправку. Точный storage phase/ack gap и поведение при crash между send success и DB commit должны войти в итоговую implementation plan; нельзя обещать exactly-once Telegram message creation.

### Согласовано: обязательное description при create/replace (2026-10-12)

Пользователь уточнил: description обязателен при создании И замене виджета; назначение — восстановление понимания агентом после compaction. Сохранять description в registry, всегда выводить в widgets() вместе с идентификаторами/status. Это не Telegram message text, не временный runtime comment; metadata живёт с active/disabled registration до delete. Валидация непустой строки (не только whitespace) и инструкция автору указывать назначение/основное поведение нужны в будущей реализации.

Уточнение ранее предложенного unified set_widget: create нового Telegram message / attach к обычному message требует handler + description; replace активного widget требует description даже если handler сохраняется. Обновление handler отключённого widget также считается заменой и требует description. Простое resume disabled без нового handler сохраняет existing description, повторять его необязательно. Explicit state при resume без изменения handler по-прежнему заменяет saved state, само по себе не объявляет операцию replace. Это supersedes прежнюю optional description на любом existing widget. Если отсутствие handler/description или их сочетания делают режим неоднозначным, вернуть syntax/schema validation error, не угадывать назначение widget из file path. Уточнение resume/replace boundary отражает текущие ранее принятые режимы; не вводить дополнительный инструмент или aliases.

### Согласовано: latest-known reaction/poll projections; следующая тема tool schemas (2026-10-12)

Пользователь подтвердил poll предложение: до onReaction/onPoll/onPollAnswer подставлять ctx.message с latest-known controller state. message.poll — последний полный native Poll snapshot, message.pollAnswers — последние известные ответы участников, обновляется до onPollAnswer; не инкрементировать native snapshot totals вслепую и не обещать полный voter registry. Canonical saved message обновлять при приёме update независимо от disabled/capacity queue. Старый backlog event не повторяет projection delta и не откатывает свежий снимок. Это закрывает poll предложение выше; exact pollAnswers shape/size/retention остаётся частью финального schema design, а не обещанием неограниченного хранения.

Следующее предложение для согласования — единые tool schemas. set_widget({widgetId?,messageId?,chatId?,handler?,description?,state?,...creationOptions}) возвращает {widgetId,chatId,messageId}; widgetId выбирает существующую owner регистрацию и не комбинируется с messageId/chatId/topicId, цель определяется из registry. messageId выбирает сообщение, chatId default=current owner chat; если оно уже widget, применить resume/replace по status, иначе attach. Без widgetId/messageId create; handler/description обязательны, state default {}. На существующем widget отсутствие handler/description/state сохраняет saved значения; explicit state заменяет целиком. topicId и прочие agreed send creationOptions — только при создании нового сообщения. delete_widget({widgetId}) => void, widget_state({widgetId}) => saved JSON state, widget_event({widgetId,name,data?}) => void после принятия enqueue, не ожидания выполнения handler; queue_full/widget_disabled/oversized errors не скрывать. render_widget({widgetId}) — принудительный render active по принятому контракту, exact scheduling/return уточнить. widgets() => {canCreate,items}, fields списка по принятой структуре. Для lookup через widgetId owner check обязателен; имена и схемы одинаковы в agent tools и ctx.api. Отсутствие output при self-delete не трактовать как synchronously finished teardown.

Возможные pending вопросы после схем: исход первой Telegram send при timeout/неизвестном messageId, форсирование render из собственного handler/другого widget, byte budget message.pollAnswers projection, disabled queue topic/reply routing и окончательная сборка spec. Этот перечень не означает пересмотр уже принятых default send topic/options или marker источников.

### Уточнение: ctx.message перед reaction/poll handlers (2026-10-12)

Пользователь согласился с остальными event примерами и потребовал до onReaction обновлять ctx.message, чтобы reactions уже отражали известные актуальные изменения. Спрашивает о той же гарантии для poll/poll_answer. Принятое требование reaction трактуем как freshest known controller snapshot, не real-time Telegram oracle: updates могут задерживаться/быть неполными. Reactions уже имеют локальный recordReaction aggregator с counts/users/own/updatedAt/countsComplete; не изобретать нативное Telegram Message.reactions поле или автоматически объявлять counts полными. Controller canonical message обновляется при приёме update независимо от наличия active handler и capacity widget queue; перед dispatch получать актуальный снимок, не повторять дельту из delayed event поверх уже сохранённого состояния. Старые events не откатывают свежую message projection.

Предложение для poll, пока не принято: native poll snapshot по poll.id сопоставлять с owning message, обновлять сохранённый ctx.message.poll до onPoll. Для poll_answer Telegram даёт только poll_id, user/voter_chat и новый выбор option_ids/option_persistent_ids, а не totals/options snapshot. Перед onPollAnswer сохранить известный последний выбор этого voter (включая отзыв), обновить ctx.message на последнее доступное сообщение/полный poll snapshot и local voter-answer projection. Не гарантировать, что native poll.voter_count/total_voter_count уже включают этот ответ, не прибавлять его к counts вслепую: poll snapshot мог уже содержать голос, предыдущий выбор может быть неизвестен. Предлагается отдельное локальное расширение message.pollAnswers для последних известных ответов (точная форма и partial marker ещё обсуждаются), native message.poll оставить authoritative last received Poll. Completeness реестра ответов не обещать; dropped widget events не должны препятствовать обновлению canonical saved message. Первичное заполнение/retention answer projection и bounded size требуют согласования, pollAnswers не предлагать как полный список участников голосования. Отдельного getPoll в актуальной Bot API reference нет. Current polling.mjs не подписывается на poll/poll_answer, нужна будущая реализация subscriptions/routing, а не изменение working docs сейчас.

Источники проверки: https://core.telegram.org/bots/api#poll, https://core.telegram.org/bots/api#pollanswer, https://core.telegram.org/bots/api#messagereactionupdated, https://core.telegram.org/bots/api#messagereactioncountupdated; src/messages/reactions.mjs и src/telegram/polling.mjs. Предложенные message projections ещё не реализованы.

### Event examples requested by the user (2026-10-12)

Пользователь оценил предложенный envelope как приемлемый и попросил примеры для всех источников. Сохранили [8 sources и варианты Telegram identity](widget-event-examples.md): button, reply, reaction (individual/count), poll, poll_answer, agent, widget, local. Native data сверили с актуальной Bot API reference, payload сокращён в примерах и не является новым whitelist. Для local timer/WS источники не расширять отдельными типами: script вызывает enqueue. Для delayed backlog сохраняется original receivedAt. Event names для Telegram hook примеров — onReply/onReaction/onPoll/onPollAnswer; общие exported action names для button/agent/widget/local. Это иллюстрации предложенного контракта; точные tool parameters и reset counters ещё уточняются.

### Согласовано: queue byte budget; следующий вопрос — event envelope (2026-10-12)

Пользователь принял 64 KiB UTF-8 JSON на одно внешнее event и 8 MiB суммарного JSON payload сохранённой внешней queue widget, при общем count limit 1000. При capacity overflow пропускать новые и считать dropped; oversized agent/widget request возвращает явную ошибку. Media binary не копировать в event, использовать file/message identifiers, детали получать read(). Durable queue извлекать постепенно, не загружать весь backlog в runtime. Byte limits не применять JSON.stringify к произвольным local ctx.enqueue JS values: для них остаются count limit и внешний runtime memory monitor. DB record/index overhead не входит в payload budget. Это закрывает предложение byte numbers выше.

Следующее предложение единого event envelope, ещё не принято: {name,source,receivedAt,delayed,data}; receivedAt — исходный ISO UTC timestamp при приёме контроллером (для local — при enqueue), delayed — true для сохранённого backlog, доставленного после возобновления; обычное ожидание занятого handler само по себе не delayed. sources button/reply/reaction/poll/poll_answer/agent/widget/local. Custom event name маршрутизируется к соответствующему exported handler; системные onReply/onReaction/onPoll/onPollAnswer — к своим Telegram hooks. Telegram data содержит native payload соответствующего update без придумывания неизвестного user identity; для agent/widget/local data — исходный пользовательский payload. Для button event.user и event.respond() как ранее принято, respond callable не сериализуется, при backlog callback не доставляется. Для реакции/опроса не обещать user, если Telegram его не предоставляет. Для widget-origin event добавить fromWidgetId, для agent-origin не открывать чужую private информацию. lifecycle onInit/onCreate/onStop/onError остаются отдельными hooks, не имена callback buttons. Пример может быть компактным; native payload подчиняется принятому byte budget.

Proposal backlog counters: ctx.queueInfo {pending,dropped}, dropped cumulative since registration creation и не сбрасывается чтением; те же поля в widgets() для инспекции. Именно форму счётчиков, их reset/generation semantics и external event routing/source-validation согласовать отдельно. Системный source задаёт контроллер, caller payload не может подменять envelope. Local arbitrary references не превращать в durable serialized payload ради общего envelope.

### Согласовано: durable external queue и отсутствие automatic retry; предложение byte budget (2026-10-12)

Пользователь подтвердил правила предыдущего раздела: принятые внешние replies/reactions/agent/other-widget events сохраняются в БД; ещё не начатые остаются для resume после disable/crash. Callback events после disable/crash не воспроизводить. Local ctx.enqueue с произвольными JS values хранится в RAM и теряется при unload/crash. Начатое событие при аварии автоматически не повторять из-за частичных effects, уведомить агента для ручного решения. Общая queue capacity 1000 ожидающих событий, не 1000 отдельно на каждую storage queue. Disabled resume сохраняет внешние pending, active replace сбрасывает pending, delete удаляет pending/state. Обычное transport dedup не добавляется; это правило recovery, не гарантия exactly-once.

Следующее предложение для согласования: ограничить сериализованный внешний event payload до 64 KiB UTF-8 JSON, общий payload budget внешней DB queue одного widget до 8 MiB вместе с существующим count limit 1000. Предел относится к JSON payload, DB row/index overhead сверх него; local arbitrary JS values нельзя надёжно измерить JSON.stringify без изменения семантики, поэтому byte budget не применяем к ним, их общий расход покрывает runtime monitor 256 MiB. При превышении capacity пропускать новый event и увеличить dropped counter без удаления старых; oversized agent/widget_event request возвращает явную ошибку, не подтверждение принятия. Durable queue не грузить целиком в runtime: выдавать очередной event, сохраняя FIFO с RAM queue. Media bytes в event не включать, передавать attachment/file/message identifiers, детали доступны read(). Byte numbers и предел event size ещё НЕ согласованы; допустимость oversized Telegram event и нужная форма envelope остаются следующими вопросами. Product implementation отсутствует.

### Согласовано: self-replace; следующий вопрос — pending/in-flight queue (2026-10-12)

Пользователь подтвердил описанный порядок self-replace: инвалидировать старый ctx, cleanup без ожидания suspended current handler, запустить новую версию, затем разрешить await set_widget; старые render/enqueue ошибочны, поздний auto-commit/render пропускается, поколения различаются даже при том же widgetId. Остановка ctx не означает preemption unmanaged JS. Это закрывает открытый вопрос self-replace; self-delete по-прежнему void.

Следующее предложение для согласования: сохранять в БД внешние сериализуемые replies/reactions/agent/other-widget events, принятые в active очередь, как и disabled backlog; после выключения сохранить ещё НЕ начатые такие события, при активации проиграть FIFO с delayed marker. Callback events не восстанавливать после отключения/аварии; disabled callbacks вообще не принимаются. Local ctx.enqueue payload (произвольные JS values/references, local timers/WS) остаётся RAM и не переживает unload/crash; не обещать сериализацию замыканий/ресурсов. Очередь 1000 — единый предел ожидающих событий, не добавлять независимые 1000 DB + 1000 local. При начале исполнения внешнее событие помечать in-flight/убирать из pending атомарно; event, уже начавшееся при аварии, автоматически НЕ повторять: эффекты могут быть выполнены частично, сохранённое состояние и уведомление помогают агенту решать вручную. Это не deduplication: повторные доставленные нажатия/events по-прежнему разрешены по прежнему решению, но crash не инициирует автоматический retry.

Предложение различать resume и replace: set_widget на disabled сохраняет внешнюю pending queue; полная замена active регистрации по принятому контракту сбрасывает pending очередь. Delete удаляет все pending events и saved state. Подтверждение durable active queue и точная транзакция start-event пока не получены; recovery состояния in-flight и размер/byte budget очереди детализировать после решения пользователя. Текущий consensus требует durability disabled backlog, не следует выдавать этот новый active persistence вариант за уже принятый.

### Уточнение пользователя: awaited self-replace и инвалидированный ctx (2026-10-12)

Пользователь отклонил отложенный немедленный возврат при self-replace: async set_widget должен ждать удаления старой регистрации и запуска новой, даже если target — текущий widgetId. Старый ctx помечается stopped/deleted; его render/enqueue возвращают ошибку. Это supersedes прежнее предложение deferred self-replace и прежнее false для enqueue stopped: queue_full по-прежнему false, stopped/deleted — явная ошибка. Self-delete сохраняет ранее принятый немедленный void.

Необходимое следствие реализации: при self-replace teardown НЕ ждёт завершения текущего handler, который suspended на том же set_widget RPC; иначе возникает deadlock. Ждать cleanup (onStop/disposable, бюджет 5 s) и создание новой версии, затем разрешить awaited set_widget старому handler. Его дальнейшее выполнение технически возможно, но старый ctx недействителен; automatic state commit/render по завершении старого handler пропустить. Системный teardown/onStop выполняется при suspended старом handler, что уточняет прежний общий запрет concurrent teardown с handler. Нельзя просто сохранить старое ожидание handler и добавить stopped flag: такой flag сам не разрешает взаимное ожидание.

Предложение guard: неизменяемый generation token привязать к ctx и RPC; новая версия имеет новый token, даже если видимый widgetId/messageId сохранён. Поздние timers/events/RPC replies/auto-commit старой версии не воздействуют на новую. Единственный уже принятый lifecycle set_widget RPC должен завершиться несмотря на инвалидирование caller ctx/abort signal, последующие эффекты старого ctx отклоняются. Ресурсы, закрывающиеся при onStop, могут отклонить pending фоновые операции; cleanup error handling не должен инициировать ошибочное отключение новой версии. Произвольный unmanaged Node-код/FS/network не прекращается магически от пометки ctx, его cleanup/cancellation остаётся ответственностью скрипта и общим sandbox/monitor. Generation implementation и запрет поздних прочих ctx.api calls пока детализировать в spec; не выдавать ctx flag за preemption JavaScript.

### Согласовано: ожидание удаления и void при self-delete (2026-10-12)

Пользователь подтвердил сокращённое graceful ожидание до 5 s и уточнил контракт вызова. При delete извне текущего widget и при replace set_widget ждёт завершения удаления/очистки старой регистрации. 5 s — общий бюджет текущего handler/onStop/disposable cleanup, а не гарантированное полное время RPC: подтверждение принудительного завершения процесса и controller cleanup могут занять немного больше. Telegram keyboard disable остаётся best effort отдельно от безопасности и прекращения dispatch. При истечении бюджета аварийно завершить общий runtime; остальных активных widgets отключить, целевой удаляемый widget удалить по принятому намерению. Replace продолжает создание новой регистрации после завершения удаления, только при возможности запуска/квоты.

При self-delete ctx.api.delete_widget возвращает void (RPC promise разрешается без полезного значения) после принятия удаления, не ожидая handler/cleanup. Контроллер гарантирует исполнение принятого намерения, даже если handler не завершится: revoke/events/timers/abort сразу, cleanup после выхода handler либо force-kill при deadline. Ошибки проверки до принятия не скрываются. Поздний auto-commit/render удаляемого handler не может восстановить регистрацию/state. Предложение реализации: намерение удаления зафиксировать durable до ответа и завершать при recovery, чтобы авария/рестарт не восстановили target как disabled/active. При whole-runtime crash прочие widgets disabled, но target с принятым delete остаётся deleted. Это не обещание продолжения работы при permanently unavailable controller/storage.

Открытая отдельная деталь: self-replace через set_widget из собственного handler тоже не может ждать завершения себя. Пользователь описал немедленный void только для self-delete; исключение для self-replace/его запрет пока не согласованы. Не объявлять синхронное awaited self-replace работающим. Для внешней замены/удаления ждать teardown действительно требуется; concurrent operations одного message/registration должны сериализоваться. Exact quota освобождение during teardown ещё подлежит финальному spec.

### Обсуждение: длительность удаления (2026-10-12)

Пользователь спросил о времени удаления и сокращении ожидания. Текущее согласование задаёт 30 s суммарного ожидания текущего handler/onStop/disposable cleanup, после чего аварийно завершается общий runtime. Это максимум ожидания, не обязательная задержка; если handler отсутствует и cleanup быстр, завершение раньше. Вызовы Telegram для кнопок выполняет основной контроллер best effort отдельно; сетевой ответ не должен удерживать прекращение маршрутизации/права старой регистрации.

Предложение, пока не принято: разделить немедленное логическое удаление (нет новых widget events/ordinary effects, cancel managed timers, abort ctx.signal, message routing становится ordinary) и асинхронное завершение resources (дождаться handler, onStop, disposable cleanup). Сократить deadline явного delete с 30 до 5 s; при превышении аварийно завершить весь runtime и отключить остальные widgets агента по согласованной процедуре. Не выполнять onStop одновременно с текущим handler; abort является кооперативным, произвольный код индивидуально не прерывается. Для self-delete возвращать принятие операции сразу, не ждать собственного завершения. Promise RPC acceptance и окончательное завершение различать в результате. Освобождение quota в процессе удаления и возможность создания новой регистрации на том же messageId до завершения cleanup требуют согласования, чтобы не создавать неограниченные retiring handlers или параллельные операции замены. Сокращение deadline отменит прежние 30 s только после подтверждения пользователя.

### Согласовано: set_widget и полный widget API внутри ctx (2026-10-12)

Пользователь выбрал set_widget вместо send_widget для единого create/attach/resume/replace и явно потребовал доступ к тем же инструментам внутри widget ctx. По ранее согласованной структуре ctx.api предоставляем set_widget, delete_widget, widgets, widget_state, widget_event, render_widget с одинаковыми аргументами/результатами/ошибками, как у agent tools. Это расширяет прежний перечень ctx.api; отдельные activate_widget/stop_widget/send_widget aliases не вводим. Контроллер связывает calls с owner-agent регистрации, проверяет актуальные scope/quota/permissions; собственный widget не получает прав чужого агента. При самоуправлении идентификатор регистрации доступен в ctx.widgetId, Telegram message отдельно в ctx.message. Формат ctx.widgetId — идентификатор из registration tools; окончательную схему результата set_widget уточнить в общем API spec.

Следующий вопрос, предложение ещё не принято: self-delete/self-replace нельзя выполнять ожиданием текущего handler внутри awaited RPC — получится deadlock. Для таких calls немедленно подтвердить принятие операции, запретить дальнейшие события/effects старой регистрации, окончательный cleanup/смену handler выполнить после выхода текущего handler (с принятой 30 s deadline). Подтверждение принятия не называть завершённым удалением. Семантика подтверждения и очереди self-render/self-event/cross-widget calls требует отдельного согласования; не добавлять скрытое ожидание обработки widget_event получателем. Сами методы доступны по прямому требованию пользователя, эта техническая деталь пока не выбрана.

### Согласовано: единый метод; обсуждение имени set_widget (2026-10-12)

Пользователь принял объединение активации с send_widget: без messageId создать новое сообщение, на обычном messageId подключить widget, на disabled возобновить с сохранением saved state/backlog, на active заменить по прежнему контракту с очисткой ожидающей queue. Для новой регистрации handler/description обязательны; для существующей можно опустить handler/description/state и сохранить прежние значения. Переданные значения заменяют прежние. Failure активации оставляет disabled и backlog (с ранее оговорёнными ограничениями на откат уже saved/external effects). Отдельный activate_widget исключён.

Пользователь предложил переименование общего метода: set_widget / use_widget / activate_widget / start_widget. Рекомендация, пока НЕ принята: set_widget, поскольку устанавливает/обновляет widget на сообщении и при отсутствии messageId создаёт новое сообщение; это покрывает create/attach/resume/replace без акцента только на отправке или запуске процесса. use_widget менее явно описывает effect, activate_widget акцентирует лишь resume, start_widget приемлемая альтернатива, но хуже выражает замену handler/state. После выбора одинаковое имя использовать в dynamic tools, ctx.api и SDK/reference; старое send_widget — только историческое имя протокола, runtime alias пока не предлагался.

### Предложение пользователя: активация через send_widget (2026-10-12)

Пользователь предложил исключить отдельный activate_widget и объединить его с send_widget. Рекомендация для согласования: единый send_widget({messageId?,chatId?,handler?,description?,state?,...creationOptions}). Для нового/обычного сообщения handler и description обязательны, state по умолчанию {}; для существующей widget регистрации эти поля можно опустить и использовать сохранённые snapshot/description/saved state. Если status=disabled, send_widget запускает onInit/render без onCreate и сохраняет durable backlog/dropped counters, затем проигрывает его по ранее принятому порядку. Explicit handler заменяет immutable snapshot, explicit state заменяет целиком; отсутствие сохраняет прежнее. Для active полная замена по ранее принятой семантике (cleanup старого handler, новая runtime-регистрация на том же messageId) сбрасывает pending queue. Прежние creation-only options не разрешаются для существующего messageId. При неудаче восстановления disabled сохраняет status/state/backlog, за исключением уже явно зафиксированных промежуточных изменений по общему save/render контракту; не обещать транзакционного rollback внешних effects. Активация без process slot возвращает ошибку, сохраняет disabled. Отдельного activate_widget нет в предложенном API. Различие поведения queue по текущему status должно быть явно описано; новые параметры resetQueue/manual disable сейчас не вводим. Это ещё предложение, требует согласования пользователя.

### Согласовано: active / disabled / deleted и backlog; следующее обсуждение tools (2026-10-12)

Пользователь подтвердил предыдущую таблицу и предложенные детали lifecycle. Active и disabled вместе занимают до 10 widget slots агента; deleted не занимает quota, state/регистрация удаляются, вечная deleted-запись не нужна. Disabled не исполняет handler, сохраняет saved state; обычное отключение освобождает managed timers/sockets/disposable resources, process runtime завершать при отсутствии active widgets и освобождать process quota. Unhandled render error отключает один widget; авария общего процесса отключает все его widgets. При аварии уведомлять агента. Manual disable tool не нужен. После delete Telegram message остаётся обычным и replies идут обычным маршрутом; callbacks выключать best effort.

Callback disabled не ставить в очередь; пустым answerCallbackQuery убирать client spinner. Agent/other-widget event возвращает widget_disabled. Controller commands в reply имеют приоритет и не идут в backlog. Replies/reactions disabled хранить в БД, без trigger модели. При активации onInit (не onCreate), успешное восстановление отображения, затем FIFO backlog с original timestamps и delayed marker. Не воспроизводить пропущенные callbacks/timers. Queue limit 1000: новые сверх лимита пропускать, считать dropped и сообщать при активации. Детали byte budget, envelope counters и pending/in-flight событий активной очереди при аварии ещё открыты; принятие delayed backlog не даёт exactly-once или сериализацию произвольных локальных JS объектов.

Следующее предложение tools, ещё не принято: widgets() возвращает {canCreate,items} только своих active/disabled регистраций, в items добавляет queuedEvents/droppedEvents и reason disabled; widget_state(widgetId) читает saved state. activate_widget({widgetId,handler?,state?}) применима к disabled: без handler сохранить текущий immutable snapshot, с handler собрать новую версию для ремонта; omitted state сохраняет последний saved state, explicit state заменяет целиком, backlog сохранять. Сначала проверить/собрать и атомарно занять process slot при необходимости, затем init/render и active; при failure оставить disabled и backlog. delete_widget({widgetId}) удаляет active/disabled регистрацию и очередь, освобождает slot, сохраняет Telegram message обычным; для active выполняет принятый cleanup deadline. send_widget остаётся create/attach/replace по messageId, поэтому различить repair activation с backlog и полную замену регистрации с очисткой queue. Поведение activate_widget для уже active и окончательное именование tools требуют согласования. Старый stop_widget исключить в пользу delete_widget; ручное disable не вводить.

### Новый вариант пользователя: active / disabled / deleted (2026-10-12)

Пользователь предложил пересмотреть ранее согласованную модель stopped/failed и её квоты. Новый контракт для обсуждения: active и disabled занимают widget quota (вместе максимум 10 на агента); deleted означает удаление регистрации/state, сообщение снова обрабатывается как обычное, replies проходят обычную агентскую маршрутизацию. Disabled хранит saved state; callback-нажатия игнорируются (не ставятся в очередь), кнопки по возможности отключаются. Replies к disabled не триггерят агента, а накапливаются для widget; реакции также копятся. События от агента/другого widget disabled не принимает. Агент может активировать disabled; ручного метода disable не нужно. При сбое контроллер может отключать widget вместо удаления и уведомляет владельца, например при аварийном завершении общего процесса или ошибке render. Это предложение отменяет необходимость отдельного failed статуса: причина ошибки хранится как причина disabled.

Предлагаемые следствия, ещё не согласованы: disabled не имеет работающего handler/timers/sockets; при обычном отключении освобождать их через onStop/disposable, при аварии процесс уже уничтожен. Process quota используется только агентами с active widgets; после исчезновения последнего active runtime завершать, disabled records сохранять и считать в widget quota. widgets() возвращает active/disabled и причину отключения, canCreate учитывает обе категории; deleted не хранить как вечный tombstone и не показывать. Удаление освобождает widget slot, disabled — нет. Отдельная activate_widget(widgetId) сохраняет состояние/сообщение и запускает onInit без onCreate; если процессной квоты нет, вернуть ошибку и оставить disabled. Названия и схема активации/удаления инструментов требуют отдельного согласования; stop_widget более не должен подразумевать удаление или ручной disable.

Очередь disabled нуждается в отдельном durable механизме контроллера (предлагается БД), поскольку runtime может отсутствовать. Только внешние сериализуемые Telegram events; произвольные JS references, локальные timer/WS events прежней in-memory queue не сериализовать и не обещать восстановить после гибели процесса. Предложение: при активации выполнить onInit и успешный render, затем обработать накопленные события FIFO с исходными timestamps и явной отметкой delayed, не воспроизводить callbacks или пропущенные timers. Обычные controller commands сохраняют приоритет и не идут в widget backlog даже если отправлены reply. Предел 1000 ожидающих событий сохраняется; при overflow отклонять новые, сохранять старые и считать dropped, а при активации показывать число пропусков обработчику/агенту. Byte limit, counters envelope, pending events активной очереди при отключении, обработка текущего in-flight event и ошибки активации остаются открытыми. Не создавать автоматический retry события, чьи эффекты могли уже состояться. Эти следствия — предложения, не реализация и не окончательно согласованный lifecycle.

### Уточнение пользователя: компактный widgets() и необходимость stopped history (2026-10-12)

Пользователь исключил quota.used/remaining дублирование и весь вывод quota.processes: агенту не нужны сведения о процессах других агентов. Для результата widgets() оставляем canCreate и items, без quota. canCreate по-прежнему вычисляется контроллером с учётом обеих квот; текущий активный runtime может принимать новые widgets независимо от отсутствия свободного process slot. Это заменяет предыдущую предложенную форму quota.

Пользователь спросил о необходимости хранения stopped registrations. Оно не нужно для очистки ресурсов, quota enforcement или восстановления active widgets после обычного restart. Ранее принято ради инспекции widget_state()/причин остановки и удобного ручного подключения с прежним saved state. Новое предложение, пока не принято: widgets() показывает только active, при stop удаляем регистрацию/состояние из БД после завершения cleanup, Telegram message сохраняем с отключёнными кнопками; повторный send_widget на messageId — новая регистрация с явно переданным state либо {}. Агент/скрипт сохраняет долгосрочные игровые данные отдельно в файлах, а не полагается на stopped widget state. При аварии уведомить агента о причине и затронутых widget IDs/сообщениях; автоматического восстановления аварийно остановленных нет. Предыдущее согласование хранения stopped registrations остаётся действующим до явного выбора пользователя; вопрос не трактуем как разрешение их удалять.

### Согласовано: stopped-регистрации; предложение widgets() (2026-10-12)

Пользователь принял предыдущее предложение lifecycle: при остановке последнего активного widget завершать общий runtime агента и освобождать process quota; stopped/failed регистрации сохранять с handler reference/version, description, последним saved state, chatId/messageId и причиной остановки. Они не занимают active quota и доступны через widgets()/widget_state(). Для возобновления новая регистрация создаётся через send_widget на прежнем messageId. После аварии не включать автоматически; после обычного рестарта сервера восстанавливать только ранее active регистрации. Предыдущее описание как неподтверждённого предложения теперь заменено этим согласием.

Предложение widgets(), пока не принято: без аргументов возвращает только регистрации владельца-агента, включая stopped/failed; quota.widgets {used,limit,remaining} для active widgets этого агента и quota.processes {used,limit,remaining} для логических widget runtimes всего бота. canCreate = оставшиеся widget slots, если текущий runtime active; если runtime ещё нет и у бота нет process slot, canCreate=0. При наличии process slot создание первого widget запускает runtime. Не раскрывать списки/состояние/чаты других агентов; общие числовые квоты допустимы. items: widgetId, description, status active/stopped/failed, chatId, messageId, topicId если есть, stopReason null либо код причины. Не возвращать state, исходники или секреты в list. Пример используется для согласования формы, точные коды причин и формат идентификатора пока не утверждены. Отправляющие/управляющие инструменты должны возвращать widgetId и принимать его как идентификатор регистрации; точные схемы остальных tools уточнить отдельно.

### Согласовано: период memory monitor; предложение о stopped-регистрациях (2026-10-12)

Пользователь принял предложенный период внешнего мониторинга памяти 500 ms, независимый от heartbeat 5 s. Это закрывает открытый вопрос периода выше. Монитор читает OS-показатели вне handler runtime, учитывает runtime/потомков; не запускает PowerShell на каждое измерение. Конкретная метрика и технический учёт потомков подлежат проверке при реализации, не являются уже работающей гарантией.

Следующая тема, предложение ещё не принято: после успешной остановки последнего активного widget общий runtime завершать и освобождать process quota; stopped/failed регистрации хранить без процесса вместе с последним saved state, handler reference/version, description и идентификаторами Telegram-сообщения, не учитывать в active quota. Сохранённые records нужны для widgets()/widget_state и подключения новой версии через send_widget на прежнем messageId. После аварийной остановки автоматически не включать; при обычном рестарте сервера восстанавливать только регистрации, которые оставались active. Дополнительный срок хранения/удаление stopped записей ещё не согласован. widgets() должен показывать свои регистрации/причины остановки и квоты, но не чужую private информацию; детали ответа — следующий раздел обсуждения.

### Согласовано: пересмотр квот и проверка memory enforcement (2026-10-12)

Последующее решение пользователя: ограничение общей памяти выполняет внешний монитор контроллера; Job Object/cgroup hard memory enforcement не вводим. Допускается кратковременное превышение между измерениями. Это мониторируемый порог 256 MiB на agent-widget runtime, а не гарантированный OS hard cap. Sandbox остаётся обязательным и не заменяется этим монитором. При обнаружении превышения применяется согласованная аварийная остановка всех widgets владельца, деактивация/освобождение квоты, best-effort отключение кнопок и уведомление агента без автоматического перезапуска.

Предложение, ещё не принято: период проверки памяти 500 ms, независимый от heartbeat 5 s; измерять вне процесса обработчиков OS-показатели runtime и его потомков, не доверять присланному скриптом memoryUsage. Реализовать без запуска PowerShell/внешней утилиты на каждое измерение. Конкретная кроссплатформенная метрика и надёжный учёт дерева процессов остаются деталями реализации для проверки; не суммировать rss, heapUsed и external как независимые части, поскольку они перекрываются. Решение внешнего монитора отменяет прежнюю рекомендацию добавлять OS hard backend в первой версии; V8 heap CLI limit не заменяет монитор и его дополнительное значение пока не согласовано.

Пользователь принял 256 MiB на общий widget runtime агента вместо прежних 256 MiB на каждый widget. Изменил квоты: до 10 активных widgets на агента внутри одного общего процесса; до 10 widget runtimes на бота (один runtime на одного агента), потенциально до 100 активных widgets на бота. Число 10 процессов относится к логическим agent-widget runtimes, не к вспомогательным OS-процессам Codex/sandbox или обычным модельным агентам. Старые 5 widgets/agent и 20 widgets/bot заменены. Общего лимита сервера по-прежнему нет. Детали освобождения пустого runtime остаются для уточнения; проверка квоты должна быть атомарной при параллельных созданиях.

Проверены варианты ограничения памяти: [report](widget-memory-limits-verification.md). --max-old-space-size не является общим лимитом: при heap limit 64 MiB проба выделила 320 MiB Buffer на Windows и Alpine. Внешний OS RSS monitor завершил тестовый процесс при пороге 128 MiB, с превышением между измерениями. Windows Job Object live-проверен с обычным Node и реальным MXC sandbox runner: allocation failure при job commit limit, который включает runner и payload. Linux cgroup v2 live-проверена отдельным Docker-контейнером с memory=256 MiB и без swap: OOMKilled/137. В существующем Alpine контейнере cgroup mount read-only; отдельная per-runtime cgroup требует delegation/helper или отдельно управляемого контейнера.

Выбор enforcement backend ещё НЕ согласован. Предложение: переносимый внешний монитор с более низким V8 heap limit; при доступном OS backend — Job Object / cgroup v2. Не выдавать monitor за hard cap, не скрывать разницу Windows committed memory / Linux cgroup memory и служебные накладные расходы. Hard-cap startup policy, deployment delegation и события job allocation failure требуют реализации и интеграционных тестов; product code не меняли.

### Согласовано: managed resources и аварийная остановка общего runtime (2026-10-12)

Последующее согласование пользователя: heartbeat общего event loop каждые 5 секунд; внешний контроллер аварийно завершает runtime после 10 секунд без heartbeat. При явной остановке widget общий предел ожидания текущего handler и очистки (onStop + disposable cleanup) — 30 секунд; по истечении аварийно остановить весь runtime виджетов этого агента по согласованной процедуре. Эти watchdog deadlines измеряет контроллер вне процесса обработчиков. Долгий async await при работающем event loop не считается зависанием; общий wall-time timeout обычного handler не вводим. Числа 1/30 секунд из предыдущего предложения heartbeat заменены на 5/10. Этот абзац закрывает указанные ниже открытые вопросы критерия зависания и предела явного stop.

Пользователь принял API ресурсов из предыдущего предложения: ctx.setTimeout/setInterval, ctx.clearTimeout/clearInterval, ctx.use(resource) для Symbol.asyncDispose/Symbol.dispose, ctx.defer(cleanup), ctx.signal. Ресурсы относятся к регистрации widget, не к одному handler вызову; при восстановлении создаются через onInit. Managed timers отменяются при остановке; callbacks используют enqueue. После завершения текущего обработчика вызывается onStop для специальной логики, затем в finally все зарегистрированные cleanup в обратном порядке; ошибка одного cleanup не отменяет остальные. AbortSignal отменяется при начале остановки. Нерегистрируемые ресурсы не получают гарантии автоматической очистки. Это заменяет прежнюю ручную очистку таймеров как обязательную часть onStop.

Пользователь согласовал аварийную остановку при зависании handler: принудительно завершить общий sandboxed процесс виджетов агента вместе с дочерними процессами, деактивировать все виджеты этого runtime, по возможности отключить callback-кнопки в их сообщениях и сообщить владеющему агенту об аварийной остановке. На onStop/dispose при таком завершении не рассчитывать. Кнопки отключает основной контроллер вне зависшего runtime. Сохраняется последнее зафиксированное state; опубликованные сообщения не удаляются. Остановка охватывает runtime одного агента, не всех агентов сервера. Автоматическое возобновление при зависании этим решением не задано; ранее принята остановка при memory limit без auto restart.

Открытый вопрос: критерий зависания. Предлагается внешний watchdog по heartbeat event loop, а не общий wall-time handler timeout, чтобы долгий await/сетевой запрос не считался зависанием. Конкретный heartbeat период/порог и срок ожидания при явном stop остаются предложениями для согласования. Работающий event loop при навсегда pending Promise не определяется как зависший по heartbeat; при явном stop потребуется отдельный предел ожидания cleanup/текущего handler.

### Уточнение: общий event loop и onStop (2026-10-12)

Новое предложение пользователя: ctx.setTimeout / ctx.setInterval и привязка disposable объектов к ctx. Предлагаемый API (ещё не принят): managed timers сохраняют обычную callback-сигнатуру, регистрируются за widget, автоматически отменяются при остановке; ctx.clearTimeout / ctx.clearInterval отменяют и снимают регистрацию, сработавший timeout освобождает запись. Callback, как и ранее, должен передавать работу через enqueue; wrapper сам не меняет FIFO-семантику или правило false при переполнении. Предложение для общих ресурсов: ctx.use(resource) возвращает тот же объект и регистрирует Symbol.asyncDispose либо Symbol.dispose; ctx.defer(cleanup) регистрирует sync/async cleanup для объектов без этих методов. Cleanup вызывается в обратном порядке, выполняются все зарегистрированные очистки даже при ошибке одной. Жизнь реестра равна жизни регистрации/runtime, а не одного handler вызова; ресурсы не сериализуются и восстанавливаются через onInit. Слово using внутри onInit не подходит для widget lifetime: оно освобождает ресурс при выходе из функции/блока.

Предлагаемый уточнённый stop: запретить новые события/регистрации ресурсов, отменить managed timers, инициировать ctx.signal.abort() для поддерживающих AbortSignal операций; дождаться активного handler, вызвать onStop для специфической логики, затем обязательно очистить зарегистрированные disposable ресурсы в finally. onStop остаётся необязательным и не должен вручную очищать стандартные managed timers. Использовать закрытие WebSocket через ctx.defer, поскольку close не следует автоматически считать подтверждённым завершением транспорта. Не обещать автоматическую очистку произвольных незарегистрированных Node timers/resources. Граница ожидания handler/cleanup и общий watchdog пока открыты. Источники: https://nodejs.org/api/timers.html#timeoutsymboldispose и https://github.com/tc39/proposal-explicit-resource-management.

Пользователь предложил onStop(ctx) для очистки ресурсов при выгрузке widget и запрет Workers. Фиксируем hook и запрет worker_threads для авторского кода/зависимостей как требования дизайна; конкретный механизм контроля ещё не выбран. Это не обещание, что фильтр импортов сам по себе обеспечивает запрет при произвольном Node-коде. onStop — системное имя, недоступное для callback-кнопок. Общий Node-процесс с event loop на агента становится целевым вариантом обсуждения; прежнюю остановку отдельного процесса нельзя считать реализуемой для одного widget в нём.

Предложение lifecycle, пока не принято: сначала прекратить приём событий, очистить ожидающую очередь и отозвать возможность обычных внешних эффектов регистрации; дать текущему обработчику завершиться, затем вызвать и await onStop(ctx), который удаляет таймеры, закрывает WebSocket и прочие ресурсы. После очистки освободить квоту и по возможности отключить кнопки. Hook также нужен при замене, остановке/удалении владельца и штатном завершении runtime; авария процесса не гарантирует вызов onStop. Проверка остановленного статуса должна отклонять enqueue/render/API даже у оставшегося таймера, однако не гарантирует освобождение таймера/сокета, если скрипт его не закрыл.

Открыты предел ожидания текущего handler/onStop, поведение при ошибке cleanup, общий memory limit процесса и технический запрет Workers. Синхронное зависание общего loop нельзя устранить hook или таймером в том же процессе: нужен внешний watchdog и перезапуск всего agent-widget runtime. Следующий предмет согласования — принимать ли общий перезапуск при невозможности выгрузить один widget. Никакой таймаут или автоматический перезапуск этим сообщением ещё не согласован.

### Регистрация и выполнение

- Агент создаёт TSX-файл, например `./react/startWheel.tsx`, с компонентом в `export default`.
- Инструмент `send_react` регистрирует обработчик и отправляет сообщение. Предварительный результат: `{messageId}`.
- `description` описывает назначение обработчика для агента и администратора; это не текст сообщения.
- Реестр связывает сообщение с обработчиком и его версией.
- React-сообщение работает, пока агент занят. У обработчиков отдельная от модели очередь выполнения.
- Обработчик может отправить агенту событие в обычную очередь. Уведомление явное и необязательное: пагинация обычно не требует вызова модели.
- Callback-действия вызываются на сервере; функции не передаются в Telegram.

```js
send_react({
  handler: "./react/startWheel.tsx",
  description: "Daily wheel and participation controls"
});
// → { messageId: 123 }
```

### Состояние и изоляция

- Сериализуемое состояние компонента сохраняется в БД и переживает перезапуск. Общая история игры хранится отдельно от состояния конкретного сообщения.
- Компонент не обязан постоянно работать в памяти: изолированный процесс запускается для рендера или действия и восстанавливает состояние.
- Нажатия одного сообщения обрабатываются последовательно. Для общего состояния нескольких сообщений нужны атомарные обновления.
- При регистрации сохраняется снимок кода и локальных зависимостей; изменение исходного файла не меняет уже опубликованные сообщения.
- Замыкания обработчиков восстанавливаются из кода, в БД сохраняются сериализуемые данные.
- Пермиты проверяет контроллер; скрипт дополнительно проверяет правила игры. Доступ к действиям контроллера ограничен правами создавшего сообщение агента.
- Агентский код не импортируется непосредственно в процесс сервера. Обработчик работает в песочнице без токена Telegram и прямого доступа к внутренней БД.

### Жизненный цикл

- `stop_react({messageId})` останавливает обработчик, оставляет сообщение и отключает его callback-кнопки.
- Обычный `delete({messageIds:[...]})` удаляет сообщение и связанную регистрацию.
- После перезапуска приложения действующие регистрации и состояние восстанавливаются.
- Обычный `edit()` запрещён, пока обработчик сообщения работает. После остановки доступно обычное редактирование.
- `/agent stop` останавливает обработчики этого агента, сохраняя данные игры.
- `/agent clear` очищает контекст модели и оставляет обработчики работающими.

Пользователь согласился с предложенной основой и жизненным циклом перед обсуждением отправки новых сообщений.

## Предложение: отправка сообщений из обработчика

Предложено разрешить отправлять обычные и новые React-сообщения. Пользователь пока не подтвердил этот раздел отдельно; просьба сохранить протокол не считается согласием с предложением.

```tsx
await ctx.send({ text: "Сегодня победил Игорь!" });

await ctx.sendReact({
  handler: "./react/winnerCard.tsx",
  description: "Winner details",
  props: { userId: winner.userId }
});
```

Предложенные правила:

- По умолчанию используется чат текущего React-сообщения. Другой `chatId` проверяется по существующим ограничениям агента.
- `props` — сериализуемые начальные параметры нового компонента, сохраняемые с регистрацией.
- Новое React-сообщение имеет самостоятельное состояние, обработчик и `messageId`.
- Остановка родительского обработчика не останавливает дочерние. `/agent stop` останавливает все обработчики этого агента.
- Отправленные сообщения сохраняются в истории. Отправка не триггерит модель без явного уведомления.
- `sendReact()` регистрирует компонент и выполняет первый рендер, но не запускает callback-действия.
- Отправка разрешена только из обработчиков действий, не из рендера: повторный рендер или восстановление иначе могут создавать дубли.

## Рассмотренные подходы

1. JS/TS-файлы с обработчиками: простой контракт, ручная сборка сообщения.
2. Собственный небольшой TSX SDK поверх runtime обработчиков: рекомендуемый подход обсуждения.
3. Готовый Telegram-фреймворк: возможна интеграция, но нужно сохранить существующие права, rich-сообщения и жизненный цикл контроллера.

Рассмотрены [grammY Menu](https://grammy.dev/plugins/menu) и [Teact](https://github.com/leuliance/teact). Совместимость с проектом не тестировалась; выбор зависимостей не утверждён.

Telegram требует подтверждения callback для снятия индикатора ожидания: [answerCallbackQuery](https://core.telegram.org/bots/api#answercallbackquery). Предложено быстро отвечать результатом короткого действия, а для долгого сразу подтверждать приём и затем обновлять сообщение. Точные сроки и контракт ответа ещё не определены.

## Текущий порядок оставшегося обсуждения (2026-10-12)

### Сверка отправки/редактирования перед проектированием render

Проверено по src/messages/actions.mjs, docs/messaging.md и Telegram Bot API (раздел Updating messages). Это справка о текущих возможностях, не согласование нового SDK и не live-проверка переходов.

- Текущий send поддерживает text/rich_message/photo/video/animation/document/audio/voice/video_note/sticker/location/venue/contact/poll/dice и альбом media. sendChecklist, sendPaidMedia, sendLivePhoto, sendGame, sendInvoice не входят в текущий инструмент.
- Telegram editMessageText обслуживает text/rich/game; имеет поля text или rich_message. Преобразование text ↔ rich следует проверить живым тестом перед обещанием в SDK.
- editMessageMedia заменяет photo/video/animation/audio/document (также native live photo), позволяет превратить text/rich в media. Обратный переход media → text/rich не заявлен этим методом. Текущий контроллер дополнительно запрещает смену типа, включая media → другой media.
- caption и форматирование редактируются отдельно, в том числе для voice; сам файл voice и video_note не входит в поддержанные editMessageMedia типы. sticker, venue, contact и dice не имеют метода редактирования своего содержимого.
- Native live location обновляется/останавливается отдельными методами в течение live_period; у текущего edit эти методы отсутствуют. Текущий sendLocation передаёт поля location напрямую, поэтому возможность передачи live_period на уровне запроса существует; это не полноценный согласованный live-location API.
- Inline-клавиатура может обновляться отдельно; reply-клавиатура не заменяет inline-клавиатуру для редактируемых сообщений. Альбом — несколько messageId, без общей клавиатуры; редактировать существующие элементы можно с ограничениями Telegram на media types, метода добавления элемента к отправленному альбому нет.
- Внутри rich можно заменить весь документ с картами/медиа/каруселями/кнопками без смены внешнего типа rich. Карта rich и самостоятельная live location — разные возможности.
- У native poll можно stopPoll, но не изменить вопрос/варианты; отдельный stopPoll не предоставлен текущим инструментом.
- Для нового SDK разрешение переходов между внешними типами ещё не выбрано. Автоматическое delete+send меняет messageId и связи ответов, поэтому не является прозрачной заменой типа.
- Источники: https://core.telegram.org/bots/api#editmessagetext, https://core.telegram.org/bots/api#editmessagecaption, https://core.telegram.org/bots/api#editmessagemedia, https://core.telegram.org/bots/api#editmessagelivelocation, https://core.telegram.org/bots/api#editmessagereplymarkup, https://core.telegram.org/bots/api#stoppoll.

1. Результат render для обычного текста, rich, медиа и native live location; inline-клавиатура; границы изменения типа уже отправленного сообщения.
2. Конкретный ctx: state, сведения о сообщении, api, постановка callback таймеров/WebSocket в последовательную очередь; форматы event и подписок на реакции.
3. init/onError: фиксация изменений состояния, сбой и восстановление процесса, политика reconnect и уведомления агента.
4. Медиа и файлы: локальные пути, Telegram file_id/источники, повторное использование и сохранность вложений после очистки temp.
5. Runtime и песочница Alpine/Windows, импорты/SDK, лимиты процессов, памяти, очереди и выполнения.
6. Административное управление, очистка регистраций/снимков, предварительная проверка агентского кода, затем цельная спецификация и план тестов.

Уже принятые решения не открывать повторно без выявленного противоречия. Следующие исторические списки/предложения показывают ход обсуждения; актуальные согласованные записи в «Дальнейшем ведении протокола» отменяют противоречащие им более ранние варианты (запуск процесса на каждое событие, отдельные attach/replace, ожидание действия перед заменой, fallback callback через 2 секунды).

## Первоначальные вопросы обсуждения (исторический список)

- Подтвердить правила отправки обычных и дочерних React-сообщений.
- Выбрать настоящий React либо совместимый по синтаксису TSX SDK; определить компоненты, hooks и API контекста.
- Определить хранение общего JSON-состояния и атомарность обновлений между сообщениями.
- Определить sandbox runtime на Alpine и Windows, разрешённые импорты, сеть, лимиты времени, памяти и очереди.
- Определить обновление зарегистрированной версии, хранение снимков и зависимостей.
- Определить поведение при ошибке, повторном callback, сбое после записи состояния или отправки сообщения.
- Определить судьбу остановленных регистраций, возобновление и очистку, включая удаление истории через 30 дней.
- Определить административные команды просмотра и остановки обработчиков.
- Определить формат уведомления модели и обработку события при остановленном агенте.

## Дальнейшее ведение протокола

### Согласовано: квоты и наблюдаемость; обсуждение экономии runtime (2026-10-12)

По запросу пользователя выполнен синтетический memory benchmark трёх Node-архитектур, 1/5 widgets, три повторения, Windows и Alpine: [методика и результаты](widget-memory-verification.md). Предположение пользователя подтвердилось: общий event loop существенно экономнее. Для пяти простых widgets Workers экономят около 5% Alpine PSS относительно процессов; Windows private commit примерно на 9% больше. Общий loop экономит около 72% PSS / 80% private commit. Это не измерение готового widget runtime или sandbox-wrapper. Предыдущая рекомендация Workers как способа экономии памяти требует пересмотра; их достоинство — независимое выполнение и остановка. Архитектура ещё не выбрана. Общий loop потребует согласовать общую судьбу процесса при зависании и отказ от строгого отдельного process-memory лимита widget.

Дополнительное предложение, пока не принято: сравнить отдельные Node-процессы с одним sandboxed Node-процессом на агента и отдельным Worker на widget. Общий event loop для всех widgets не рекомендован: синхронный бесконечный цикл блокирует всех, принудительная остановка одного обработчика не обеспечивается. Worker сохраняет Node API и собственную локальную очередь с произвольными JS-значениями; межпоточные сообщения сериализуются отдельно. Worker не является границей безопасности ОС. Общий процесс сохраняет риск общего OOM/native crash; resourceLimits ограничивает JS heap, но не ArrayBuffer и всю память процесса. Прежний строгий целевой предел памяти на отдельный widget нельзя автоматически перенести на Worker. Дочерние процессы потребуют отдельного учёта при остановке.

QuickJS — альтернативный лёгкий JS engine, но не замена Node с совместимыми API. Понадобятся адаптеры файлов, таймеров, сети, WebSocket и RPC; произвольные Node/npm зависимости и native addons нельзя обещать. JSX можно предварительно скомпилировать для обоих вариантов. OS sandbox остаётся обязательным. Размещение QuickJS внутри Node сохраняет накладные расходы Node-host. Численную экономию памяти пока не измеряли. Предложение: перед выбором сравнить 1 и 5 idle/active widgets в Windows и Alpine, остановку зависшего worker и последствия нехватки памяти.

Источники: https://nodejs.org/api/worker_threads.html и https://bellard.org/quickjs/.

- Пользователь принял предложенные стартовые лимиты: 5 активных виджетов на агента, 20 на бота, сохранённый state до 1 MiB JSON, queue 1000, целевой предел памяти 256 MiB на widget с потомками; без общего wall-time таймаута обработчика. Принято предложенное поведение отказа создания/фиксации oversized state и остановки при memory limit без auto restart. Общий лимит виджетов на сервер НЕ вводить.
- Агент должен уметь посмотреть свои уже созданные виджеты и доступную квоту, остановить ненужные для освобождения ресурса. Требуется новый list tool (предварительно widgets) с used/limit/remaining на агента и бота, widget ID/description/status/chat/topic/message; не раскрывать чужие private chat данные. Точная форма ещё обсуждается; stopped регистрации не занимают active slot.
- Пользователь предложил сравнить 1 процесс на все widget одного агента и более лёгкий JS-интерпретатор вместо Node. Это исследование вариантов, архитектуру per-widget process пока не заменяет; после выбора нужно пересогласовать memory/stop/failure boundaries и гарантию любых локальных JS payload.

### Согласовано: controller-owned sandbox runner (2026-10-12)

- Пользователь выбрал проверенный вариант с sandbox: контроллер запускает и сопровождает долгоживущий foreground Node через codex sandbox, не fire-and-forget shell-командой модели.
- На проверенном Windows использовать MXC (prefer_mxc + строгий профиль), протестированные Node loader flags/package scopes; на Alpine — проверенный Linux sandbox runner. При невозможности применить требуемую изоляцию отказать запуску, не выполнять обычный unsandboxed Node. Проверка совместимости на целевом окружении обязательна; успех текущих проб не означает поддержку произвольного Windows.
- Runtime не привязан к model turn и должен следовать согласованным правилам clear/stop/delete/restart. Это согласованный дизайн, реализация ещё не начата.
- Следующая тема: лимиты процессов/памяти/сохранённого state и поведение при превышении. Предлагаемые значения ещё не согласованы.

### Живая проверка двух Windows-направлений: MXC решает ограничения (2026-10-12)

- Пользователь запросил реальный запуск через инструмент агента и изучение настройки Windows/Codex. Выполнены обе проверки на dummy fixtures; детали дописаны в [sandbox report](widget-sandbox-verification.md).
- Без MXC отдельная app-server агентская сессия отказала уже на thread/start: legacy elevated не умеет reopen writable descendants под read-only carveouts. До Node/turn не дошло.
- На этом Windows build 28120.3181 уже работает MXC. Установленный Codex 0.159.3 имеет prefer_mxc; override --enable prefer_mxc включил его без обновления бинарника и без изменения глобального config. Для Node потребовались --preserve-symlinks/--preserve-symlinks-main и явные package scopes внутри разрешённого workspace, без расширения файловых прав.
- Standalone sandbox и настоящая native shell-команда отдельного Codex thread с MXC прошли 21/21 проверки. Проверена остановка Windows runner tree и natural foreground exit: родитель/обычный/detached потомки прекратили heartbeat.
- Реальная команда агента запустила detached/unref Node (BACKGROUND_STARTED=true), но после завершения команды/turn heartbeat остановился. Поэтому fire-and-forget процесс не годится как устойчивый widget runtime в проверенном MXC. Долгоживущий foreground sandbox должен принадлежать контроллеру, не активному model turn. Это рекомендация после probe, ещё не реализация/финальное согласование runner.
- Положительный результат отменяет прежний вывод о неподтверждённой Windows-изоляции в целом; legacy backend по-прежнему не годится. MXC availability на иных Windows и произвольные native addons/install scripts не проверялись. config.toml и установка Codex/Windows не изменялись; временные agent threads удалены.

### Обсуждение: запуск widget через shell-инструмент агента на Windows (2026-10-12)

- Пользователь предложил запускать долгоживущий Node через инструмент агента, рассчитывая на наследование его sandbox. Это кандидат, не принятое решение и не live-verified обход Windows ограничения.
- Проверено: агентские thread/start/resume получают permissions tg-agent; standalone Windows probe отказал тому же намерению restricted-read. Документация Windows подтверждает применение permissions к командам и дочерним процессам, но запуск через модель сам по себе не добавляет backend поддержку denied reads.
- Нужно отдельно проверить реальный инструмент агента на тех же dummy fixtures и поведение процесса при окончании shell-команды/turn, clear и закрытии app-server. Не выдавать работающий background command за доказательство confidentiality. Widgets должны переживать clear и восстанавливаться без обязательного запроса к модели.
- Текущий pendingChildren/hasBackground в src/codex/threads.mjs учитывает subagent threads, а не является универсальным реестром всех OS background процессов. Не утверждать без live-пробы, что любой background Node обязательно удерживает очередь либо обязательно переживает clear.

### Живая проверка runner Windows/Alpine (2026-10-12)

- По просьбе пользователя проведены bounded live-пробы с dummy-файлами через standalone codex sandbox, без обращения к реальным секретам и без изменения работы бота. Отчёт: [Widget sandbox verification](widget-sandbox-verification.md).
- Alpine 3.24.2 / Node v24.18.1 / Codex 0.159.3: 21/21 проверки доступа/runtime прошли; отдельная остановка runner process group прекратила heartbeat родителя, обычного дочернего процесса и detached child. Импортированный синтетический npm-пакет и child Node не прочитали соседний fixture; symlink не обошёл изоляцию. Это кандидат runner, не готовая реализация виджетов/не исчерпывающее доказательство безопасности npm.
- Windows Codex 0.159.3: elevated backend требует :root read, unelevated отклоняет restricted reads. Оба отказали до запуска Node. Не включали full-read/unrestricted fallback; безопасный native Windows runner не подтверждён.
- Начальная Alpine ошибка helper исправлена добавлением read для реальной директории Codex runtime /opt/codex/bin, без разрешения соседних/server файлов. ENOENT для скрытых путей признан отказом после проверки их существования вне sandbox; исходные dummy-файлы не изменились.
- CPU/memory, install scripts/native addons, IPC/SDK и полный widget lifecycle остаются для последующей реализации/проверок. Нельзя переносить положительный Linux результат на native Windows.

### Согласовано: npm только внутри проверенной песочницы (2026-10-12)

- Пользователь согласен на npm-пакеты, но требует убедиться, что их выполнение не выходит из песочницы. Свободный импорт не означает доверие пакетам; сами пакеты/их зависимости выполняют код.
- Проверка текущего кода: createSession в src/codex/threads.mjs задаёт named permissions для Codex tg-agent (bot workspace + own temp, deny .git/foreign temp, minimal/runtime reads, сеть включена). Эти настройки не применяются автоматически к Node, запущенному controller spawn. Изоляция виджета должна быть реально применена launcher ОС и наследоваться дочерними процессами.
- Локальный codex sandbox --help подтверждает standalone запуск команды под Windows sandbox и выбор permission profile. Это кандидат для runner, не доказательство изоляции виджетов или Linux-совместимости; механизм ещё не выбран. Docker daemon доступен (read-only docker version проверен), живые sandbox пробы виджета ещё не проведены.
- Обязательная будущая проверка Windows/Alpine: разрешённые файлы и сеть работают; соседний бот, чужой temp, server config/DB/sessions недоступны на чтение/запись; symlink/абсолютные пути/дочерние процессы не обходят запрет; не наследуются env-секреты/посторонние дескрипторы; stop завершает потомков. Сборка/установка зависимостей также не должна исполнять недоверенный код в привилегированном controller процессе.
- Предложение: если применить требуемый профиль нельзя, отказать запуску виджета, не fallback на обычный node. Это ещё проектная конкретизация, требует включения в спецификацию и live acceptance, не утверждение о реализованной защите.

### Согласовано: очередь, переполнение и отсутствие дедупликации (2026-10-12)

- Внешние события поступают в ту же очередь виджета, что и локальные. Пользователь принял пункты 1–5: до 1000 ожидающих событий на widget; при переполнении отклонять новое, сохраняя FIFO; ctx.enqueue возвращает true/false без ожидания исполнения; callback при переполнении по возможности получает ответ о занятости; widget_event от агента возвращает queue_full.
- Таймеры из onInit и локальные WebSocket скрипта вызывают enqueue и при переполнении получают false. Автоматически уведомлять агента о таком переполнении не нужно; скрипт сам решает, пропустить/сохранить/повторить событие или явно вызвать notify_agent. Controller-owned ws_* здесь не подразумеваются и остаются вне базового API виджета.
- Пользователь исключил дедупликацию в механизме виджетов: зарегистрированные события поступают как есть, без фильтрации повторов по update/callback ID или совпадающим данным. Несколько нажатий могут быть намеренными; одноразовость, повторы и бизнес-правила обрабатывает скрипт. Это отменяет ранее предложенный пункт 7 и не меняет проверки реестра кнопок/системных имён.
- Ранее согласована потеря локальных событий при завершении процесса. Отдельная политика долговременного хранения внешних событий явно не утверждена этим согласием с пунктами 1–5; не выдавать предложенную memory-only внешнюю очередь за дополнительное принятое решение.

### Следующее обсуждение: очередь и переполнение (2026-10-12)

- Уже принято: последовательное исполнение; локальные события могут содержать любые JS-значения и теряются при завершении процесса. Не открывать эти решения повторно.
- Предложение для первой версии, пока не согласовано: внешние ожидающие события также держать в памяти, не воспроизводить после restart; лимит 1000 ожидающих событий на widget (текущее выполняемое событие не считается); при переполнении сохранять существующую FIFO, отклонять новое.
- Предложение результата enqueue: синхронный boolean (true принято, false переполнение) без ожидания обработчика. Внешний widget_event получает queue_full, callback — по возможности короткий ответ о занятости. Переполнение источников без вызывающего клиента сигнализировать владельцу-агенту один раз на эпизод, а не на каждую потерю.
- Дедупликация по доступному транспортному идентификатору Telegram update/callback в рамках живой регистрации; различные нажатия не считать дублем по совпадающему callback_data. Детали durable event policy, лимита памяти процесса и восстановления требуют отдельного согласования.

### Согласовано: кнопки виджета без permits и непрозрачных ID (2026-10-12)

- Пользователь исключил встроенные permits для кнопок виджетов. Проверка пользователей/ролей/участия выполняется самим скриптом, при необходимости через user_roles/members. Обычные агентские кнопки не меняются. Более ранние упоминания widget permits неактуальны; виджетный render не должен обещать controller authorization по permits.
- Не вводить обязательные непрозрачные callback ID: callback_data сохраняется в авторском виде. Контроллер ведёт реестр кнопок конкретного виджета/сообщения и отклоняет незарегистрированные нажатия; не вызывать произвольный named export по входной строке.
- Системные имена render/onInit/onCreate/onReply/onReaction/onPoll/onPollAnswer/onError запрещены для callback-действий, даже если указаны в кнопке. Ошибка обнаруживается при подготовке render.
- Реестр связан с widget + chatId + messageId, а не глобален по имени. Предлагаемая конкретизация: сопоставлять фактически опубликованную строку callback_data целиком и хранить её соответствие action/payload; детали представления payload уточняются отдельно. Не превращать это предложение о точном сопоставлении в требование пермитов или opaque ID.
- Удаление/отключение кнопки и остановка/замена обработчика отзывают записи; callback lookup/системные имена — проверки контроллера, пользовательские права — ответственность скрипта. Это решение отменяет предыдущую рекомендацию о непрозрачных идентификаторах и permits в реестре.

### Предложение: реестр действий кнопок (2026-10-12)

- Пользователь предложил запоминать callback_data кнопок и при нажатии разрешать только зарегистрированные действия, чтобы произвольный callback не мог вызвать экспорт render/tick и другие функции.
- Предлагаемая реализация: при render извлекать действия callback-кнопок (inline и rich), проверять экспорт и запрет системных имён, создавать записи с widget/message/chat, действием, payload и permits. Telegram callback_data содержит непрозрачный идентификатор, а не произвольное имя экспорта; controller разрешает его через реестр и проверяет сообщение/пользователя/актуальность до enqueue.
- Отдельные пути dispatch: callback — только через реестр кнопок; локальный enqueue/событие агента — именованные действия согласно собственному контракту. tick допускается как callback лишь если явно назначен кнопке; render и lifecycle/system hooks не допускаются как callback вообще.
- Удалённые/отключённые действия и токены прежнего обработчика перестают работать. При обновлении Telegram ошибка/неизвестный результат публикации требует согласованности реестра с реально опубликованными кнопками; детали атомарности и допустимой старой версии уточнить в спецификации. Не обещать, что любое изменение render требует инвалидировать все неизменившиеся кнопки.
- Неразрешённое/устаревшее нажатие не вызывает экспорт или модель; по возможности ответить callback коротким сообщением. Это обсуждаемое предложение, не реализация.

### Согласовано: подписки; предложение плоских экспортов (2026-10-12)

- Пользователь принял автоматические подписки по наличию обработчиков reply/reaction/poll/poll_answer, маршрутизацию именованных событий к их обработчику, сохранение native Telegram payload в event.data и общий конверт name/source/время получения. Отсутствующий обработчик не создаёт подписку. Reply сохраняет согласованное обычное поведение/приоритет команд; реакции/опросы сами не запускают модель, только явный notify_agent.
- Пользователь предложил все функции на одном уровне: export render(state), onInit(ctx), onCreate(ctx), onReply(ctx,event), onReaction(ctx,event), onPoll(ctx,event), onError(...), вместо объекта handlers и прежних init/created.
- Предлагаемое дополнение, пока не согласовано: onPollAnswer(ctx,event); именованные действия остаются прямыми named exports, например export vote(ctx,event), export tick(ctx,event), ctx.enqueue('tick',data) вызывает tick. Render/lifecycle/system event names выделены SDK и не считаются произвольными действиями. Плоская структура меняет только интерфейс объявления, не порядок запуска/семантику state/errors/subscriptions.

### Согласовано: название widget (2026-10-12)

- Пользователь выбрал widget: агенту можно поручить «создай виджет». Это финальное кодовое название механизма, вместо react/interactive.
- Использовать send_widget/stop_widget/widget_state/widget_event/render_widget; ctx.api.send_widget создаёт/подключает/заменяет виджет по согласованному единому контракту. ctx.api.react сохраняет значение Telegram-реакции. TSX/JSX и ранее согласованная архитектура не меняются вследствие переименования.
- Старые названия в исторических разделах протокола означают те же операции и не являются дополнительными API/алиасами. Полное переименование документов и окончательный SDK contract выполняются при подготовке цельной спецификации.
- Следующая тема для обсуждения: автоматические подписки по наличию handlers.reply/reaction/poll/poll_answer и формы event. Маршрутизация reply и приоритет команд ранее уже согласованы; повторно их не открывать.

### Согласовано: состав API; совместимость и новое имя (2026-10-12)

- Пользователь принял предложенную таблицу включения/исключения инструментов ctx.api, включая отмеченные «Добавить» и vault_get с правилами неразглашения.
- Пользователь просит сохранить формат существующих методов, чтобы агенту не требовалось повторное обучение. Цель: одинаковые имена, схемы параметров, результаты, ошибки и проверки прав через общий controller dispatch; не копировать отдельную реализацию. Новые удобные формы медиа/JSX не подменяют молча существующий контракт этих методов.
- Требуется явно описать scope/default chat для cross-chat регистрации; сохранение контракта означает не подменять автоматически текущий чат владельца-агента на чат публикации. В примерах для адресации сообщения использовать явный chatId. Эта деталь ещё обсуждается.
- Пользователь отметил конфликт слова react с существующим инструментом Telegram-реакций. Предложение, пока не утверждено: механизм назвать interactive, инструменты send_interactive/stop_interactive/interactive_state/interactive_event/render_interactive; ctx.api.react остаётся реакцией Telegram. Исторические react/send_react в протоколе не являются утверждёнными финальными именами.

### Согласовано: базовый ctx.api; сравнение инструментов (2026-10-12)

- Пользователь принял ctx.api.send/send_react/edit/delete/notify_agent/stop_poll/stop_live_location и сохранение текущих прав создавшего агента без выдачи bot token/raw Telegram client. Активное интерактивное сообщение редактируется своим render, не обычным edit. Остановка скрипта и native live location — разные операции.
- По запросу пользователя добавить ctx.api.react с параметрами агентского react, для постановки/снятия реакции.
- Актуальный список controller dynamicTools проверен в src/codex/threads.mjs. Следующие дополнительные включения/исключения — предложения, пока не согласованы:
  - Добавить copy/forward/pin/unpin для управления сообщениями; read/history/search/topics для пагинации и истории; user_roles/members/chat_info/user_photos для актуальных ролей и профилей; download для Telegram файлов; chats для поиска доступных направлений.
  - vault_get полезен для API/WebSocket авторизации, предложено включить с теми же правилами неразглашения, без помещения секрета в state/render/уведомления.
  - agents/agent_info/agent_message: пока оставить агенту; notify_agent покрывает связь с владельцем обработчика.
  - note_get/note_set, schedule/tasks/cancel_tasks и git_changes/git_sync: пока оставить агенту, не смешивать собственный state/таймеры интерактивного сообщения с общей памятью и планировщиком модели.
  - ws_open/list/pull/send/close/delete: текущие controller-owned WebSocket имеют собственную очередь/уведомления модели; локальные сокеты Node уже согласованы. Не подключать этот набор автоматически без отдельного решения о маршрутизации событий.
  - browser_read/pdf_read: отдельное возможное расширение, не обязательно для первой версии. time заменяется Date; rich_help — документацией SDK; save_image относится к зарегистрированным результатам генерации модели.
- Инструменты оболочки/генерации/MCP самого Codex не входят в этот dynamicTools список и не становятся автоматически ctx.api.

### Согласовано: обработка ошибок onError (2026-10-12)

- onError(ctx, error, event) вызывается после восстановления последнего сохранённого state; выполненные внешние эффекты не откатываются.
- Возвращённое true означает handled, уведомление владельцу-агенту не требуется. Любой другой результат или отсутствие onError означает уведомление владельца-агента.
- После успешного onError изменения state сохраняются и рендерятся по обычным правилам обработчиков. При ошибке самого onError или его рендера уведомить агента без рекурсивного вызова onError.
- Ошибка отдельного события не останавливает процесс и не запускает автоматический повтор события. При гибели процесса контроллер уведомляет агента, поскольку скрипт выполнить onError не может.
- Фоновые операции должны ловить ошибки и передавать их в очередь; необработанные ошибки фона также сообщать владельцу-агенту. Это не отменяет разрешённый пользователем обход очереди и не обещает rollback фоновых действий.
- Следующий вопрос: минимальный контракт ctx.api, доступные публикации/управление сообщением и уведомления владельца-агента. Предложения методов ещё не утверждены.

### Согласовано: параметры создания и message_effect_id (2026-10-12)

- Пользователь принял параметры send_react: handler, description, state, chatId, topicId, messageId, reply_parameters, disable_notification, protect_content. Имена reply/silent совпадают с текущим send; отдельные алиасы не нужны.
- Добавить message_effect_id и в send_react, и в обычный send; это согласованный будущий scope, не утверждение о текущей реализации. Соблюдать native ограничения эффекта и типа отправки.
- Контент, клавиатура, permits и форматирование задаются render. Creation-only параметры не меняются рендерами; при attach/replace переданные creation-only параметры отклонять, а не игнорировать. Business/paid broadcast/ephemeral сообщения в эту задачу не включать.
- Следующее предложение для обсуждения: контракт onError, handled и фиксация state, ошибки фона/render/runtime. Конкретные правила ещё не согласованы.

### Согласовано: данные локальной очереди; обсуждение параметров создания (2026-10-12)

- Пользователь принял любые JS-значения в локальном ctx.enqueue, передачу по ссылке и потерю локальной очереди при завершении процесса. Внешние события через RPC и сохраняемый state остаются сериализуемыми.
- Пользователь запросил параметры создания, включая reply и silent. Предложение: сохранить имена текущего send — reply_parameters, disable_notification, protect_content; поля регистрации handler/description/state/messageId/chatId/topicId. message_effect_id возможен как отдельное расширение SDK с native ограничениями. Контент/клавиатура/permits/форматирование остаются результатом render; параметры первой отправки не становятся редактируемыми свойствами сообщения. При attach/replace не принимать creation-only параметры вместо молчаливого игнорирования. Это предложение ещё не принято.
- Native envelope проверен по Telegram Bot API sendMessage/ReplyParameters; business/direct messages/ephemeral/suggested posts/paid broadcasts существуют, но не означают их поддержку текущим контроллером или согласованное расширение scope.

### Согласовано: единая очередь именованных событий (2026-10-12)

- Уточнение пользователя: не вводить технический запрет на изменение state/render из таймеров или фоновых async функций в обход очереди. Инструкция рекомендует enqueue; автор скрипта отвечает за намеренный обход и возможные гонки. Это отменяет предложение ниже о запрете/проверке такого доступа.
- Обсуждение данных enqueue: предложение — локальная очередь внутри живого Node-процесса принимает любые JS-значения, без сериализации; payload передаётся по ссылке, события/замыкания не восстанавливаются после завершения процесса. Внешние события контроллера/агента ограничены сериализуемым транспортом, сохранённый state остаётся сериализуемым. Пользователь ещё не согласовал эту развилку и потерю локальной очереди при restart.
- Обработчики имеют форму handlers.name(ctx, event); ctx содержит state/message/сервисные методы, event — источник и данные. Для callback доступны пользователь и event.respond().
- ctx.enqueue(name, data) ставит событие в последовательную очередь без ожидания завершения обработчика. Контроллер задаёт происхождение внешних событий; агент может отправлять именованные события извне. Локальные таймеры и WebSocket ставят события через enqueue.
- Пользователь уточняет: можно ли менять state/render прямо из setInterval и освобождать очередь через фоновые async операции. Предложение, пока не согласовано: изменения state и render допустимы только в управляемом lifecycle/обработчике; таймеры только enqueue. Await внутри обработчика удерживает очередь до завершения. Фоновые операции без доступа к state/render могут вернуть результат или ошибку новым событием. Точная защита контекста от завершившихся async continuation и API фоновых задач ещё требуют спецификации.

### Согласовано: init, created и ctx.message (2026-10-12)

- Пользователь подтвердил: init вызывается при восстановлении процесса; created — при первой отправке.
- Хранить ctx.message. В init оно может быть пустым либо содержать сообщение; в created оно всегда непустое.

Пользователь согласовал следующий порядок и уточнения:

- Пустое значение определить как null. ctx.message — read-only последний известный native Telegram Message, а не только {messageId}; обычный полный ответ send/edit обновляет snapshot. Read-only не означает глубокую неизменность Node объектов автоматически: реализовать защиту от прямых изменений/подмены полей.
- Новое сообщение: восстановить/задать state → init при message=null → сохранить успешные изменения init → первый render/send → сохранить returned Message и установить ctx.message → created → автоматическая фиксация/рендер изменённого created state. Во время init/created новые события ожидают, не исполняются параллельно.
- Подключение к существующему сообщению и замена: init получает сохранённое существующее Message; затем render применяет допустимые изменения, без created (новой Telegram-отправки нет). При замене продолжают действовать согласованные остановка старого процесса и отсутствие rollback старой версии.
- Восстановление: state и snapshot Message из регистрации → init → синхронизация отображения при необходимости; created не повторяется. Хранить snapshot с регистрацией, чтобы истечение обычной истории не лишало runtime данных. Это последний известный snapshot, не гарантированно актуальный Telegram результат: Telegram Bot API не предоставляет произвольный getMessage.
- init вызывается при каждом запуске процесса, включая первоначальное создание; может запускать таймеры/сокеты и менять state. При message=null явный ctx.render запрещён с понятной ошибкой: первая отправка выполняется автоматически после успешного init. В created явный render уже доступен.
- При аварии после подтверждённой отправки до завершения created не повторять created автоматически после restart: оно могло выполнить внешние действия. Уведомить агента о незавершённом запуске. Не обещать exactly-once. Техническую фиксацию фазы lifecycle и отдельный случай delivery_unknown первого send уточнить в спецификации, не выдавать за дополнительно согласованную пользовательскую политику.

### Согласовано: форматирование обычного текста (2026-10-12)

Пользователь принял две формы text в render: строка с native parse_mode либо entities; JSX с обычными formatting-тегами, компилируемый SDK в plain text и entities с UTF-16 offsets. Без formatting-полей строка остаётся обычным текстом. parse_mode+entities одновременно — ошибка. Для caption сохраняется native caption/parse_mode/caption_entities по той же взаимоисключающей схеме. JSX text не допускает rich-only изображения/таблицы/структурные blocks. SDK предоставляет экранирование динамического текста для ручного HTML; JSX автоматически отделяет текст от тегов.

### Актуальные незакрытые вопросы после сверки (2026-10-12)

1. Lifecycle init/первого render/created согласован выше; остаётся техническая фиксация фаз и неизвестного результата первой отправки при сбое.
2. Точный ctx.api и формы event, подписки на reaction/poll/poll_answer, безопасная постановка Node-таймеров/WebSocket callbacks в последовательную очередь; отправка новых интерактивных сообщений из обработчика.
3. onError: признак handled, фиксация его state, ошибки рендера/БД/публикации/аварии процесса; какие ошибки требуют остановки и возможен ли автоматический restart, без повторного выполнения частичных действий.
4. Очередь/дедупликация/переполнение, её сохранность при restart; лимиты процессов, памяти, state и RPC/публикаций. Политика пропущенных сервером таймеров уже согласована и не открывается снова.
5. Реально применяемая sandbox Node на Alpine/Windows, доступ к SDK/импортам, координация общих JSON-файлов с другими регистрациями/агентом.
6. Решение о допустимых внешних переходах типов, операции stopPoll/stopMessageLiveLocation и связь остановки скрипта с активной live-трансляцией.
7. Срок хранения остановленных регистраций/снимков и административные операции просмотра/остановки; долговременная поддержка опубликованных сообщений после истечения обычной истории.
8. Предварительная проверка кода агентом и обязательные live-тесты: rich media mapping, thumbnails/covers/metadata reuse, poll events и live-location. Это верификация, не повторное проектирование уже принятой схемы кэша.

Рекомендуемый следующий предмет обсуждения — контракт ctx.api/event и постановка таймеров/WebSocket в последовательную очередь.

### Согласовано: created; полная сверка параметров render (2026-10-12)

- Пользователь подтвердил created(ctx,event) после первой подтверждённой отправки, включая returned Message/dice.value. Не считать это подтверждением ранее предложенных имён poll/poll_answer или exactly-once восстановления created после аварии.
- По запросу пользователя выполнена полная сверка полей 15 native send-методов, 7 edit/stop-методов и InputMedia/InputPoll структур с Telegram Bot API. Результат: [Interactive message render fields](react-message-render-fields.md).
- В справке для каждого типа разделены поля создания, независимые edits, параметры только в media replacement, неизменяемые/серверные поля, send-envelope и специальные native действия. Зафиксированы исключения thumbnail/cover, media metadata при reuse, URL ограничения video_note/sticker, live_period expiry/stop, participant-added poll options и native события poll.
- Справка фиксирует Bot API и проектный SDK scope, а не выдаёт недостающие методы за текущие возможности контроллера. Проверена полнота имён полей; live Telegram-проверки остаются в плане.

### Обсуждение: результат dice, события и расширенные опции poll (2026-10-12)

Пользователь запросил: реагировать на выпавшее значение dice и менять кнопки по результату; обрабатывать события native poll; использовать quiz/правильные ответы, множественный выбор и добавление/изменение ответов участниками.

Проверено по актуальному Telegram Bot API: sendDice возвращает Message.dice с emoji/value; результат доступен сразу в HTTP-ответе, отдельного update о завершении анимации не требуется. Предложение, пока не согласовано: одноразовое lifecycle-событие handlers.created(ctx,event) после подтверждённого создания с returned Message в event.message; скрипт сохраняет value в state, затем обычная автоматическая фиксация/рендер обновляет кнопки. Не генерировать created на каждом edit/restore; семантику attach уточнить отдельно. Стартовый render до результата может не показывать условные кнопки.

Native poll updates: poll — агрегированное состояние/изменения (включая закрытие), poll_answer — ответ/изменение/отзыв в неанонимном опросе, отправленном этим ботом. PollAnswer содержит poll_id, user или voter_chat, option_ids (пустой при отзыве), option_persistent_ids. Предложение: handlers.poll и handlers.poll_answer, event.data — соответствующий native объект; связывать poll_id с регистрацией/сообщением, направлять через последовательную очередь, не модель. Учитывать замены голосов, не прибавлять голос на каждый update; при добавляемых вариантах сохранять persistent IDs. Текущий polling.mjs не подписан на poll/poll_answer; при реализации нужны allowed_updates и маршрутизация.

В sendPoll доступны is_anonymous, type regular/quiz, allows_multiple_answers, allows_revoting, shuffle_options, allow_adding_options, hide_results_until_closes, correct_option_ids (plural), explanation/formatting/media, open_period/close_date, description/formatting/media, option media, members_only/country_codes с native ограничениями. allow_adding_options не поддержан для anonymous/quiz; это добавление новых вариантов, а не произвольное редактирование вопроса/старых вариантов. Предыдущая формулировка о полностью неизменных вариантах требует этого уточнения. Контроллер не имеет native editPoll; создание нового опроса не скрывать под render.

Предложение: poll в результате render принимает полный поддержанный native InputPoll/sendPoll контент без искусственного короткого whitelist; проверять комбинации и исключать управляющие поля маршрута/token. Медиаполя poll требуют отдельного расширения того же resolver/cache и проверки native форматов; существующий walker не гарантирует это автоматически. После создания менять inline-клавиатуру и явно останавливать poll отдельным API, не пытаться применять параметры создания повторно.

Источники: https://core.telegram.org/bots/api#senddice, https://core.telegram.org/bots/api#dice, https://core.telegram.org/bots/api#update, https://core.telegram.org/bots/api#pollanswer, https://core.telegram.org/bots/api#sendpoll. Это проверка документации, не live-проверка событий.

### Согласовано: media cache и обязательная живая проверка mapping (2026-10-12)

Пользователь принял предложенную связку request manifest → returned media file_id и кэш в памяти регистрации. Для file: использовать mtime+size; URLs переиспользовать до сброса/рестарта; file_id использовать повторно; JSX компилировать в native blocks для сопоставления, сохраняя Telegram-подобные теги автора. Исходники длительных сообщений хранить вне .temp, после рестарта повторная загрузка допустима.

Пользователь отдельно потребовал повторные проверки для всех поддержанных видов изображений/файлов и вложений внутри раскрывающихся блоков, списков и других разрешённых контейнеров. План тестов: ordinary send/edit; rich send/edit с photo/video/animation/audio/voice_note/document; отдельные и смешанные медиа; details/list/blockquote/collage/slideshow и разрешённые комбинации вложенности; перестановка/повтор одного источника/добавление/удаление медиа; local/URL/file_id; неизменный/изменённый mtime+size; восстановление процесса/сервера. Проверять actual file_id и отсутствие повторного upload при cache hit, а не только визуальную успешность. Не обещать допустимость любых контейнеров до проверки native ограничений. Mapping при несовпадении структуры не записывать наугад.

### Предложение примеров render для всех одиночных типов

Пользователь запросил примеры. Предлагается единый результат по форме send: ровно одно content-поле, optional caption/entities/parse_mode/reply_markup/permits; rich_message — JSX, media content-поле — строковый src (file:/URL/Telegram ID). Примеры покрывают text, rich_message, photo, video, animation, document, audio, voice, sticker, video_note, dice, location, venue, contact, poll; live location как location с live_period. Это примеры предлагаемого SDK, не существующий реализованный TSX API.

Рендер существующего сообщения отправляет только изменения разрешённых компонентов. Неизменные content-поля не повторно отправляются; попытка изменить неизменяемые поля — ошибка. В частности повторный render dice не делает новый бросок, render poll не создаёт новый опрос. Истечение native live_period не отменяется принудительным рендером; stop live location обсуждается отдельно. Альбом не относится к одиночному render-контракту. Переходы между внешними типами пока не согласованы.

### Уточнение пользователя: кэш в памяти, mtime и связывание file_id (2026-10-12)

- Пользователь предпочёл необязательную персистентность кэша: хранить в оперативной памяти регистрации; после рестарта допустима повторная загрузка. Для длительного использования агент хранит исходники вне .temp. Это отменяет предложение об обязательном media-cache в БД.
- Пользователь запросил оценку mtime для повторной загрузки при изменении того же файла, и конкретный алгоритм сопоставления локального источника/HTTPS URL с Telegram file_id.

Рекомендация, пока не согласована: cache entry {src,mediaType,fileId,mtimeMs?,size?} в контексте регистрации/бота. При file: проверять допустимый файл и mtime+size перед reuse; изменение приводит к новой загрузке. Это эвристика v1, не content-addressing: изменения с теми же mtime/size могут быть пропущены. Пропавший файл при уже имеющемся кэше можно переиспользовать до рестарта; после рестарта отсутствующий источник — ошибка.

Связывание: обычная публикация возвращает Message с photo[]/document/video/etc.; исходный source известен запросу, file_id извлекается из ответа соответствующего content-поля (для photo выбирается подходящий полный размер, не thumbnail). При rich заранее сохранять render manifest: src+mediaType+путь native media блока в дереве, включая details/list/collage/slideshow. После успешного send/edit обойти соответствующее дерево returned Message.rich_message.blocks и взять реальные PhotoSize/Document/etc. file_id. Native media alias InputRichMessageMedia.id не является returned file_id и не возвращается как надёжная связь с источником. Нельзя просто считать, что Telegram вернул соответствие attach-name → file_id.

Для предсказуемого дерева предложено компилировать Telegram-подобный JSX в native blocks внутри SDK; это не меняет пользовательских тегов, но уменьшает зависимость от HTML-нормализации. Сопоставление структур/типов необходимо проверить живым тестом; при несовпадении не записывать предположительную запись кэша. Это технический алгоритм, не гарантированное Telegram сохранение всех путей.

HTTPS URL связывается тем же manifest/response механизмом: URL известен до отправки, actual file_id приходит в результате, но сам returned блок не хранит original URL. Не пытаться восстановить URL из file_id/имени/хеша. Для URLs mtime локального файла неприменим; предложение v1 — reuse точного URL до сброса кэша или изменения URL, без HEAD/ETag polling. Проверка URL MIME/type и native ограничений Telegram остаётся необходимой.

Источники: https://core.telegram.org/bots/api#richblockphoto, https://core.telegram.org/bots/api#richblockdocument, https://core.telegram.org/bots/api#richblockslideshow, https://core.telegram.org/bots/api#inputrichmessage. Живая проверка mapping нескольких local/URL/file_id вложений и вложенных блоков ещё не выполнена.

### Предложение пользователя: строковый src и кэш upload (2026-10-12)

Пользователь предложил оставить src строкой: Telegram attachment/file_id использовать повторно; file:path/to/file.png загрузить при первом использовании и запомнить соответствие file_id, затем переиспользовать кэш; аналогично рассмотреть URLs. Это заменяет рассматриваемые MediaRef helpers как направление обсуждения, но детали пока не согласованы.

Рекомендация: поддержать raw Telegram file_id, file: с путём относительно корня бота и http(s). Во внешнем API сохранять строку; внутри rich сериализатор формирует native tg://TYPE?id=ALIAS и media-декларацию, не вставляет raw file_id/file: в Telegram HTML буквально. Аналогичный resolver использовать для обычных media content-полей. Отличать raw Telegram file_id от алиаса InputRichMessageMedia.id; не считать их одним пространством имён.

Предложенный ключ кэша: область регистрации/владелец, Telegram bot ID, полный нормализованный src и тип media (photo/document/audio/etc), включая влияющие на upload параметры. Telegram file_id привязан к боту и типу отправки. Сведения сохраняются в БД, без вечного удержания бинарников, только после подтверждённой публикации; mapping связывается с разрешённым источником/регистрацией. На cache miss соблюдать существующие права путей и reuse; raw file_id требует доступного подтверждённого источника, который resolver может найти автоматически в разрешённой истории/медиа регистрации. Не обещать обход текущей проверки file_sources.

Предложение семантики v1: src — снимок содержимого при первой успешной загрузке, до явного обновления. После cache hit источник заново не читается/скачивается; исчезновение исходного temp-файла не мешает reuse. Перезапись файла/изменение ответа URL не обновляет сообщение автоматически; нужен другой src (предпочтительно новый filename или versioned URL) либо явная invalidation API, имя/область которой ещё не определены. Не подделывать query для локальных путей и не изменять signed URL произвольно.

Открытые вопросы: выбрать snapshot-vs-auto-refresh для одинакового src; cache invalidation и судьба кэша при замене/stop регистрации; поведение при устаревшем Telegram file_id (fallback допустим только при известном отказе, не при delivery_unknown). Кэш URLs — поддерживать HTTP(S), не произвольные протоколы. Живой тест mapping rich media к file_id ещё требуется.

Источники: https://core.telegram.org/bots/api#sending-files, https://core.telegram.org/bots/api#inputrichmessage; существующие BotFiles/src/messages/actions.mjs.

### Согласовано: все одиночные типы текущего send (2026-10-12)

Пользователь принял общий принцип: поддерживать все одиночные типы текущего send. При рендере обновлять только редактируемые Telegram части; неизменяемое содержимое сохранять, попытка его изменения возвращает понятную ошибку. Новое содержимое можно отправить отдельным сообщением через ctx.api.send. Альбом как несколько messageId остаётся отдельным вопросом.

### Предложение: медиа-ссылки для обычных и rich-сообщений

Пользователь запросил обсуждение файлов/изображений, в том числе внутри rich. Текущий контракт проверен по docs/messaging.md и src/messages/actions.mjs: локальные uploads/attach, URLs, Telegram file_id с file_sources; temp-файлы очищаются по общим правилам. Telegram Rich HTML использует img/video/audio/tg-document и media-декларации для tg:// ссылок.

Предложение, пока не согласовано: единый сериализуемый MediaRef, создаваемый helpers files.local(path), files.telegram({fileId,messageId,chatId?}), files.url(url). Его можно передать в обычное content-поле либо JSX src. SDK формирует native rich HTML/media/uploads/file_sources, экранирует строки и проверяет тип тега/ссылки. Helpers только создают описания; IO и загрузка выполняются контроллером при публикации, сохраняя чистоту render.

Предлагаемые правила: при повторном рендере переиспользовать уже подтверждённые Telegram-вложения, не загружать неизменный файл снова; полный rich-render сохраняет все медиа, явно перечисленные в текущем дереве. Агент передаёт новый MediaRef событием и сохраняет его в state, не base64. Удаление элемента из дерева убирает его из rich-документа, а не удаляет локальный файл.

Открытые вопросы: как фиксировать версии локального файла при перезаписи того же пути; как сохранять сведения для reuse после истечения истории; разрешать ли fallback к последнему загруженному вложению, если temp-путь исчез; нужны ли immutable импорт/копия файла до первого upload; lifetime registry/cache и проверка доступа. Предпочтительная отправная точка: durable metadata о подтверждённом upload без вечного удержания бинарника в .temp; до первого успешного upload отсутствие локального файла — ошибка.

Ссылки: https://core.telegram.org/bots/api#rich-html-style и https://core.telegram.org/bots/api#inputrichmessage. API и caching здесь проектные предложения, не реализованная гарантия.

### Согласовано: команды раньше перехвата reply (2026-10-12)

Пользователь подтвердил приоритет команд контроллера. Reply, распознанный как команда контроллера, проходит обычную обработку команд с проверкой синтаксиса и прав, а не handlers.reply. Неверный синтаксис/недостаток прав распознанной команды не должен превращать её в событие reply обработчика.

Следующий вопрос scope: после принятия dice рассмотреть прочие одиночные типы с неизменяемым содержимым и изменяемой inline-клавиатурой. Предложение, пока не согласовано: поддержать все одиночные типы текущего send; render обновляет лишь разрешённые Telegram части, попытка изменить неизменяемое содержимое даёт понятную ошибку, а не неявный delete/send или молчаливое игнорирование. Особые действия stopPoll/stopLiveLocation согласовать отдельно; native album пока не входит в модель одной регистрации с одним messageId.

### Согласовано: интерактивный dice и перехват reply (2026-10-12)

- Пользователь принял dice как интерактивный тип. Бросок отправляется при создании; повторный рендер обновляет inline-клавиатуру, не перебрасывает dice и не меняет его emoji/value.
- Пользователь запросил обработку сообщений, являющихся reply на интерактивное сообщение: если у действующей регистрации есть нужный обработчик, событие направляется ему и не доставляется модели агента текущего чата. Если обработчика нет, используется обычная маршрутизация сообщений к агенту текущего чата, если агент есть и условия доставки выполнены.
- Обработчик принадлежит создавшему агенту по ранее принятому решению; перехват reply не меняет владельца при публикации в другом чате.

Предложения для уточнения, пока не согласованы отдельно:

- Стандартное имя handlers.reply(ctx,event). event содержит данные входящего сообщения, его автора, chatId/messageId/topicId и связь с исходным интерактивным сообщением; конкретная полная/короткая форма ещё не выбрана.
- История сохраняется независимо от перехвата. Команды контроллера сохраняют приоритет, чтобы reply с /agent stop или другой командой не оказался скрыт в скрипте.
- Перехват обычного reply исключает доставку модели и при дополнительных mention/match триггерах; приём скриптом сам по себе не включает громкий режим модели. Последнее требует явного согласования.
- Ошибка принятого handler обрабатывается через onError/уведомление владельца; не передавать исходное сообщение модели автоматически после ошибки (часть эффектов скрипта могла уже выполниться). Переполнение очереди и прекращение регистрации в момент маршрутизации требуют отдельного решения.
- Правила доступа и авторизации к чату/сообщению сохраняются; button permits автоматически не превращаются в permits на текстовые reply. Подписка на редактирование reply и обработка альбомов остаются открытыми деталями.

### Уточнение: интерактивный кубик (2026-10-12)

Пользователь уточнил поддержку inline-клавиатуры под dice. Проверено: sendDice принимает reply_markup с InlineKeyboardMarkup; клавиатуру можно изменять через editMessageReplyMarkup, не меняя emoji/value кубика. Источники: https://core.telegram.org/bots/api#senddice и https://core.telegram.org/bots/api#editmessagereplymarkup. Живой тест не проводился.

Ранее предложенное исключение dice из scope было слишком узким: неизменяемое содержимое не исключает полезных интерактивных кнопок (например «Засчитать»). Это исправление предложения, не окончательное согласование перечня типов. Если включить dice в render, отправлять бросок только при создании, а при следующих рендерах обновлять клавиатуру; новый бросок — отдельное явное действие с новым messageId.

### Согласовано: rich и кнопки; обсуждение интерактивных типов (2026-10-12)

- Пользователь подтвердил ранее предложенную основу rich и кнопок: rich-отображение с Telegram-подобным JSX, inline-клавиатура дополнительно к содержимому, привязка callback кнопок внутри rich и inline-клавиатуры к общим именованным handlers. Это не утверждение всех native переходов типов без живой проверки.
- Пользователь предложил ограничить интерактивные типы полезными для рендера, привёл dice как пример типа без смысла в повторном рендере.

Предложение scope, пока не согласовано:

| Тип | Рекомендация |
| --- | --- |
| text | Включить: меняются текст и inline-клавиатура |
| rich | Включить: полный документ с медиа/картами/встроенными и inline-кнопками |
| photo/video/animation/document/audio | Включить одиночные сообщения: заменяются медиа, подпись и inline-клавиатура |
| live location | Включить: координаты и inline-клавиатура; отдельный lifecycle трансляции |
| voice | Отложить: меняются только подпись/клавиатура, не сам голосовой файл |
| sticker/video_note/contact/venue/static location | Отложить: возможна интерактивная клавиатура, но содержимое неизменно; не объявлять это технически невозможным |
| native poll | Отложить как render-тип: native голосование уже обслуживает Telegram, вопрос/варианты неизменны; SDK-голосование может быть text/rich+кнопки |
| media album | Не включать в единичный render-контракт: несколько messageId и нет общей inline-клавиатуры; для карусели использовать rich |
| dice | Не включать в render-контракт: повторная отправка — новый бросок и новое сообщение |

Ограничение render не запрещает ctx.api.send отправлять обычные сообщения поддерживаемых типов (например кубик как отдельный результат действия) с прежними правами. Вопрос допустимых переходов между внешними render-типами остаётся отдельным, не решён выбором исходных типов.

### Согласовано: callback без автоматического таймера (2026-10-12)

- Пользователь отклонил предложенное автоматическое пустое подтверждение callback через 2 секунды. Не вводить таймер/fallback подтверждения ради долгого действия или ожидания в очереди.
- Длительное выполнение допустимо; скрипт сам выбирает ранний event.respond или ответ через return. Отсутствие своевременного callback-ответа не является основанием останавливать действие.
- Используем обсуждавшийся контракт ответа: undefined/null/{} — пустое подтверждение при завершении; string — текст уведомления; {text,showAlert} — уведомление/alert; ранний event.respond с теми же формами. Повторный ответ после раннего не отправляем. Ранний ответ не фиксирует state и не завершает handler.
- Пользователь описал клиентское ожидание как 10 секунд с последующим пустым ответом. Не делать это гарантией реализации: официальная документация answerCallbackQuery не задаёт точный срок, прекращение клиентского индикатора не доказывает серверное подтверждение. Архитектура не должна зависеть от точного клиентского timeout.
- Предложение для реализации: попытка позднего ответа, отклонённая Telegram как устаревший callback, не прерывает основное действие и не превращается в ошибку всей регистрации. Политику прочих ошибок event.respond определить отдельно; не скрывать произвольные сетевые/API ошибки под видом устаревшего callback.

### Согласовано: фиксация state и рендер а+в (2026-10-12)

Пользователь выбрал сочетание автоматической фиксации/рендера при изменении state после успешного handler и явного await ctx.render() для промежуточных обновлений. Принята предложенная семантика snapshots: сохранять state перед публикацией, read-state показывает сохранённый снимок, ошибка публикации не откатывает его; ошибка handler не фиксирует оставшиеся локальные изменения автоматически, рабочее состояние возвращается к последнему сохранённому снимку. Уточнение фиксации из onError остаётся открытым.

### Предложение пользователя: ответ на callback (2026-10-12)

Обработчик кнопки возвращает undefined | null | {} | string | {text:string, showAlert:boolean}. Ранний ответ — event.respond с теми же значениями. Вариант обсуждается; предыдущий ctx.answer предполагается заменить этим API.

Рекомендация: пустые значения подтверждают callback без текста; string означает уведомление; объект управляет текстом/alert, showAlert по умолчанию false. event.respond возвращает Promise. Первый принятый ответ закрывает локальную возможность повторного ответа; return после раннего ответа не отправляет второй callback-ответ, но handler продолжает выполняться и фиксирует state по согласованным правилам. Ответ callback отделён от рендера/сохранения состояния и не означает завершения обработки.

Ответы нормализует контроллер, native show_alert не экспонируется вместо согласуемого showAlert. Telegram допускает text длиной 0–200 символов, URL/cache_time не входят в предложенный API. Callback требует подтверждения даже без текста: https://core.telegram.org/bots/api#answercallbackquery.

Открытый вопрос: fallback подтверждения при долгом handler или ожидании в очереди. Предложение: контроллер через короткий срок (например 2 секунды от получения callback) отправляет пустой ответ, если раннего/возвращённого ответа ещё нет. После fallback поздний return не показывает alert; результат отображается обновлением сообщения. Это собственная UX-политика, не документированный Telegram deadline. Ошибка/остановка обработчика требует fallback подтверждения со стороны контроллера.

### Принято как текущая основа: долгоживущий runtime (2026-10-12)

Пользователь ответил «Пока что всё подходит» на предложения пунктов 1–7. Текущая основа: долгоживущий изолированный Node-процесс регистрации; сериализуемый state хранится контроллером; init(ctx) запускается при каждом запуске/восстановлении процесса; таймеры и WebSocket/замыкания остаются живыми ресурсами процесса и создаются заново после перезапуска. Таймерные/сетевые события проходят через последовательную очередь. handlers.name(ctx,event), ctx.api, чистый render(state), асинхронные файловые действия в песочнице. JSX следует Telegram Rich HTML; другие типы сообщений и inline-клавиатура требуют отдельного обсуждения. Ранее согласованное прекращение процесса при замене/остановке сохраняется.

### Открытый вопрос: синхронизация state и запуск рендера

Пользователь предложил три варианта: фиксация после handler; setState с batching; явный ctx.render().

Рекомендация обсуждения, пока не согласована: сочетать автоматическую фиксацию после успешного завершения handler с явным await ctx.render() для промежуточных обновлений. ctx.state — рабочее состояние процесса; контроллер хранит последний принятый сериализованный snapshot с номером версии. При явном render сначала снять snapshot и сохранить в контроллере, затем отобразить именно этот snapshot и обновить Telegram. После успешного handler при отличии состояния от последнего сохранённого снимка выполнить тот же цикл автоматически. Если изменений нет, автоматический рендер не нужен. Явный render может повторно публиковать неизменённое состояние для восстановления отображения.

Предложенные последствия: один async handler может последовательно await ctx.render() несколько раз; частичные локальные изменения без такой фиксации не видны read-state и теряются при остановке. После ошибки handler не фиксировать оставшиеся изменения автоматически; восстановить рабочее состояние из последнего принятого snapshot. Уже зафиксированные промежуточные состояния и внешние эффекты не откатывать. Ошибка публикации после фиксации не отменяет snapshot, передаётся в согласованный механизм обработки ошибок с известным/неопределённым статусом доставки. Взаимодействие изменений onError с фиксацией требует уточнения. setState/batching пока не предлагается как обязательный дополнительный механизм.

### Уточнения API и примеры долгоживущего выполнения (2026-10-12)

- Пользователь принял приближение JSX к Telegram Rich HTML style; другие типы сообщений и inline-клавиатуры обсудить отдельно.
- Пользователь предложил handlers.name(ctx, event): данные события передаются отдельно, ctx не содержит сменяемый текущий event. Стабильный набор сервисов ctx не означает неизменность ctx.state или сохранение объекта между процессами.
- Пользователь принял ctx.api для внешних действий.
- Пользователь предложил render(state) вместо render(ctx), возможность init(ctx) для стартовой настройки таймеров; эти детали ещё обсуждаются.
- Требования пользователя: async обработчики должны иметь возможность читать/изменять JSON-файлы в песочнице; рассмотреть долгоживущее WebSocket-соединение с обновлением отображения и отправкой сообщений по нажатию кнопок.

Предложение, пока не согласовано: сериализуемый state сохраняется контроллером независимо от срока жизни процесса; процесс регистрации может оставаться живым для таймеров и WebSocket. init вызывается при запуске каждого нового процесса, включая восстановление, но не при каждом рендере или событии. Замена/остановка уничтожает процесс и живые ресурсы; init новой версии создаёт их заново. Замыкания, таймерные handles и сокеты не сохраняются в state.

Возможные режимы, ещё не выбраны: запуск на событие для простых сообщений; долгоживущий процесс для обычных Node-таймеров/сокетов; либо единый долгоживущий runtime для всех регистраций с последующим уменьшением расхода ресурсов. Не обещать прозрачную сериализацию замыканий или автоматическое восстановление всех таймеров.

Предложение: render(state) — чистая функция; JSX и медиа-ссылки описывают желаемое сообщение без RPC, изменений файлов, таймеров и сетевых запросов. Async handlers(ctx,event) выполняют разрешённые действия и обновляют состояние. Внешние callback таймеров/WebSocket передают данные в последовательную очередь регистрации, а не мутируют state параллельно. Точное API enqueue/emit и момент сохранения state пока открыты.

Чтение/изменение JSON-файлов допустимо в рамках sandbox, но последовательность одной регистрации не защищает файл от другой регистрации или агента. Для общей записи требуется координация/атомарная операция; автоматическую атомарность read-modify-write не обещаем. Для мелкого состояния предпочесть state, для общего игрового состояния отдельно определить storage API.

Примеры для следующего обсуждения: одноразовое скрытие кнопки после дедлайна (deadline в state и пересчёт задержки в init); периодическое обновление отображения; WebSocket в init с входящими событиями очереди и отправкой из обработчика кнопки. Сеть, reconnect, лимиты процесса и восстановление сообщений WebSocket не следуют автоматически из сохранения state и требуют отдельного контракта.

### Обсуждение: таймеры, HTML, единые события и API (2026-10-12)

Пользователь поставил четыре вопроса: использовать обычные setTimeout/setInterval из действий; приблизить JSX к Telegram Rich HTML style; объединить actions/events; определить ctx/api для действий контроллера.

Предложения и выводы, пока не согласованы:

- Настоящие Node setTimeout/setInterval возможны в долгоживущем изолированном процессе. Они противоречат ранее выбранному запуску процесса только на время действия. Callback/замыкание нативного таймера не сериализуется и не восстанавливается после перезапуска; сохранённый state можно восстановить, таймеры устанавливает явный стартовый обработчик. Остановка убивает процесс и его таймеры. Асинхронные callback всё равно нужно сериализовать с событиями регистрации; обычный setInterval сам этого не делает. Альтернатива: ctx.setTimeout/ctx.setInterval с именем события и JSON-данными, планируемые контроллером, без постоянно работающего процесса. Выбор архитектуры ещё не сделан.
- JSX может использовать те же теги и атрибуты, что Telegram Rich HTML style, включая p/h1/details/tg-slideshow/tg-button/tg-map. Полное буквальное совпадение синтаксиса HTML с JSX невозможно: void-теги в JSX закрываются, используются выражения JavaScript, в TSX есть ограничения синтаксиса/типов. Не требуется преобразовывать class в className при собственном JSX runtime.
- Для кнопок можно использовать native type="callback_data" data="vote" и связывать data с именованным обработчиком; реальные маршрутизирующие callback_data формирует контроллер. Помощник медиа оформляет native media/uploads/file_sources, не требует ручного согласования ссылок агентом.
- Объединить actions/events в handlers с метаданными источника события. Переходы от кнопки/таймера/агента/реакции не должны путаться по именам; отдельно согласовать именование и разрешённые источники. Пермиты контроллер проверяет для кнопки, независимо от общего имени функции.
- Предпочтительно один ctx: ctx.state/event/message, ctx.answer для callback, ctx.api для RPC к контроллеру (уведомление агента, отправка сообщений, регистрация/редактирование). Не выдавать token/raw Telegram client; сохранять действующие права и ограничения. onError и render остаются отдельными lifecycle-функциями.
- Источник rich-разметки проверен: https://core.telegram.org/bots/api#rich-html-style. Это проектные предложения, не проверенная реализация SDK.

### Согласовано: ошибка создания новой регистрации при замене (2026-10-12)

- Если после остановки старого обработчика новая регистрация не запустилась, сообщение остаётся без работающего обработчика.
- Контроллер по возможности блокирует callback-кнопки и возвращает агенту ошибку.
- Старую версию автоматически не восстанавливать.

### Предложение: структура TSX-модуля

Пока не согласовано: export default defineMessage({render, actions, events, timers, onError}). JSX используется в render; действия и события — явные функции TypeScript. Контроллер хранит сериализуемое состояние и запускает изолированные вызовы. Начальное состояние передаётся через согласованный единый инструмент, по умолчанию {}. React hooks и useEffect не входят в обязательный API. Конкретный синтаксис таймеров, компонентов и ответа onError ещё предстоит определить.

### Согласовано: замена как остановка и новая регистрация (2026-10-12)

- Пользователь отклонил ожидание штатного завершения текущего действия перед заменой. Замена должна работать как удаление старого обработчика и создание новой регистрации на том же Telegram-сообщении. Само Telegram-сообщение не удаляется и messageId не меняется.
- Использовать согласованную принудительную остановку: старая регистрация не принимает новые действия, её таймеры/подписки и ожидающие события удаляются, выполняющийся процесс и дочерние процессы завершаются. Уже совершённые или отправленные в Telegram эффекты не откатываются.
- В промежутке замены можно не блокировать callback-кнопки визуально. Это исключение из визуальной блокировки при обычном stop_react, а не разрешение продолжать исполнение старого обработчика.
- Для новой регистрации сохраняется согласованный выбор state: переданный явно полностью заменяет состояние; при отсутствии использовать последнее сохранённое состояние старой регистрации, а если его нет — {}. Незавершённые изменения в памяти старого процесса не сохраняются автоматически.
- Новая регистрация заново устанавливает таймеры и подписки; старая очередь событий не переносится. Подробный контракт регистрации расписаний ещё предстоит определить.
- Открытый вопрос: ответ на callback, полученный в промежутке замены, и поведение при неудаче создания новой регистрации. Не обещаем атомарную замену или отмену уже отправленного Telegram-запроса.

### Согласовано: единая операция создания/подключения/замены (2026-10-12)

- Пользователь предложил объединить создание нового сообщения, подключение обработчика к существующему и замену обработчика в одну операцию с параметрами {messageId?, chatId?, handler, state?}. При необходимости создания в теме также учитывать ранее согласованный topicId.
- Без messageId создаётся новое интерактивное сообщение. С messageId подключается обработчик к существующему сообщению либо заменяется уже зарегистрированный.
- Если state отсутствует, использовать сохранённое состояние существующей регистрации; если его нет, использовать {}. Если state передан явно, использовать его как полную замену, а не patch. Переданный {} — явный сброс. Не реализовывать выбор состояния через логическое ||, теряющее явно переданные значения.
- Агент сам обеспечивает совместимость состояния с новой версией кода или передаёт новое состояние. Контроллер проверяет допустимость сериализуемых данных, но не реализует автоматические миграции либо обязательное сопоставление state со схемой нового обработчика.
- Это заменяет предложение об отдельных attach_react/replace_react и resetState. Имя единого инструмента пока не выбрано; send_react остаётся предварительным названием.
- Остальные запрошенные операции остаются: удаление/остановка обработчика, чтение состояния, событие обработчику, принудительный рендер.
- Сохраняются ранее согласованные права публикации/редактирования, принадлежность создавшему агенту, изоляция и снимки кода. Точная политика обновления во время текущего действия и переноса ожидающих событий/таймеров требует уточнения.

### Согласовано: операции агента над интерактивным сообщением (2026-10-12)

Пользователь запросил следующий набор возможностей:

- Создать новое интерактивное сообщение либо превратить существующее сообщение в интерактивное.
- Заменить или удалить обработчик интерактивного сообщения.
- Прочитать состояние сообщения.
- Отправить именованное событие обработчику.
- Явно потребовать принудительный рендер сообщения.

Названия инструментов пока предварительные. Предложение: send_react для создания, attach_react для подключения к существующему сообщению, replace_react для замены, stop_react для удаления/отключения обработчика с ранее согласованной блокировкой callback-кнопок, react_state для чтения, react_event для события, render_react для принудительного рендера.

Предложенные ограничения и семантика, ещё не согласованы отдельно:

- Подключение к существующему сообщению не должно обходить действующие права редактирования и ограничения Telegram на тип сообщения. Не обещать превращение произвольного media/location сообщения в rich.
- Чтение возвращает сохранённое сериализуемое состояние и номер версии; прямой инструмент произвольной записи состояния пока не запрошен. Изменения данных передаются событиями обработчика.
- Принудительный рендер использует текущую зарегистрированную версию кода и сохранённое состояние без повторного выполнения callback/event действий. Он также может обновлять декларацию кнопок, но сам не должен порождать побочные эффекты, таймеры или новые сообщения. Ошибки проходят через согласованный механизм onError/уведомления агента.
- Замена кода, события и рендер не должны одновременно исполнять разные версии одной регистрации. Очередь/приостановка для переключения и обработка старых событий требуют уточнения.
- Удаление обработчика оставляет Telegram-сообщение; срок хранения и возможность повторного подключения к сохранённому состоянию пока открыты.
- Следующее решение: при замене кода сохранять состояние по умолчанию, с явным reset при необходимости, либо требовать явного выбора режима при каждой замене.

### Согласовано: возможность обработать ошибку в скрипте (2026-10-12)

- Пользователь предложил и запросил возможность обработки ошибки скриптом. Если обработчик ошибок не задан либо ошибка не обработана, уведомлять создавшего агента об ошибке.
- Это относится в том числе к ошибке обновления Telegram-сообщения после сохранения состояния. Агент получает уведомление и при необходимости может внести правки; конкретный интерфейс правок ещё не согласован.
- Предложение: явный onError с признаком handled; сведения об этапе (action/render/persist/publish), известном результате внешнего действия и причине сбоя. Отсутствие handled, ошибка в самом onError, аварийное завершение или превышение лимита исполнения приводят к уведомлению агента. Не вызывать onError рекурсивно при его собственной ошибке.
- Не обещать выполнение onError внутри уже завершённого процесса: контроллер должен иметь fallback для аварии runtime. Намеренную остановку регистрации не считать ошибкой, требующей восстановления.
- Предложенный выше порядок фиксации состояния перед публикацией ещё не получил отдельного окончательного подтверждения. Автоматические повторы публикации также не согласованы; наличие onError не означает разрешения повторять произвольные внешние эффекты.

### Следующая тема: правки интерактивного сообщения

Ранее согласовано: зарегистрированный код — снимок; изменение исходного файла не меняет опубликованную регистрацию; обычный edit запрещён, пока обработчик работает. Пользователь запросил отдельно обсудить возможности правки.

Предложение, пока не согласовано: разделить передачу данных действующему обработчику (событие агента), замену зарегистрированной версии кода с явным переносом/сбросом состояния и обычный edit после остановки. При замене кода сначала проверять новую версию без публикации; не допускать одновременного выполнения старой и новой версии. При неудачной предварительной проверке оставлять старую версию. API, судьба ожидающих событий, изменения таймеров/подписок и совместимость состояния требуют уточнения.

### Согласовано: принудительная остановка (2026-10-12)

Пользователь принял следующий порядок остановки отдельной регистрации и её выполнения:

1. Пометить регистрацию остановленной. Контроллер больше не принимает новые действия от неё.
2. Отключить таймеры и подписки, удалить ожидающие события.
3. Принудительно завершить выполняющийся изолированный процесс обработчика и его дочерние процессы; штатного завершения не ждать.
4. По возможности заблокировать callback-кнопки сообщения.

Уже выполненные действия не откатывать. Запросы, уже отправленные в Telegram, могут завершиться после остановки: завершение процесса не отменяет внешние эффекты. Этот согласованный порядок заменяет ранее открытое предложение о политике текущего действия.

Следующий вопрос обсуждения — момент фиксации состояния и восстановление отображения после сбоя. Предложение, пока не согласовано: обработчик вычисляет новое сериализуемое состояние и целевое отображение; контроллер сохраняет состояние и желаемый рендер перед обновлением сообщения. Если обновление Telegram не удалось, повторять отображение из сохранённого результата, а не выполнение пользовательского обработчика. Не трактовать это как атомарную транзакцию с Telegram или гарантию exactly-once для произвольных действий ctx.send и других внешних эффектов. Механизм подтверждения/дедупликации событий и политика сбоев до фиксации пока не определены.

### Согласовано: принадлежность и прекращение обработки (2026-10-12)

- Пользователь подтвердил: регистрацию продолжает владеть создавший агент, даже при публикации в другом чате; явные уведомления обработчика направляются этому агенту. Песочница, файлы и права относятся к создавшему агенту, участник callback — к фактическому чату сообщения. Перед внешним действием контроллер проверяет актуальные права.
- При удалении агента все принадлежащие ему интерактивные сообщения перестают обрабатываться. Контроллер по возможности блокирует все их callback-кнопки. Сами опубликованные сообщения этим решением не предписано удалять.
- Агент может самостоятельно отключить обработку отдельного интерактивного сообщения; callback-кнопки также блокируются по возможности. Это соответствует ранее согласованному stop_react.
- Ошибка визуального отключения кнопок не должна сохранять обработку: остановленная регистрация больше не запускает обработчики. Точные тексты ответа на оставшуюся визуально активной кнопку и сроки хранения остановленной регистрации ещё не определены.
- Предложение для дальнейшего уточнения: при остановке прекратить таймеры и подписки, отменить ожидающие события; перед внешними эффектами уже выполняющегося действия проверять, что регистрация ещё активна. Уже совершённые эффекты не откатывать. Точная политика текущего действия ещё не согласована.

### Согласовано: остановка сервера и отправка в другие чаты (2026-10-12)

- Пока сервер остановлен, интерактивные сообщения не обрабатываются. Пользователь не требует обработки пропущенных таймеров; отдельный механизм догоняющих срабатываний не нужен. При запуске сервера можно восстановить сохранённое состояние. Конкретный контракт возобновления таймеров ещё предстоит определить.
- Интерактивные сообщения разрешено отправлять в другие чаты, куда агенту разрешена отправка обычных сообщений. Использовать существующую проверку доступа к публикации, без отдельного расширения прав.
- Предложение, пока не согласовано: send_react принимает chatId и topicId по правилам send; регистрацию продолжает владеть создавший агент, а чат сообщения определяет место рендера и контекст нажатий. Уведомления от обработчика идут создавшему агенту, даже если сообщение опубликовано в другом чате. При исполнении повторно проверяются текущие права, а не только права на момент регистрации.
- Открытый вопрос: подтвердить принадлежность регистрации создавшему агенту и маршрут уведомлений при публикации в другом чате.

### Согласовано: источники событий обработчика (2026-10-12)

Пользователь подтвердил, что обработчик должен получать события от кнопок, таймеров, других внешних событий (например, реакции на сообщение), а также явно отправленные агентом события. Пример: агент генерирует изображение и передаёт обработчику ссылку на сохранённый файл для обновления сообщения.

Предложенный общий контракт, пока не согласован:

- Регистрация связывает отображение сообщения, сериализуемое состояние, именованные действия и подписки. JSX отвечает только за отображение; обновления запускаются runtime по событиям.
- События всех источников идут в одну последовательную очередь конкретной регистрации, независимо от занятости модели. Таймеры выполняются контроллером, без постоянно работающего процесса компонента.
- Обработчик получает нормализованное событие с типом, идентификатором и данными. Для кнопок дополнительно доступны пользователь и аргументы действия, для реакций — доступные Telegram данные изменения, для таймеров — имя таймера, для агента — имя события и проверенные сериализуемые данные.
- Предварительный инструмент agent-to-handler: message_event({messageId,name,data}). Итоговое имя и ключ регистрации ещё не выбраны. Ссылка на файл проверяется в рамках прав агента, а не считается разрешённой только потому, что передана в data.
- Состояние, подписки и расписания восстанавливаются после перезапуска. Обработчик явным образом уведомляет модель; штатная обработка не расходует её контекст.
- Не запускать произвольный код из render. Для v1 рассмотреть явные actions/events/timers вместо useEffect; зарегистрированные таймеры не должны дублироваться при повторном рендере.

Следующие открытые вопросы: устойчивость очереди и дедупликация событий; политика пропущенных таймеров и объединения частых обновлений; подписки на реакции своего/другого сообщения; жизненный цикл файлов, переданных агентом; обработка частичных и неопределённых внешних эффектов. Гарантию exactly-once для Telegram-эффектов не обещаем.

### Уточнение пользователя: rich, медиа и live location (2026-10-12)

- Пользователь рассматривает JSX из-за его соответствия XML/HTML-разметке rich-сообщений. Авторский API должен предусматривать изображения, файлы и карты внутри rich.
- Пользователь предложил вернуться к поддержке отправки live location в связи с появлением автоматизированных обработчиков. Точный объём этой части не согласован.
- Предложение: TypeScript для действий и сериализуемого состояния плюс JSX для декларативного рендера, без обязательной зависимости от React и его hooks. Разметку преобразовывать в native rich blocks; ссылки на локальные файлы и сохранённые Telegram file_id оформлять через типизированные помощники. Контроллер управляет uploads/file_sources, проверяет доступ и сохраняет сведения для повторного использования медиа при редактировании.
- Различать карту внутри rich и самостоятельное native live-location сообщение. Текущая карта rich имеет location/zoom/width/height/caption и не является native live location. У Telegram отдельные sendLocation, editMessageLiveLocation и stopMessageLiveLocation; JSX не отменяет разделение типов Telegram-сообщений.
- Открытый вопрос: нужны ли обработчикам уже в первой версии фоновые источники действий (таймеры или WebSocket), или live location обновляется только при нажатии/явном вызове. JSX сам по себе периодических обновлений не обеспечивает. Контракт, восстановление и остановка фоновых действий требуют отдельного согласования.
- Источники: [sendLocation](https://core.telegram.org/bots/api#sendlocation), [editMessageLiveLocation](https://core.telegram.org/bots/api#editmessagelivelocation), [stopMessageLiveLocation](https://core.telegram.org/bots/api#stopmessagelivelocation); текущий rich-контракт: docs/messaging.md и src/messages/rich-help.mjs.

По просьбе пользователя новые решения по этой идее сохраняем здесь в ходе обсуждения. Согласованные изменения переносим в соответствующие разделы; неподтверждённые варианты остаются предложениями. Текущую вики обновляем при реализации, не выдавая этот протокол за описание работающего функционала.

## Обсуждение: доступ к JSX-библиотеке и песочница

Пользователь уточнил: обработчик должен выполняться в изолированном процессе с песочницей текущего агента; для JSX нужен доступ к библиотеке.

Проверено в `src/codex/threads.mjs`: текущий профиль разрешает запись в директорию бота и собственный `.temp/AGENT_ID`, запрещает `.git` и остальные временные директории; отдельно разрешает чтение минимального runtime и каталога Codex. Эти правила применяются при запуске Codex. Обычный дочерний Node-процесс, запущенный контроллером, автоматически этот профиль не получает.

Предложение, пока не утверждено:

- Выделить общий read-only SDK с фиксированной версией, справкой и TypeScript-типами. Не открывать обработчику весь исходный код сервера или весь его `node_modules`.
- При `send_react` компилировать TSX и собирать локальные импорты с разрешённым SDK в JavaScript bundle. Использовать фиксированную конфигурацию сборки, проверять пути и символические ссылки; не исполнять агентские build plugins или конфигурацию.
- Сохранять bundle как неизменяемую зарегистрированную версию вне очищаемого через сутки `.temp`. Sandbox runner получает read-only доступ только к нужным runtime-артефактам.
- В sandbox-профиле обработчика воспроизвести права агента на директорию бота и собственный temp, добавив чтение выделенного runtime. Очистить окружение от серверных секретов и запускать процесс через механизм ОС, реально применяющий ограничения. Отдельный процесс, `cwd` и Node `vm` сами по себе не заменяют песочницу.
- Связь с контроллером через узкий IPC/RPC интерфейс с привязкой к регистрации: отправка, редактирование, JSON-состояние, callback-ответ и уведомление агента. Права определяет контроллер, не параметры, присланные скриптом.
- JSX можно компилировать в собственные функции `jsx`/`jsxs`: React не обязателен. Настоящий React с hooks и custom renderer — отдельный вариант, требующий выбора; не обещаем полную React-совместимость собственного SDK.
- Альтернатива bundle: выделенный SDK и зависимости доступны runtime только на чтение. Bundle предпочтителен для фиксирования версии и восстановления без разрешения импортов при каждом запуске.

Источники: [TypeScript JSX import source](https://www.typescriptlang.org/tsconfig/jsxImportSource.html), [esbuild API](https://esbuild.github.io/api/). Сборка, sandbox runner и совместимость на Alpine/Windows ещё не тестировались. Выбор конкретного механизма sandbox остаётся открытым и требует проверки перед реализацией.
