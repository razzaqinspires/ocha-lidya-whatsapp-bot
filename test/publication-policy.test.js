import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditPublicationPaths,
  hasPrivateSourceFingerprint,
  isPrivateSourceDigest,
  PRIVATE_SOURCE_SHA256,
  isPrivatePublicationPath,
  scanSecrets,
} from '../src/core/publication-policy.js';
import { createHash } from 'node:crypto';

test('private runtime source and operator material are excluded from public publication', () => {
  for (const file of [
    'src/plugins/owner/message-lab.js',
    'private-runtime/src/lib/helpers.js',
    'private-runtime/package.json',
    'ADDITIONAL_INSTRUCTIONS.txt',
    'OCHA-LIDYA-PRIVATE-CORE-KEY.txt',
    '.private/prompt.md',
    'secrets/token.json',
  ])
    assert.equal(isPrivatePublicationPath(file), true, file);
});

test('public adapters and public runtime bridge remain eligible for publication', () => {
  for (const file of [
    'src/index.js',
    'src/core/auto-git-sync.js',
    'README.md',
    '.env.example',
    'docs/README.md',
    'src/private-runtime/loader.js',
    'src/private-runtime/public-serializer.js',
    'src/lib/helpers.js',
    'src/lib/freply.js',
    'src/lib/serializ_simple.js',
  ])
    assert.equal(isPrivatePublicationPath(file), false, file);
});

test('publication path audit separates private and eligible files', () => {
  const result = auditPublicationPaths(['README.md', 'private-runtime/src/lib/helpers.js', 'docs/README.md']);
  assert.deepEqual(result.privatePaths, ['private-runtime/src/lib/helpers.js']);
  assert.deepEqual(result.eligiblePaths, ['README.md', 'docs/README.md']);
});

test('secret scanner detects common credential formats without returning secret values', () => {
  const tokenPrefix = 'github_' + 'pat_';
  const keyPrefix = 'AI' + 'za';
  const findings = scanSecrets(
    `const token = "${tokenPrefix}abcdefghijklmnopqrstuvwxyz123456";\nconst key = "${keyPrefix}123456789012345678901234567890123";`,
  );
  assert.equal(findings.length, 2);
  assert.deepEqual(
    findings.map(x => x.rule),
    ['github-pat', 'google-api-key'],
  );
  assert.equal(JSON.stringify(findings).includes('abcdefghijklmnopqrstuvwxyz'), false);
});

test('secret scanner ignores documented placeholders', () => {
  assert.deepEqual(scanSecrets('const apiKey = "YOUR_API_KEY_HERE";'), []);
});

test('private source byte fingerprints are detectable without retaining source code', () => {
  const known = Buffer.from('owner-designated-private-source-fixture');
  const unknownHash = createHash('sha256').update(known).digest('hex');
  // Public scanner must identify registered source fingerprints without embedding source bytes.
  assert.equal(hasPrivateSourceFingerprint(known), false);
  assert.equal(isPrivateSourceDigest(PRIVATE_SOURCE_SHA256[0]), true);
  assert.equal(isPrivateSourceDigest(unknownHash), false);
});
