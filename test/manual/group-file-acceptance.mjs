// Opt-in actual-controller file/help acceptance in the previously observed test group.
// node test/manual/group-file-acceptance.mjs PRIVATE_CONFIG COMPLETED_GROUP_PROBE [SECONDS]
process.argv[5]='files';
await import('./ephemeral-command-acceptance.mjs');
