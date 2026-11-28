import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldIncludeOchaFile } from '../scripts/release-policy.js';

test('operator ZIP selectively traverses the private parent but allows only reviewed private subtrees', () => {
  assert.equal(
    shouldIncludeOchaFile('.private'),
    true,
    'walker must traverse the parent to reach allow-listed private subtrees',
  );
  assert.equal(shouldIncludeOchaFile('.private/unreviewed-folder/secret.txt'), false);
});

test('operator ZIP includes AC source selectively but never nested Git metadata or runtime secrets', () => {
  for (const file of [
    '.private/artificial-consciousness-component/ac/kernel.py',
    '.private/artificial-consciousness-component/README.md',
    '.private/artificial-consciousness-component/OCHA_COMPONENT_RELEASE.json',
  ])
    assert.equal(shouldIncludeOchaFile(file), true, file);

  for (const file of [
    '.private/artificial-consciousness-component/.git/config',
    '.private/artificial-consciousness-component/.env',
    '.private/artificial-consciousness-component/.env.production',
    '.private/artificial-consciousness-component/ac_config.json',
    '.private/artificial-consciousness-component/data/eternal_chain.jsonl',
    '.private/artificial-consciousness-component/ac/__pycache__/kernel.pyc',
    '.private/artificial-consciousness-component/.ssh/id_ed25519',
    '.private/artificial-consciousness-component/.aws/credentials',
    '.private/artificial-consciousness-component/secrets/provider.json',
    '.private/artificial-consciousness-component/certificates/server.pem',
    '.private/artificial-consciousness-component/private-keys/signing.key',
    '.private/automation/auto-push.json',
  ])
    assert.equal(shouldIncludeOchaFile(file), false, file);
});

test('nested AC repository is never included in normal Ocha Git publication policy', async () => {
  const { isPrivatePublicationPath } = await import('../src/core/publication-policy.js');
  assert.equal(isPrivatePublicationPath('.private/artificial-consciousness-component/ac/kernel.py'), true);
  assert.equal(isPrivatePublicationPath('.private/artificial-consciousness-component/.git/config'), true);
});

test('Ocha Git publication guard identifies every indexed .private path', async () => {
  const { findPrivateTrackedPaths, findProtectedStagedPaths } = await import('../src/core/publication-policy.js');
  const privatePaths = [
    '.private/artificial-consciousness-component/ac/kernel.py',
    '.private/automation/auto-push.json',
    'src/index.js',
  ];
  assert.deepEqual(findPrivateTrackedPaths(privatePaths), [
    '.private/artificial-consciousness-component/ac/kernel.py',
    '.private/automation/auto-push.json',
  ]);
  assert.deepEqual(
    findProtectedStagedPaths(privatePaths, ['.private/artificial-consciousness-component/ac/kernel.py']),
    ['.private/automation/auto-push.json'],
  );
});
