import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

test('JSONL database appends durable events and repairs a damaged mirror from primary', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-db-test-'));
  process.chdir(temp);
  try {
    const moduleUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href + `?test=${Date.now()}`;
    const db = await import(moduleUrl);
    await db.initializeDatabase({ settings: { segmentMaxBytes: 1024 * 1024, mirrorEnabled: true, fsync: false } });
    await db.appendRecord('test.event', { value: 1 });
    await db.appendRecord('test.event', { value: 2 });
    const rows = await db.getRecords({ type: 'test.event' });
    assert.equal(rows.length, 2);
    assert.equal(rows[1].seq, 2);
    await fs.writeFile(path.join(temp, 'data/replica/active.jsonl'), '{"broken":');
    const restarted = await import(pathToFileURL(path.resolve(original, 'src/core/database.js')).href + `?restart=${Date.now()}`);
    await restarted.initializeDatabase({ settings: { segmentMaxBytes: 1024 * 1024, mirrorEnabled: true, fsync: false } });
    const health = await restarted.databaseHealth();
    assert.equal(health.primary.records, 2);
    assert.equal(health.mirror.records, 2);
  } finally {
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
