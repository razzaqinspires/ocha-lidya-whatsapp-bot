import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('anti-spam issues one initial notice, counts five later warnings, then temporary-bans all bot access', async () => {
  const original = process.cwd();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-antispam-'));
  process.chdir(temporary);
  try {
    const database = await import(`${pathToFileURL(path.resolve(original, 'src/core/database.js')).href}?antispam-test`);
    await database.initializeDatabase({ settings: { mirrorEnabled: false, fsync: false } });
    const governor = await import(`${pathToFileURL(path.resolve(original, 'src/core/command-governor.js')).href}?antispam-test`);
    const sender = '6281111111111@s.whatsapp.net';
    assert.equal((await governor.inspectAntiSpam({ sender, command: 'menu', now: 1000 })).allowed, true);
    const first = await governor.inspectAntiSpam({ sender, command: 'menu', now: 2000 });
    assert.equal(first.initialWarning, true);
    let time = 35_000;
    let last;
    for (let strike = 0; strike < 5; strike++) {
      await governor.inspectAntiSpam({ sender, command: 'menu', now: time });
      last = await governor.inspectAntiSpam({ sender, command: 'menu', now: time + 100 });
      time += 31_000;
    }
    assert.equal(last.banned, true);
    assert.equal(last.banLevel, 1);
    assert.ok(last.durationMs >= 5 * 60_000);
    const blocked = await governor.isUserTemporarilyBanned(sender, time);
    assert.equal(blocked.banned, true);
  } finally {
    process.chdir(original);
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
