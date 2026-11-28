import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadPrivateRuntime,
  getPrivateRuntimeStatus,
  resetPrivateRuntimeLoaderForTests,
} from '../src/private-runtime/loader.js';

let baileysPeerAvailable = true;
try {
  await import.meta.resolve('@whiskeysockets/baileys');
} catch {
  baileysPeerAvailable = false;
}

const previousRequired = process.env.OCHA_PRIVATE_RUNTIME_REQUIRED;
const previousPath = process.env.OCHA_PRIVATE_RUNTIME_PATH;
const missingRuntimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-private-runtime-missing-'));
process.env.OCHA_PRIVATE_RUNTIME_REQUIRED = '0';
process.env.OCHA_PRIVATE_RUNTIME_PATH = missingRuntimeRoot;
const publicRuntime = await loadPrivateRuntime();

test('public installation uses compatibility mode when the local private runtime is absent', () => {
  assert.equal(publicRuntime, null);
  const status = getPrivateRuntimeStatus();
  assert.equal(status.checked, true);
  assert.equal(status.available, false);
  assert.equal(status.mode, 'public-compatibility');
});

test('public compatibility serializer exposes stable host API and preserves JID semantics', async () => {
  const serializerModule = await import('../src/lib/serializ_simple.js');
  const serializer = serializerModule.default;
  assert.equal(typeof serializer.serialize, 'function');
  assert.equal(typeof serializer.extendSocket, 'function');
  assert.equal(serializer.toJid('123456789@lid'), '123456789@lid');
  assert.equal(serializer.toJid('6281234567890'), '6281234567890@s.whatsapp.net');

  const sent = [];
  const sock = {
    user: { id: '6281111111111@s.whatsapp.net' },
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `out-${sent.length}`, remoteJid: jid, fromMe: true } };
    },
  };
  serializer.extendSocket(sock);
  const message = serializer.serialize(sock, {
    key: {
      remoteJid: '6282222222222@s.whatsapp.net',
      participant: '6282222222222@s.whatsapp.net',
      id: 'in-1',
      fromMe: false,
    },
    pushName: 'Test User',
    message: { conversation: 'Halo, periksa koneksi bot.' },
  });
  assert.equal(message.chat, '6282222222222@s.whatsapp.net');
  assert.equal(message.sender, '6282222222222@s.whatsapp.net');
  assert.equal(message.body, 'Halo, periksa koneksi bot.');
  assert.equal(message.isGroup, false);
  const reply = await message.reply('Balasan uji.');
  assert.equal(reply.key.id, 'out-1');
  assert.equal(sent[0].content.text, 'Balasan uji.');
  assert.equal(sent[0].options.quoted.key.id, 'in-1');
});

test('public compatibility serializer resolves only explicit LID-to-PN mappings', async () => {
  const serializer = (await import('../src/lib/serializ_simple.js')).default;
  const sock = { user: { id: '6281111111111@s.whatsapp.net' }, sendMessage: async () => ({ key: { id: 'out' } }) };
  serializer.extendSocket(sock);
  const message = serializer.serialize(sock, {
    key: {
      remoteJid: '12345@lid',
      remoteJidPn: '6282222222222@s.whatsapp.net',
      participant: '54321@lid',
      participantPn: '6283333333333@s.whatsapp.net',
      id: 'lid-1',
    },
    message: { conversation: 'LID test' },
  });
  assert.equal(message.chat, '6282222222222@s.whatsapp.net');
  assert.equal(message.sender, '6283333333333@s.whatsapp.net');
  const unresolved = serializer.serialize(sock, {
    key: { remoteJid: '98765@lid', participant: '98765@lid', id: 'lid-2' },
    message: { conversation: 'No fabricated PN' },
  });
  assert.equal(unresolved.chat, '98765@lid');
  assert.equal(unresolved.sender, '98765@lid');
});

test('public interactive adapter degrades to text without exposing copy-code values', async () => {
  const serializer = (await import('../src/lib/serializ_simple.js')).default;
  const sent = [];
  const sock = {
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
      return { key: { id: 'text-fallback' } };
    },
  };
  serializer.extendSocket(sock);
  await sock.sendInteractive('6282222222222@s.whatsapp.net', {
    title: 'PILIHAN',
    body: 'Menu pengujian',
    buttons: [
      {
        name: 'single_select',
        buttonParamsJson: JSON.stringify({
          sections: [{ title: 'Actions', rows: [{ id: '.status', title: 'Status bot' }] }],
        }),
      },
      {
        name: 'cta_copy',
        buttonParamsJson: JSON.stringify({
          display_text: 'Salin token',
          copy_code: ['DO_NOT_', 'LEAK_THIS_SECRET'].join(''),
        }),
      },
    ],
  });
  assert.match(sent[0].content.text, /Status bot/);
  assert.match(sent[0].content.text, /\.status/);
  assert.doesNotMatch(sent[0].content.text, /DO_NOT_LEAK_THIS_SECRET/);
  assert.match(sent[0].content.text, /Mode publik/);
});

test('public helper and fake-reply adapters expose bounded compatibility APIs', async () => {
  const helpers = (await import('../src/lib/helpers.js')).default;
  const freply = (await import('../src/lib/freply.js')).default;
  assert.equal(typeof helpers.AIRich, 'function');
  assert.equal(typeof helpers.tokenizeCode, 'function');
  assert.equal(typeof freply.createFakeReply, 'function');
  const fake = freply.createFakeReply('text', { text: 'quoted text', remoteJid: '6282222222222@s.whatsapp.net' });
  assert.equal(fake.message.conversation, 'quoted text');
  assert.equal(fake.key.remoteJid, '6282222222222@s.whatsapp.net');
  assert.equal(freply.compatibilityMode, true);
});

test('bundled private runtime loads immutable source and registers the owner-only test plugin', async t => {
  if (!baileysPeerAvailable) {
    t.skip('Baileys peer dependency is not installed; install project dependencies to test private serializer import.');
    return;
  }
  const bundledRoot = path.resolve('.private/ocha-private-runtime');
  try {
    await fs.access(path.join(bundledRoot, 'index.js'));
  } catch {
    t.skip('private runtime is not included in a public-only checkout');
    return;
  }

  resetPrivateRuntimeLoaderForTests();
  delete process.env.OCHA_PRIVATE_RUNTIME_PATH;
  process.env.OCHA_PRIVATE_RUNTIME_REQUIRED = '1';
  const runtime = await loadPrivateRuntime();
  assert.equal(runtime.available, true);
  assert.equal(runtime.version, '1.10.58');
  assert.equal(runtime.plugins.length, 1);
  assert.equal(runtime.plugins[0].name, 'test');
  assert.equal(runtime.plugins[0].ownerOnly, true);
  assert.equal(runtime.plugins[0].privateOnly, true);
  assert.equal(getPrivateRuntimeStatus().source, 'bundled-local');
});

test('required private-runtime mode fails closed when private package is missing', async () => {
  resetPrivateRuntimeLoaderForTests();
  process.env.OCHA_PRIVATE_RUNTIME_REQUIRED = '1';
  process.env.OCHA_PRIVATE_RUNTIME_PATH = missingRuntimeRoot;
  await assert.rejects(loadPrivateRuntime(), /ENOENT|index\.js|private runtime/i);
  assert.equal(getPrivateRuntimeStatus().available, false);
});

test('public optional mode falls back when a configured private package is broken', async () => {
  resetPrivateRuntimeLoaderForTests();
  process.env.OCHA_PRIVATE_RUNTIME_REQUIRED = '0';
  process.env.OCHA_PRIVATE_RUNTIME_PATH = missingRuntimeRoot;
  assert.equal(await loadPrivateRuntime(), null);
  assert.equal(getPrivateRuntimeStatus().mode, 'public-compatibility');
});

test.after(async () => {
  resetPrivateRuntimeLoaderForTests();
  await fs.rm(missingRuntimeRoot, { recursive: true, force: true });
  if (previousRequired === undefined) delete process.env.OCHA_PRIVATE_RUNTIME_REQUIRED;
  else process.env.OCHA_PRIVATE_RUNTIME_REQUIRED = previousRequired;
  if (previousPath === undefined) delete process.env.OCHA_PRIVATE_RUNTIME_PATH;
  else process.env.OCHA_PRIVATE_RUNTIME_PATH = previousPath;
});
