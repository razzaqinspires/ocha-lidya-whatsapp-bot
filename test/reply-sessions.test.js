import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearReplySessions,
  dispatchReplySession,
  getReplySessionStats,
  registerReplySession
} from '../src/core/reply-sessions.js';

function makeMessage({ chat = 'chat-1', sender = 'user-1', quotedId = 'screen-1', body = '1' } = {}) {
  const replies = [];
  return {
    chat,
    sender,
    body,
    quoted: { key: { id: quotedId } },
    replies,
    async reply(text) { replies.push(text); return text; }
  };
}

test('command reply session routes a quoted numeric selection exactly once', async () => {
  clearReplySessions();
  const calls = [];
  registerReplySession({
    chat: 'chat-1', messageId: 'screen-1', sender: 'user-1', kind: 'list',
    choices: [{ key: '1', label: 'First', value: { id: 'group-1' } }],
    onSelect: async context => calls.push(context.value)
  });
  const message = makeMessage();
  const result = await dispatchReplySession({}, message);
  assert.equal(result.matched, true);
  assert.deepEqual(calls, [{ id: 'group-1' }]);
  assert.equal(getReplySessionStats().active, 0);
  assert.equal((await dispatchReplySession({}, message)).matched, false);
});

test('invalid reply remains in command lane and keeps the session active', async () => {
  clearReplySessions();
  registerReplySession({
    chat: 'chat-1', messageId: 'screen-1', sender: 'user-1',
    choices: [{ key: '1', value: 'one' }], onSelect: async () => {}
  });
  const message = makeMessage({ body: 'halo' });
  const result = await dispatchReplySession({}, message);
  assert.equal(result.matched, true);
  assert.equal(result.invalidChoice, true);
  assert.equal(message.replies.length, 1);
  assert.equal(getReplySessionStats().active, 1);
});

test('session cannot be selected by another sender in a group', async () => {
  clearReplySessions();
  let called = false;
  registerReplySession({
    chat: 'group@g.us', messageId: 'screen-1', sender: 'owner-1',
    choices: [{ key: '1', value: 'one' }], onSelect: async () => { called = true; }
  });
  const message = makeMessage({ chat: 'group@g.us', sender: 'member-2' });
  const result = await dispatchReplySession({}, message);
  assert.equal(result.matched, true);
  assert.equal(result.unauthorized, true);
  assert.equal(called, false);
});
