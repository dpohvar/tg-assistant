// Documentation checks only. No application runtime, credentials, or network calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dynamicTools } from '../../src/codex/threads.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const docs = path.join(root, 'docs');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const all = walk(docs);
const wiki = fs.readdirSync(docs).filter(name => name.endsWith('.md')).map(name => path.join(docs, name));
const markdown = [...all.filter(name => name.endsWith('.md')), path.join(root, 'README.md'), path.join(root, 'AGENTS.md')];
const current = new Set([...wiki, path.join(root, 'README.md'), path.join(root, 'AGENTS.md')]);
const problems = [];
const fail = (file, message) => problems.push(`${path.relative(root, file)}: ${message}`);
const withoutFences = text => text.replace(/^(`{3,}|~{3,}).*\r?\n[\s\S]*?^\1\s*$/gm, '');
const slugs = text => {
  const used = new Map();
  return new Set([...withoutFences(text).matchAll(/^#{1,6}\s+(.+)$/gm)].map(match => {
    const slug = match[1].trim().toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
    const count = used.get(slug) ?? 0;
    used.set(slug, count + 1);
    return count ? `${slug}-${count}` : slug;
  }));
};

for (const name of fs.readdirSync(docs, { withFileTypes: true })) {
  if (!(name.isFile() && name.name.endsWith('.md')) && name.name !== 'dev') fail(docs, `Unexpected top-level entry: ${name.name}`);
}

let links = 0, jsonExamples = 0;
for (const file of markdown) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of withoutFences(text).matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const [relative, anchor] = target.split('#');
    const resolved = relative ? path.resolve(path.dirname(file), decodeURIComponent(relative)) : file;
    links++;
    if (!fs.existsSync(resolved)) fail(file, `Missing link target: ${target}`);
    else if (anchor && current.has(file) && resolved.endsWith('.md') && !slugs(fs.readFileSync(resolved, 'utf8')).has(decodeURIComponent(anchor))) fail(file, `Missing heading anchor: ${target}`);
  }
  if (current.has(file)) {
    const fences = [...text.matchAll(/^```([^\r\n]*)\r?$/gm)];
    if (fences.length % 2) fail(file, 'Unbalanced fenced blocks');
    for (const match of text.matchAll(/^```json\r?\n([\s\S]*?)^```\s*$/gm)) {
      jsonExamples++;
      try { JSON.parse(match[1]); } catch (error) { fail(file, `Invalid JSON example: ${error.message}`); }
    }
    // A couple of Unicode letters in an English explanation of matching are fine.
    if (/[\u0400-\u04ff]{3,}/u.test(text)) fail(file, 'Non-English Cyrillic prose outside docs/dev');
  }
}

const contract = fs.readFileSync(path.join(docs, 'agent-contract.md'), 'utf8');
for (const tool of dynamicTools) if (!contract.includes('`' + tool.name + '`')) fail(path.join(docs, 'agent-contract.md'), `Undocumented controller tool: ${tool.name}`);
const childCommands = fs.readFileSync(path.join(docs, 'commands.md'), 'utf8');
if (/\/bot(?:\s|`)/.test(childCommands)) fail(path.join(docs, 'commands.md'), 'Master management command in child command reference');
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else console.log(`Checked ${wiki.length} wiki articles, ${links} local links, ${jsonExamples} JSON examples, and ${dynamicTools.length} controller tools.`);
