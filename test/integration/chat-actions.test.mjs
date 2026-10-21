import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/storage/database.mjs';
import {createController} from '../../src/controller.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t) {
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1000});
  const db = openDatabase(':memory:');
  db.registerBot({botId:'b',telegramId:42,username:'bot',ownerId:1});
  let finish;
  const root = new Promise(resolve => { finish = resolve; });
  const calls = [], steered = [];
  const agent = {
    async run(scope) { agent.onAvailability(scope.agentId, 'working'); await root; },
    async steer(_id, events) { steered.push(events); },
  };
  const controller = createController({db,agent,telegram:{async call(botId, method, args) {
    if (method === 'sendChatAction') calls.push({botId,...args});
    return {};
  }}});
  t.after(async () => { finish(); controller.close(); await controller.idle(); db.close(); });
  let messageId = 0;
  const send = text => controller.receive('b',{message:{message_id:++messageId,date:1,chat:{id:1,type:'private'},from:{id:1},text}});
  await send('work'); t.mock.timers.tick(200); await tick();
  const id = db.agent('b',1).agentId;
  return {agent,controller,calls,steered,id,send,finish};
}

test('image generation overrides typing only while new work cannot start', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.calls.at(-1), {botId:'b',chat_id:1,action:'typing'});
  f.agent.onImageStatus(f.id, 'root:image', true);
  assert.equal(f.calls.at(-1).action, 'upload_photo');
  const sent = f.calls.length;
  t.mock.timers.tick(4000);
  assert.equal(f.calls.length, sent + 1);
  assert.equal(f.calls.at(-1).action, 'upload_photo');
  f.agent.onImageStatus(f.id, 'child:image', true);
  f.agent.onImageStatus(f.id, 'root:image', false);
  assert.equal(f.calls.at(-1).action, 'upload_photo');
  f.agent.onImageStatus(f.id, 'child:image', false);
  assert.equal(f.calls.at(-1).action, 'typing');
});

test('steerable waiting hides image status until the next input occupies the queue', async t => {
  const f = await fixture(t);
  f.agent.onImageStatus(f.id, 'child:image', true);
  f.agent.onAvailability(f.id, 'waiting');
  f.calls.length = 0;
  t.mock.timers.tick(8000);
  f.agent.onImageStatus(f.id, 'child:second', true);
  assert.deepEqual(f.calls, []);
  await f.send('continue'); t.mock.timers.tick(200); await tick();
  assert.equal(f.steered.length, 1);
  assert.equal(f.steered[0][0].textPlain, 'continue');
  assert.equal(f.calls.at(-1).action, 'upload_photo');
});

test('an idle queue hides background image status even before an idle notification', async t => {
  const f = await fixture(t);
  f.agent.onImageStatus(f.id, 'child:image', true);
  f.finish(); await f.controller.idle();
  f.calls.length = 0;
  t.mock.timers.tick(8000);
  f.agent.onImageStatus(f.id, 'child:second', true);
  assert.deepEqual(f.calls, []);
  f.agent.onAvailability(f.id, 'idle');
  f.agent.onImageStatus(f.id, 'child:image', false);
  assert.deepEqual(f.calls, []);
});

test('queue holds and pauses prevent immediate processing during a root wait', async t => {
  const f = await fixture(t);
  f.agent.onAvailability(f.id, 'waiting');
  f.calls.length = 0;
  f.controller.queue.setHeld(f.id, 'maintenance', true);
  assert.equal(f.calls.at(-1)?.action, 'typing');
  f.controller.queue.setHeld(f.id, 'maintenance', false);
  f.calls.length = 0;
  f.agent.onImageStatus(f.id, 'child:image', true);
  assert.deepEqual(f.calls, []);
  f.controller.queue.setPaused(f.id, true);
  assert.equal(f.calls.at(-1)?.action, 'upload_photo');
  f.controller.queue.setPaused(f.id, false);
  f.calls.length = 0;
  f.agent.onImageStatus(f.id, 'child:image', false);
  assert.deepEqual(f.calls, []);
});

test('collecting a burst preserves the existing action refresh instead of resending per event', async t => {
  const f = await fixture(t);
  f.calls.length = 0;
  await f.send('one'); await f.send('two');
  assert.deepEqual(f.calls, []);
  t.mock.timers.tick(4000); await tick();
  assert.deepEqual(f.calls, [{botId:'b',chat_id:1,action:'typing'}]);
});
