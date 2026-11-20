import test from 'node:test';
import assert from 'node:assert/strict';
import { isRuntimeWatchIgnored } from '../src/core/watch-policy.js';

test('runtime and private directories are excluded from recursive filesystem watchers', () => {
  for (const value of [
    'sessions/ocha-lidya/pre-key-1255.json',
    'sessions.invalid-2026-11-20/auth.json',
    'data/journal/active.jsonl',
    'logs/ocha.log',
    'node_modules/chokidar/index.js',
    '.git/objects/pack/file',
    'coverage/report.json',
    'tmp/build.tmp'
  ]) assert.equal(isRuntimeWatchIgnored(value), true, value);
});

test('source and documentation files remain eligible for watch events', () => {
  for (const value of ['src/index.js', 'src/plugins/general/owner.js', 'README.md', 'docs/HOT_RELOAD.md', '.env.example']) {
    assert.equal(isRuntimeWatchIgnored(value), false, value);
  }
});
