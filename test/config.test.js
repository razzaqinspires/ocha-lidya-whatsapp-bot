import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

test('config facade replays persistent config.replace events from JSONL', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-config-test-'));
  process.chdir(temp);
  try {
    const configUrl = pathToFileURL(path.resolve(original, 'src/config.js')).href;
    const first = await import(`${configUrl}?first=${Date.now()}`);
    await first.loadConfig();
    assert.equal(first.getConfig().whatsapp.authMode, 'pairing');
    assert.equal(first.getConfig().whatsapp.browserName, 'Chrome');
    assert.equal(first.getConfig().schemaVersion, 6);
    assert.equal(first.getConfig().whatsapp.recoverInvalidSession, true);
    assert.equal(first.getConfig().logging.level, 'info');
    assert.equal(first.getConfig().logging.color, 'auto');
    await first.updateConfig(c => { c.mode = 'self'; c.prefix.single = '!'; c.prefix.mode = 'single'; c.whatsapp.authMode = 'pairing'; c.whatsapp.pairingNumber = '6282177461231'; }, { actor: 'test', reason: 'persistence test' });
    assert.equal(first.getConfig().mode, 'self');
    const db = await import(pathToFileURL(path.resolve(original, 'src/core/database.js')).href);
    const checkpoint = await db.getLatestConfigRecord();
    assert.equal(checkpoint.payload.config.mode, 'self');

    const second = await import(`${configUrl}?second=${Date.now()}`);
    await second.loadConfig();
    assert.equal(second.getConfig().mode, 'self');
    assert.equal(second.getConfig().prefix.single, '!');
    assert.equal(second.getConfig().whatsapp.authMode, 'pairing');
    assert.equal(second.getConfig().whatsapp.pairingNumber, '6282177461231');
    assert.equal(second.getConfig().whatsapp.browserName, 'Chrome');
    await assert.rejects(
      first.updateConfig(c => { c.whatsapp.browserName = 'Ocha Lidya'; }),
      /whatsapp.browserName harus/
    );
  } finally {
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});


test('v1.4.4 migrates legacy config to canonical browser, safe session recovery, and logger settings', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-config-migration-test-'));
  try {
    const databaseUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
    const configUrl = pathToFileURL(path.resolve(original, 'src/config.js')).href;
    const source = `
      const database = await import(${JSON.stringify(databaseUrl)});
      await database.initializeDatabase();
      await database.appendRecord('config.replace', {
        config: {
          schemaVersion: 4,
          bot: { owner: '6283193905842', expectedNumber: '6282177461231' },
          whatsapp: { authMode: 'pairing', pairingNumber: '6282177461231', browserName: 'Ocha Lidya' }
        },
        changedBy: 'test',
        reason: 'legacy v1.4.2 config'
      });
      const config = await import(${JSON.stringify(configUrl)});
      await config.loadConfig();
      console.log('MIGRATION_RESULT:' + JSON.stringify({ schemaVersion: config.getConfig().schemaVersion, browserName: config.getConfig().whatsapp.browserName }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: temp,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const resultLine = result.stdout.split(/\r?\n/).find(line => line.startsWith('MIGRATION_RESULT:'));
    assert.ok(resultLine, result.stdout);
    assert.deepEqual(JSON.parse(resultLine.slice('MIGRATION_RESULT:'.length)), { schemaVersion: 6, browserName: 'Chrome' });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
