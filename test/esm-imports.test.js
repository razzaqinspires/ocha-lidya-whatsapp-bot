import test from 'node:test';
import assert from 'node:assert/strict';
import freply from '../src/lib/freply.js';
import helpers from '../src/lib/helpers.js';
import serializer from '../src/lib/serializ_simple.js';

test('converted source modules expose expected APIs',()=>{
  assert.equal(typeof freply.createFakeReply,'function');
  assert.equal(typeof freply.FakeReplyBuilder,'function');
  assert.equal(typeof helpers.AIRich,'function');
  assert.equal(typeof helpers.tokenizeCode,'function');
  assert.equal(typeof serializer.serialize,'function');
  assert.equal(typeof serializer.extendSocket,'function');
});
test('LID is never transformed into a fabricated phone JID',()=>{
  assert.equal(serializer.toJid('6281234567890'),'6281234567890@s.whatsapp.net');
  assert.equal(serializer.toJid('123456789@lid'),'123456789@lid');
});
