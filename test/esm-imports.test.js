import test from 'node:test';
import assert from 'node:assert/strict';

let baileysInstalled = true;
try { await import.meta.resolve('@whiskeysockets/baileys'); } catch { baileysInstalled = false; }

test('converted source modules expose expected APIs', { skip: !baileysInstalled }, async () => {
  const { default: freply } = await import('../src/lib/freply.js');
  const { default: helpers } = await import('../src/lib/helpers.js');
  const { default: serializer } = await import('../src/lib/serializ_simple.js');
  assert.equal(typeof freply.createFakeReply, 'function');
  assert.equal(typeof freply.FakeReplyBuilder, 'function');
  assert.equal(typeof helpers.AIRich, 'function');
  assert.equal(typeof helpers.tokenizeCode, 'function');
  assert.equal(typeof serializer.serialize, 'function');
  assert.equal(typeof serializer.extendSocket, 'function');
});

test('LID is never transformed into a fabricated phone JID', { skip: !baileysInstalled }, async () => {
  const { default: serializer } = await import('../src/lib/serializ_simple.js');
  assert.equal(serializer.toJid('6281234567890'), '6281234567890@s.whatsapp.net');
  assert.equal(serializer.toJid('123456789@lid'), '123456789@lid');
});
