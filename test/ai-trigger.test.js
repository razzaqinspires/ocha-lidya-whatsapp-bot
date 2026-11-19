import test from 'node:test';
import assert from 'node:assert/strict';
import { isAITrigger } from '../src/ai/engine.js';

const sock = {
  user: { id: '6282177461231@s.whatsapp.net', lid: '123456789012345@lid' },
  decodeJid(value) { return value; }
};
const base = { body: 'halo', isGroup: true, mentionedJid: [], quoted: null, fromMe: false };

test('AI accepts direct message when it is not a command', () => {
  assert.equal(isAITrigger(sock, { ...base, isGroup: false }), true);
});
test('AI rejects all group messages without bot mention or bot reply', () => {
  assert.equal(isAITrigger(sock, { ...base, body: 'halo semua' }), false);
});
test('AI accepts group mention of the exact bot JID', () => {
  assert.equal(isAITrigger(sock, { ...base, mentionedJid: ['6282177461231@s.whatsapp.net'] }), true);
});
test('AI accepts a reply to the bot message', () => {
  assert.equal(isAITrigger(sock, { ...base, quoted: { fromMe: true } }), true);
});
test('AI rejects reply to another participant', () => {
  assert.equal(isAITrigger(sock, { ...base, quoted: { fromMe: false, sender: '6280000000000@s.whatsapp.net' } }), false);
});
test('AI rejects prefixed messages and known commands', () => {
  assert.equal(isAITrigger(sock, { ...base, isGroup: false }, { prefixed: true }), false);
  assert.equal(isAITrigger(sock, { ...base, isGroup: false }, { hasKnownCommand: true }), false);
});

test('AI accepts the bot LID mention when it is exposed by the active session', () => {
  assert.equal(isAITrigger(sock, { ...base, mentionedJid: ['123456789012345@lid'] }), true);
});
test('AI does not accept a mention of a different participant', () => {
  assert.equal(isAITrigger(sock, { ...base, mentionedJid: ['6280000000000@s.whatsapp.net'] }), false);
});
