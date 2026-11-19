import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('all command replies preserve serializer text transport even when interactive preference is on', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-ui-test-'));
  process.chdir(temp);
  try {
    const config = await import(pathToFileURL(path.resolve(original, 'src/config.js')).href);
    await config.loadConfig();
    await config.updateConfig(value => { value.ui.buttonsEnabled = true; });
    const ui = await import(pathToFileURL(path.resolve(original, 'src/core/ui.js')).href);
    let interactive = 0;
    let text = 0;
    const sock = { sendInteractive: async () => { interactive += 1; } };
    const message = { chat: '6283193905842@s.whatsapp.net', key: { id: 'message-1' }, reply: async (body) => { text += 1; return body; } };
    const originalReply = message.reply;
    ui.withCommandButtons(sock, message);
    assert.equal(message.reply, originalReply, 'serializer reply must not be monkey-patched');
    const result = await message.reply('Tes command yang bisa disalin');
    assert.equal(result, 'Tes command yang bisa disalin');
    assert.equal(text, 1);
    assert.equal(interactive, 0);
  } finally {
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('command list renders as plain text and keeps list selections copyable', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-ui-list-test-'));
  process.chdir(temp);
  try {
    const ui = await import(pathToFileURL(path.resolve(original, 'src/core/ui.js')).href);
    let sent = '';
    const m = { reply: async text => { sent = text; } };
    await ui.sendCommandList({}, m, { title: 'MENU', body: '.ping\n.owner' });
    assert.match(sent, /MENU/);
    assert.match(sent, /\.ping/);
    assert.match(sent, /\.owner/);
  } finally {
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
