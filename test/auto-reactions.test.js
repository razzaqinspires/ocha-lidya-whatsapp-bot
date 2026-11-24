import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchWithAutoReaction } from '../src/core/auto-reactions.js';

const policy = {
  ui: { autoReactions: {
    enabled: true, commandEmoji: '⏳', thinkingEmoji: '💭', successEmoji: '✅', failureEmoji: '❌'
  } }
};

function mockSocket() {
  const events = [];
  return {
    events,
    async sendMessage(chat, payload) { events.push({ chat, payload }); return { key: { id: `reaction-${events.length}` } }; }
  };
}

test('plugin command reactions transition from loading to success', async () => {
  const sock = mockSocket();
  const message = { chat: '6280000000000@s.whatsapp.net', key: { id: 'incoming-1' }, id: 'incoming-1' };
  const result = await dispatchWithAutoReaction(sock, message, async () => ({ handled: true, allowed: true }), 'command', policy);
  assert.equal(result.allowed, true);
  assert.deepEqual(sock.events.map(event => event.payload.react.text), ['⏳', '✅']);
});

test('AI reaction uses thinking brain and ends on success', async () => {
  const sock = mockSocket();
  const message = { chat: '6280000000000@s.whatsapp.net', key: { id: 'incoming-2' }, id: 'incoming-2' };
  await dispatchWithAutoReaction(sock, message, async () => ({ provider: 'test', text: 'ok' }), 'ai', policy);
  assert.deepEqual(sock.events.map(event => event.payload.react.text), ['💭', '✅']);
});

test('failed dispatch updates the same message reaction to failure', async () => {
  const sock = mockSocket();
  const message = { chat: '6280000000000@s.whatsapp.net', key: { id: 'incoming-3' }, id: 'incoming-3' };
  await dispatchWithAutoReaction(sock, message, async () => null, 'ai', policy);
  assert.deepEqual(sock.events.map(event => event.payload.react.text), ['💭', '❌']);
});

test('disabled reaction policy preserves dispatch without sending reactions', async () => {
  const sock = mockSocket();
  const message = { chat: '6280000000000@s.whatsapp.net', key: { id: 'incoming-4' }, id: 'incoming-4' };
  let called = false;
  const result = await dispatchWithAutoReaction(sock, message, async () => { called = true; return 'ok'; }, 'command', { ui: { autoReactions: { enabled: false } } });
  assert.equal(called, true);
  assert.equal(result, 'ok');
  assert.equal(sock.events.length, 0);
});
