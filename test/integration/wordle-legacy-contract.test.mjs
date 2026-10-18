import test from 'node:test';
import assert from 'node:assert/strict';
import {loadWordleFixture} from '../helpers/wordle-fixture.mjs';

test('unmodified Wordle ignores an extra view argument and keeps native callback payloads',{skip:!process.env.TG_WORDLE_ARCHIVE},async t=>{
  const f=await loadWordleFixture(t,process.env.TG_WORDLE_ARCHIVE),state=f.initializedState;
  assert.deepEqual(f.module.render(state,{id:'v',target:{chatId:1,messageId:7},props:{part:'results'}}),f.module.render(state));
  const playing=await f.button('menu:start');assert.equal(playing.activeId,'1');assert.equal(playing.mode,'game');assert.ok(playing.idleDeadline>Date.now());
  const typed=await f.button('key:А');assert.equal(typed.players['1'].input,'А');
  const blocked=await f.button('key:Б',2);assert.equal(blocked.players['1'].input,'А');assert.ok(f.answers.length>=3);
  assert.deepEqual(f.sourceHashesAfter(),f.sourceHashesBefore);
});
