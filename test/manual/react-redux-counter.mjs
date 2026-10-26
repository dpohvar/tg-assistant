// Isolated browser demo: no Telegram calls, credentials or application startup.
// Dependencies are loaded from a public CDN; no npm installation is needed.
// Run: node test/manual/react-redux-counter.mjs
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {transform, stop} from 'esbuild';

const source = await readFile(new URL('./react-redux-counter.jsx', import.meta.url), 'utf8');
let code;
try {
  ({code} = await transform(source, {
    loader: 'jsx', jsx: 'automatic', jsxImportSource: 'react',
    sourcefile: 'react-redux-counter.jsx', format: 'esm', target: 'es2022',
  }));
} finally {
  stop();
}

const imports = {
  react: 'https://esm.sh/react@19.2.0',
  'react/jsx-runtime': 'https://esm.sh/react@19.2.0/jsx-runtime?external=react',
  'react-dom/client': 'https://esm.sh/react-dom@19.2.0/client?external=react',
  'react-redux': 'https://esm.sh/react-redux@9.2.0?external=react,redux',
  redux: 'https://esm.sh/redux@5.0.1',
  '@reduxjs/toolkit': 'https://esm.sh/@reduxjs/toolkit@2.9.0?external=react,react-redux,redux',
};
const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>React + Redux widget example</title>
<style>
  body {font: 16px/1.5 system-ui; margin: 40px auto; max-width: 760px; padding: 0 20px; color: #182535; background: #f5f6f8}
  h1 {font-size: 26px} h2 {font-size: 18px; margin: 0 0 12px}
  main {display: flex; flex-wrap: wrap; gap: 20px}
  section {background: white; border: 1px solid #c8ced7; border-radius: 10px; padding: 24px; flex: 1; min-width: 200px}
  output {display: block; font-size: 40px; font-variant-numeric: tabular-nums}
  .buttons {display: flex; gap: 8px; margin-top: 16px}
  button {font: inherit; cursor: pointer; padding: 6px 12px}
  pre {padding: 16px; background: #e8ecf1; border-radius: 8px}
</style>
<script type="importmap">${JSON.stringify({imports})}</script>
<div id="root">Loading React and Redux from the CDN…</div>
<script type="module" src="/app.js"></script>
</html>`;

const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/app.js') {
    response.writeHead(200, {'Content-Type': 'text/javascript; charset=utf-8'});
    response.end(code);
  } else if (request.url === '/') {
    response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    response.end(html);
  } else {
    response.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1', () => {
  console.log(`React Redux demo: http://127.0.0.1:${server.address().port}/`);
});

const deadline = setTimeout(() => server.close(), 30 * 60_000);
server.on('close', () => clearTimeout(deadline));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
