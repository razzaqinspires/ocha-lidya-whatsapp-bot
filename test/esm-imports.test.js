import test from 'node:test';
import assert from 'node:assert/strict';

let baileysInstalled = true;
try {
  await import.meta.resolve('@whiskeysockets/baileys');
} catch {
  baileysInstalled = false;
}

test('public adapters expose stable APIs without requiring private source files', async () => {
  const { default: freply } = await import('../src/lib/freply.js');
  const { default: helpers } = await import('../src/lib/helpers.js');
  const { default: serializer } = await import('../src/lib/serializ_simple.js');
  assert.equal(typeof freply.createFakeReply, 'function');
  assert.equal(typeof helpers.AIRich, 'function');
  assert.equal(typeof helpers.tokenizeCode, 'function');
  assert.equal(typeof serializer.serialize, 'function');
  assert.equal(typeof serializer.extendSocket, 'function');
});

test('private source filenames resolve to public adapter modules', async () => {
  for (const path of ['../src/lib/helpers.js', '../src/lib/freply.js', '../src/lib/serializ_simple.js']) {
    const module = await import(path);
    assert.ok(module.default);
  }
});

test(
  'media download dependency is lazy and public adapter import is safe before Baileys install',
  { skip: baileysInstalled },
  async () => {
    const module = await import('../src/lib/serializ_simple.js');
    assert.equal(typeof module.default.downloadMedia, 'function');
  },
);
