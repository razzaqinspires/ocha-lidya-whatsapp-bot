import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

test('namespaced repository uses append-only put/delete events', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-repo-test-'));
  process.chdir(temp);
  try {
    const dbUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href + `?repo=${Date.now()}`;
    const repoUrl = pathToFileURL(path.resolve(original, 'src/core/repository.js')).href + `?repo=${Date.now()}`;
    const db = await import(dbUrl);
    await db.initializeDatabase({ settings: { mirrorEnabled: true, fsync: false } });
    const repo = await import(repoUrl);
    await repo.putRecord('users', 'user-1', { name: 'Example' });
    assert.deepEqual(await repo.getRecord('users', 'user-1'), { name: 'Example' });
    await repo.putRecord('users', 'user-1', { name: 'Updated' });
    assert.deepEqual(await repo.listRecords('users'), { 'user-1': { name: 'Updated' } });
    await repo.deleteRecord('users', 'user-1');
    assert.equal(await repo.getRecord('users', 'user-1'), null);
  } finally {
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
