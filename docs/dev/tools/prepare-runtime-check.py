"""Prepare and gate a Linux Codex probe in a dedicated directory.

The profile deliberately does not extend :workspace (which grants broad reads).
Auth is copied only to the controller home; never to the agent working directory.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True)
parser.add_argument('--codex', required=True)
parser.add_argument('--node', required=True)
parser.add_argument('--auth-file')
args = parser.parse_args()
root = Path(args.root).resolve()
if root == Path.home() or root == Path('/'):
    raise SystemExit('Use a dedicated test directory, not a home or filesystem root.')
bot = root / 'fixture/bot'
control = root / 'control-home'
codex = Path(args.codex).resolve()
node = Path(args.node).resolve()
for directory in [bot / '.temp/a1', bot / '.temp/a2', root / 'fixture/controller', control, root / 'results']:
    directory.mkdir(parents=True, exist_ok=True)
control.chmod(0o700)
(bot / 'wiki.txt').write_text('Shared wiki canary', encoding='utf-8')
(bot / '.temp/a1/own.txt').write_text('Own temporary canary', encoding='utf-8')
(bot / '.temp/a2/private.txt').write_text('Foreign temporary canary', encoding='utf-8')
(root / 'fixture/controller/secret.txt').write_text('Synthetic secret canary', encoding='utf-8')
probe = '''import fs from 'node:fs';
const root = process.argv[2];
const tests = {wiki:root+'/bot/wiki.txt',own:root+'/bot/.temp/a1/own.txt',foreign:root+'/bot/.temp/a2/private.txt',controller:root+'/controller/secret.txt'};
const result={};
for(const [key,path] of Object.entries(tests)){try{fs.readFileSync(path);result[key]='readable';}catch(e){result[key]=e.code;}}
for(const [key,path] of Object.entries({wikiWrite:root+'/bot/probe.txt',ownWrite:root+'/bot/.temp/a1/probe.txt',foreignWrite:root+'/bot/.temp/a2/probe.txt',controllerWrite:root+'/controller/probe.txt'})){try{fs.writeFileSync(path,'probe');result[key]='writable';}catch(e){result[key]=e.code;}}
console.log(JSON.stringify(result));
'''
(bot / 'probe.mjs').write_text(probe, encoding='utf-8')
lines = [
    'approval_policy = "never"', 'default_permissions = "tg-check"',
    'web_search = "live"', '[features]', 'multi_agent = true',
    '[permissions.tg-check.filesystem]', '":minimal" = "read"',
    json.dumps(str(bot)) + ' = "write"',
    json.dumps(str(bot / '.temp')) + ' = "deny"',
    json.dumps(str(bot / '.temp/a1')) + ' = "write"',
    json.dumps(str(node.parent)) + ' = "read"',
    json.dumps(str(codex.parent.parent)) + ' = "read"',
    '[permissions.tg-check.network]', 'enabled = false',
]
(control / 'config.toml').write_text('\n'.join(lines) + '\n', encoding='utf-8')
env = dict(os.environ, CODEX_HOME=str(control))
for key in list(env):
    if any(word in key.upper() for word in ['TOKEN', 'SECRET', 'PASSWORD', 'API_KEY']):
        del env[key]
run = subprocess.run(
    [str(codex), 'sandbox', '-C', str(bot), '-P', 'tg-check', str(node), str(bot / 'probe.mjs'), str(root / 'fixture')],
    env=env, capture_output=True, text=True, timeout=45,
)
result = {'exitCode': run.returncode, 'stdout': run.stdout, 'stderr': run.stderr}
(root / 'sandbox-probe.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
try:
    access = json.loads(run.stdout)
except json.JSONDecodeError:
    access = {}
expected = {'wiki': 'readable', 'own': 'readable', 'wikiWrite': 'writable', 'ownWrite': 'writable'}
denied = ['foreign', 'controller', 'foreignWrite', 'controllerWrite']
passed = run.returncode == 0 and all(access.get(k) == v for k, v in expected.items()) and all(access.get(k) in ['ENOENT', 'EACCES', 'EPERM'] for k in denied)
(root / 'results/sandbox-gate.json').write_text(json.dumps({'passed': passed, 'access': access}, indent=2), encoding='utf-8')
if not passed:
    raise SystemExit('Filesystem gate failed. Inspect sandbox-probe.json; inference must not run.')
if args.auth_file:
    source = Path(args.auth_file).resolve()
    destination = control / 'auth.json'
    if source == destination:
        raise SystemExit('Auth source must be outside the disposable controller home.')
    shutil.copyfile(source, destination)
    destination.chmod(0o600)
print(json.dumps({'passed': True, 'root': str(root), 'access': access}))
