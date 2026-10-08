# Telegram Assistant

Личный Telegram-ассистент на Codex CLI: мастер-бот, отдельные агенты чатов, общая файловая wiki, планировщик и Git-синхронизация. Node.js 24.18.1+, Codex CLI 0.159.3; целевая среда — Alpine Linux, Windows используется для отладки.

Установка и запуск по SSH: [docs/operations.md](docs/operations.md). Пример конфигурации: [config.example.json](config.example.json).

- [Контракт агента](docs/agent-contract.md)
- [Роли и команды](docs/access-and-commands.md)
- [Проверки и ограничения](docs/implementation-progress.md)
- [Итоговая сверка](docs/v1-audit.md)

```sh
npm ci
npm test
npm run service:alpine_start -- /absolute/path/config.json
npm run service:alpine_status -- /absolute/path/config.json
npm run service:alpine_stop -- /absolute/path/config.json
```

Перед запуском установите Codex CLI (проверена версия 0.159.3; другие версии допускаются с предупреждением), авторизуйтесь им и создайте конфигурацию с отдельным файлом токена мастер-бота. Конфигурация, авторизация и данные не входят в репозиторий. Генерация использует авторизованный ChatGPT-аккаунт.
