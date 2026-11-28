import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  AC_BRANCH,
  AC_REMOTE,
  AC_REPOSITORY,
  AC_ROOT,
  isAcRuntimeIgnored,
  isExpectedNestedAcGitRoot,
  normalizeAcRemote,
} from '../src/core/ac-git-policy.js';

test('AC auto-push is pinned to its own allow-listed repository and main branch', () => {
  assert.equal(AC_REPOSITORY, 'razzaqinspires/artificial-consciousness-component');
  assert.equal(AC_BRANCH, 'main');
  assert.equal(AC_REMOTE, 'https://github.com/razzaqinspires/artificial-consciousness-component.git');
  assert.equal(
    normalizeAcRemote(`${AC_REMOTE}/`),
    'https://github.com/razzaqinspires/artificial-consciousness-component',
  );
  assert.notEqual(normalizeAcRemote(AC_REMOTE), 'https://github.com/razzaqinspires/ocha-lidya-whatsapp-bot');
});

test('nested AC Git setup recognizes the parent Ocha clone but rejects other Git roots', () => {
  const ochaRoot = path.resolve(AC_ROOT, '../..');
  assert.equal(isExpectedNestedAcGitRoot(AC_ROOT), true);
  assert.equal(isExpectedNestedAcGitRoot(ochaRoot), false);
  assert.throws(() => isExpectedNestedAcGitRoot('/tmp/unrelated-repository'), /Nested Git root tidak cocok/);
});

test('AC watcher excludes Git internals, secrets, memory ledgers and runtime state', () => {
  for (const file of [
    '.git/config',
    'ac/__pycache__/kernel.cpython-312.pyc',
    '.env',
    '.env.production',
    'ac_config.json',
    'nadi_state/kernel_state.json',
    'data/eternal_chain.jsonl',
    'logs/runtime.log',
    'kernel_state.json',
    '.scope-salt',
    'dist/package.zip',
    '.ssh/id_ed25519',
    '.aws/credentials',
    'secrets/provider.json',
    'credentials/service-account.json',
    'tls/server.pem',
    'certs/private.key',
    'release/signing.p12',
    'database/runtime.sqlite',
  ])
    assert.equal(isAcRuntimeIgnored(file), true, `${file} must be excluded`);
  assert.equal(isAcRuntimeIgnored('.env.example'), false);
});

test('AC watcher permits reviewed source and documentation files', () => {
  for (const file of ['ac/kernel.py', 'ac/mimpi.py', 'README.md', 'CHANGELOG.md', 'pyproject.toml', 'selftest.py']) {
    assert.equal(isAcRuntimeIgnored(file), false, `${file} must remain observable`);
  }
});
