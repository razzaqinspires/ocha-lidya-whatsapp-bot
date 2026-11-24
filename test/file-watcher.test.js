import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { getWatcherBackend, watchFiles } from '../src/core/file-watcher.js';

async function waitFor(predicate, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await delay(25);
  }
  throw new Error('Timed out waiting for filesystem watcher event');
}

test('file watcher loads chokidar when installed or uses native fallback without crashing', async () => {
  assert.ok(['chokidar', 'node:fs.watch'].includes(getWatcherBackend()));
});

test('native filesystem watcher fallback normalizes add, change and unlink events', async t => {
  if (getWatcherBackend() !== 'node:fs.watch') return t.skip('chokidar is installed; native fallback test is not applicable');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-native-watch-'));
  const ignored = path.join(root, 'ignored');
  await fs.mkdir(ignored);
  const watcher = watchFiles(root, { ignored: candidate => candidate === ignored || candidate.startsWith(`${ignored}${path.sep}`), awaitWriteFinish: { stabilityThreshold: 60 } });
  const events = [];
  watcher.on('all', (event, file) => events.push({ event, file }));
  try {
    await waitFor(() => watcher.ready);
    const target = path.join(root, 'sample.js');
    await fs.writeFile(target, 'export const first = 1;');
    await waitFor(() => events.some(item => item.event === 'add' && item.file === target));
    await fs.writeFile(target, 'export const second = 2;');
    await waitFor(() => events.some(item => item.event === 'change' && item.file === target));
    await fs.rm(target);
    await waitFor(() => events.some(item => item.event === 'unlink' && item.file === target));
    const nestedDirectory = path.join(root, 'new-plugin');
    await fs.mkdir(nestedDirectory);
    const nestedFile = path.join(nestedDirectory, 'plugin.js');
    await fs.writeFile(nestedFile, 'export default { name: \"nested\" };');
    await waitFor(() => events.some(item => item.event === 'add' && item.file === nestedFile));
    await fs.writeFile(path.join(ignored, 'private.js'), 'ignored');
    await delay(180);
    assert.equal(events.some(item => item.file.includes(`${path.sep}ignored${path.sep}`)), false);
  } finally {
    await watcher.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
