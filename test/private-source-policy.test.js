import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isPrivatePluginSourcePath, listPrivatePluginSourcePaths } from '../src/core/private-source-policy.js';
import { shouldIncludeOchaFile } from '../scripts/release-policy.js';

const root = process.cwd();

test('the private message-test plugin source is identified across path separators', () => {
  assert.deepEqual(listPrivatePluginSourcePaths(), ['src/plugins/owner/message-lab.js']);
  assert.equal(isPrivatePluginSourcePath('src/plugins/owner/message-lab.js'), true);
  assert.equal(isPrivatePluginSourcePath('src\\plugins\\owner\\message-lab.js'), true);
  assert.equal(isPrivatePluginSourcePath('./src/plugins/owner/message-lab.js'), true);
  assert.equal(isPrivatePluginSourcePath('src/plugins/general/message-lab.js'), false);
  assert.equal(isPrivatePluginSourcePath('src/plugins/owner/message-test-catalog.js'), false);
});

test('the private message-test source cannot enter an Ocha operator bundle', () => {
  assert.equal(shouldIncludeOchaFile('src/plugins/owner/message-lab.js'), false);
  assert.equal(shouldIncludeOchaFile('src/plugins/owner/message-test-catalog.js'), true);
  assert.equal(shouldIncludeOchaFile('src/core/private-source-policy.js'), true);
});

test('plugin loader and ACIE command discovery enforce the shared private-source policy', async () => {
  const [loader, generation] = await Promise.all([
    fs.readFile(path.join(root, 'src/core/plugin-loader.js'), 'utf8'),
    fs.readFile(path.join(root, 'src/acie/command-engine/command-generation.js'), 'utf8'),
  ]);
  assert.match(loader, /isPrivatePluginSourcePath\(path\.relative\(PROJECT_ROOT, full\)\)/);
  assert.match(generation, /isPrivatePluginSourcePath\(path\.relative\(root, full\)\)/);
});
