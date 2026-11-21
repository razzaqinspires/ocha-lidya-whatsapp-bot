import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { canCommitSourceBatch, classifySourceBatch, validateJsonFile } from '../src/core/source-batch.js';

const root = process.cwd();
const at = value => path.join(root, value);

test('plugin-only folder replacement is handled as a live registry update', () => {
  const result = classifySourceBatch([
    { file: at('src/plugins/owner/a.js'), event: 'change' },
    { file: at('src/plugins/owner/b.js'), event: 'add' },
    { file: at('src/plugins/owner/old.js'), event: 'unlink' }
  ]);
  assert.equal(result.requiresRestart, false);
  assert.equal(result.requiresInstall, false);
});

test('a mixed folder update creates one core restart batch and notices dependency manifests', () => {
  const result = classifySourceBatch([
    { file: at('src/index.js'), event: 'change' },
    { file: at('src/ai/engine.js'), event: 'change' },
    { file: at('src/plugins/owner/a.js'), event: 'add' },
    { file: at('package.json'), event: 'change' },
    { file: at('package-lock.json'), event: 'change' }
  ]);
  assert.equal(result.requiresRestart, true);
  assert.equal(result.requiresInstall, true);
  assert.equal(result.coreFiles.length, 4);
  assert.equal(result.files.length, 5);
});

test('package manifest update is a restart transaction even without JavaScript changes', () => {
  const result = classifySourceBatch([{ file: at('package.json'), event: 'change' }]);
  assert.equal(result.requiresRestart, true);
  assert.equal(result.requiresInstall, true);
});


test('source batch waits when a new filesystem event arrives during stabilization', () => {
  assert.equal(canCommitSourceBatch({ capturedRevision: 4, currentRevision: 5, firstSnapshot: 'a', secondSnapshot: 'a', elapsedMs: 1000, maxWindowMs: 300000 }), false);
});

test('source batch commits only after stable snapshots or the bounded maximum window', () => {
  assert.equal(canCommitSourceBatch({ capturedRevision: 4, currentRevision: 4, firstSnapshot: 'a', secondSnapshot: 'a', elapsedMs: 5000, maxWindowMs: 300000 }), true);
  assert.equal(canCommitSourceBatch({ capturedRevision: 4, currentRevision: 4, firstSnapshot: 'a', secondSnapshot: 'b', elapsedMs: 1200, maxWindowMs: 300000 }), false);
  assert.equal(canCommitSourceBatch({ capturedRevision: 4, currentRevision: 4, firstSnapshot: 'a', secondSnapshot: 'b', elapsedMs: 300001, maxWindowMs: 300000 }), true);
});


test('core configuration, plugin assets, and bootstrap scripts require a controlled restart', () => {
  const sourceConfig = classifySourceBatch([{ file: at('src/config.json'), event: 'change' }]);
  const pluginAsset = classifySourceBatch([{ file: at('src/plugins/owner/templates/menu.json'), event: 'change' }]);
  const bootstrapScript = classifySourceBatch([{ file: at('scripts/bootstrap/ensure-host.sh'), event: 'change' }]);
  assert.equal(sourceConfig.requiresRestart, true);
  assert.equal(pluginAsset.requiresRestart, true);
  assert.equal(bootstrapScript.requiresRestart, true);
});


test('JSON files in a bulk source update are parsed before a restart can commit', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-source-json-validation-'));
  const file = path.join(directory, 'config.json');
  try {
    await fs.writeFile(file, '{invalid');
    const invalid = await validateJsonFile(file);
    assert.equal(invalid.valid, false);
    assert.match(invalid.detail, /JSON parse error/);
    await fs.writeFile(file, '{"valid":true}');
    const valid = await validateJsonFile(file);
    assert.equal(valid.valid, true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
