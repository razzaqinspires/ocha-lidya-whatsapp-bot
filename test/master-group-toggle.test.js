import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PROJECT_ROOT = process.cwd();

test('master group access is owner-toggleable and defaults to disabled', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-master-group-'));
  const original = process.cwd();
  try {
    process.chdir(temporary);
    const config = await import(pathToFileURL(path.join(PROJECT_ROOT, 'src/config.js')).href);
    await config.loadConfig();
    const plugin = (await import(pathToFileURL(path.join(PROJECT_ROOT, 'src/plugins/owner/master.js')).href)).default;
    assert.equal(plugin.privateOnly, false);
    assert.equal(config.getConfig().security.allowMasterInGroups, false);
    const replies = [];
    const m = { sender: '6283193905842@s.whatsapp.net', reply: async text => { replies.push(String(text)); return { key: { id: 'reply' } }; } };
    await plugin.execute({ m, args: ['group', 'on'] });
    assert.equal(config.getConfig().security.allowMasterInGroups, true);
    assert.match(replies.at(-1), /ON/);
    await plugin.execute({ m, args: ['group', 'off'] });
    assert.equal(config.getConfig().security.allowMasterInGroups, false);
  } finally {
    process.chdir(original);
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
