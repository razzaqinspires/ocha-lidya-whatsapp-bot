import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldIncludeOchaFile } from '../scripts/release-policy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Ocha repository root keeps only README as a Markdown document', async () => {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const rootMarkdown = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map(entry => entry.name)
    .sort();
  assert.deepEqual(rootMarkdown, ['README.md']);
});

test('root JSON files are limited to package and formatter metadata', async () => {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const rootJson = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map(entry => entry.name)
    .sort();
  assert.deepEqual(rootJson, ['.prettierrc.json', 'package.json']);
});

test('project structure and changelog are under documentation domains', async () => {
  for (const relative of [
    'docs/architecture/PROJECT_STRUCTURE.md',
    'docs/releases/CHANGELOG.md',
    'docs/CHANGE_LOG.md',
  ]) {
    await assert.doesNotReject(fs.access(path.join(root, relative)), `${relative} must exist`);
  }
});

test('operator bundle manifest is generated under .release, not at archive root', async () => {
  const source = await fs.readFile(path.join(root, 'scripts/release-two-bases.js'), 'utf8');
  assert.match(source, /path\.join\(localReleaseDir, 'OPERATOR_BUNDLE\.json'\)/);
  assert.match(source, /name: '\.release\/OPERATOR_BUNDLE\.json'/);
  assert.doesNotMatch(source, /name: 'OPERATOR_BUNDLE\.json'/);
});

test('.release is Git-ignored and root README points to moved documentation', async () => {
  const [gitignore, readme] = await Promise.all([
    fs.readFile(path.join(root, '.gitignore'), 'utf8'),
    fs.readFile(path.join(root, 'README.md'), 'utf8'),
  ]);
  assert.match(gitignore, /^\.release\/$/m);
  assert.match(readme, /docs\/architecture\/PROJECT_STRUCTURE\.md/);
  assert.match(readme, /docs\/releases\/CHANGELOG\.md/);
});

test('release inventory includes docs/releases but excludes local .release metadata from the source walk', () => {
  assert.equal(shouldIncludeOchaFile('docs/releases/CHANGELOG.md'), true);
  assert.equal(shouldIncludeOchaFile('docs/architecture/PROJECT_STRUCTURE.md'), true);
  assert.equal(shouldIncludeOchaFile('.release/OPERATOR_BUNDLE.json'), false);
  assert.equal(shouldIncludeOchaFile('release-staging/operator.json'), false);
  assert.equal(shouldIncludeOchaFile('sessions/auth.json'), false);
});
