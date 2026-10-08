import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitChanges, gitRun, gitSync } from '../../src/git/operations.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('sync stages unstaged/untracked wiki files but excludes pre-staged temp files', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-git-')), repo = path.join(root, 'wiki'), remote = path.join(root, 'remote');
  fs.mkdirSync(repo); fs.mkdirSync(remote);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await gitRun(remote, ['init', '--bare']); await gitRun(repo, ['init', '-b', 'main']);
  fs.writeFileSync(path.join(repo, 'index.md'), 'initial');
  await gitRun(repo, ['add', '.']);
  await gitRun(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'initial']);
  await gitRun(repo, ['remote', 'add', 'origin', remote]); await gitRun(repo, ['push', '-u', 'origin', 'main']);
  fs.writeFileSync(path.join(repo, 'index.md'), 'modified'); fs.writeFileSync(path.join(repo, 'new.md'), 'new');
  fs.mkdirSync(path.join(repo, '.temp')); fs.writeFileSync(path.join(repo, '.temp', 'private.txt'), 'do not publish');
  await gitRun(repo, ['add', '.temp']);
  const options = { root: repo, configured: true, branch: 'main' };
  const changes = await gitChanges(options);
  assert.ok(changes.files.some(line => line.includes('index.md'))); assert.ok(changes.files.some(line => line.includes('new.md')));
  assert.ok(changes.files.every(line => !line.includes('.temp')));
  assert.equal((await gitSync(options, 'wiki update')).push, 'ok');
  const tree = await gitRun(remote, ['ls-tree', '-r', '--name-only', 'main']);
  assert.equal(tree, 'index.md\nnew.md');
  assert.ok(fs.existsSync(path.join(repo, '.temp', 'private.txt')));
});
test('agent git tools report missing configuration as an error', async () => {
  const result = await gitChanges({ configured: false });
  assert.equal(result.error, 'git_not_configured'); assert.match(result.description, /git_setup/);
});

test('git authentication helper supplies credentials to an HTTP challenge', async t => {
  const http = await import('node:http');
  const { gitAuth } = await import('../../src/git/operations.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-auth-'));
  const tokenFile = path.join(root, 'token'); fs.writeFileSync(tokenFile, 'test-only-secret');
  let authenticated = false;
  const server = http.createServer((req, res) => {
    if (req.headers.authorization === 'Basic ' + Buffer.from('oauth2:test-only-secret').toString('base64')) {
      authenticated = true; res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-advertisement' }); res.end('0000');
    } else { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"' }); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  // Only the authentication handshake is under test, not the Git wire protocol.
  try { await gitRun(root, ['ls-remote', `http://127.0.0.1:${server.address().port}/repo`], gitAuth(tokenFile)); } catch {}
  assert.equal(authenticated, true);
});

test('git_sync preserves multiline pre as the actual commit message', async t => {
 const {openDatabase}=await import('../../src/storage/database.mjs');
 const {createCommands}=await import('../../src/commands/router.mjs');
 const {createFileCommands}=await import('../../src/commands/files.mjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tg-pre-')),repo=path.join(dir,'b'),remote=path.join(dir,'remote');fs.mkdirSync(repo);fs.mkdirSync(remote);
 const db=openDatabase(':memory:');t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});db.registerBot({botId:'b',telegramId:42,username:'test',ownerId:1});
 await gitRun(remote,['init','--bare']);await gitRun(repo,['init','-b','main']);await gitRun(repo,['remote','add','origin',remote]);
 db.sql.prepare('INSERT INTO git_settings VALUES(?,?,?,?)').run('b','main',remote,null);fs.writeFileSync(path.join(repo,'test.md'),'test');
 const replies=[],telegram={call:async(_b,_m,a)=>replies.push(a)};
 const config={botsDir:dir};const fileCommands=createFileCommands({db,config,telegram});const router=createCommands({db,config,telegram,fileCommands});
 const body='Title\n\nFirst line\nSecond line';
 await router.handle('b',{text:'/git_sync '+body,entities:[{type:'pre',offset:10,length:body.length}],message_id:1,from:{id:1},chat:{id:1,type:'private'}});
 assert.equal(JSON.parse(replies.at(-1).text).push,'ok');
 assert.equal(await gitRun(repo,['log','-1','--format=%B']),body);
});
