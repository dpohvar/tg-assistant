// Node resets inherited signal dispositions; nohup alone is not sufficient.
export function ignoreHangup() { process.on('SIGHUP', () => {}); }
