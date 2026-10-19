// Opt-in deterministic agent; real Telegram/controller/queue/tools, no model.
// node test/manual/say-ephemeral-acceptance.mjs PRIVATE_CONFIG COMPLETED_GROUP_PROBE [SECONDS]
process.argv[5]='say';
await import('./ephemeral-command-acceptance.mjs');
