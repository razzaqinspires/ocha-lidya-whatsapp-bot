import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import chatnivoPlugin from '../src/plugins/owner/chatnivo.js';
import { getChatNivoInferenceStatus } from '../src/integrations/chatnivo/inference.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contributionRoot = path.join(root, '.private', 'contributions', 'chatnivo-personal-exporter-v1');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('ChatNivo contributed original files still match the immutable intake manifest', async () => {
  const manifestPath = path.join(contributionRoot, 'CONTRIBUTION_MANIFEST.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert.equal(manifest.contributionId, 'chatnivo-personal-exporter-v1');
  assert.equal(manifest.sourceArchive?.sha256, 'ac34de7143596773749f8e6df8e40e82fdd80fde5fd31b75284b31f7871b6644');
  for (const file of manifest.files || []) {
    const bytes = await fs.readFile(path.join(contributionRoot, 'original', file.path));
    assert.equal(bytes.length, file.size, `${file.path} byte count changed`);
    assert.equal(sha256(bytes), file.sha256, `${file.path} original checksum changed`);
  }
});

test('ChatNivo is registered as an owner-private plugin with no aliases', () => {
  assert.equal(chatnivoPlugin.name, 'chatnivo');
  assert.deepEqual(chatnivoPlugin.aliases, []);
  assert.equal(chatnivoPlugin.ownerOnly, true);
  assert.equal(chatnivoPlugin.privateOnly, true);
  assert.equal(typeof chatnivoPlugin.execute, 'function');
});

test('ChatNivo fallback is not eligible without account credentials', () => {
  const email = process.env.CHATNIVO_EMAIL;
  const password = process.env.CHATNIVO_PASSWORD;
  try {
    delete process.env.CHATNIVO_EMAIL;
    delete process.env.CHATNIVO_PASSWORD;
    const status = getChatNivoInferenceStatus();
    assert.equal(status.credentialsConfigured, false);
    assert.equal(status.ready, false);
    assert.deepEqual(status.missingCredentials.sort(), ['CHATNIVO_EMAIL', 'CHATNIVO_PASSWORD']);
  } finally {
    if (email === undefined) delete process.env.CHATNIVO_EMAIL;
    else process.env.CHATNIVO_EMAIL = email;
    if (password === undefined) delete process.env.CHATNIVO_PASSWORD;
    else process.env.CHATNIVO_PASSWORD = password;
  }
});
