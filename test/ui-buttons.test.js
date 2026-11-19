import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('command replies use native quick replies by default and plain text when owner disables buttons', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-ui-test-'));
  process.chdir(temp);
  try {
    const config = await import(pathToFileURL(path.resolve(original, 'src/config.js')).href);
    await config.loadConfig();
    const ui = await import(pathToFileURL(path.resolve(original, 'src/core/ui.js')).href);
    let interactive = 0;
    let plain = 0;
    const sock = { sendInteractive: async (_chat, payload) => { interactive += 1; return payload; } };
    const message = { chat: '6283193905842@s.whatsapp.net', key: { id: 'message-1' }, reply: async () => { plain += 1; } };
    ui.withCommandButtons(sock, message);
    const sent = await message.reply('Tes command');
    assert.equal(interactive, 1);
    assert.equal(plain, 0);
    assert.equal(sent.buttons.length, 3);
    await config.updateConfig(value => { value.ui.buttonsEnabled = false; });
    await message.reply('Plain command');
    assert.equal(plain, 1);
    assert.equal(interactive, 1);
  } finally {
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
