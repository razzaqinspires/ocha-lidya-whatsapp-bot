import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  defaultAutoPushConfig,
  loadAutoPushConfig,
  normalizeAutoPushTarget,
  saveAutoPushConfig,
  setAutoPushTargetEnabled,
} from '../src/core/auto-push-config.js';

test('auto-push config has two independent enabled repository targets by default', () => {
  const config = defaultAutoPushConfig();
  assert.equal(config.targets.ocha.enabled, true);
  assert.equal(config.targets.ac.enabled, true);
  assert.notEqual(config.targets.ocha.repository, config.targets.ac.repository);
  assert.equal(config.targets.ocha.branch, 'main');
  assert.equal(config.targets.ac.branch, 'main');
});

test('auto-push config persists target toggles under the private operator directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-autopush-config-'));
  try {
    const initial = await loadAutoPushConfig({ root });
    initial.targets.ac.enabled = false;
    await saveAutoPushConfig(initial, { root });
    const changed = await setAutoPushTargetEnabled('ocha', false, { root });
    assert.equal(changed.targets.ocha.enabled, false);
    assert.equal(changed.targets.ac.enabled, false);
    const file = path.join(root, '.private', 'automation', 'auto-push.json');
    const stored = await fs.readFile(file, 'utf8');
    assert.deepEqual(JSON.parse(stored), changed);
    assert.equal(stored.includes('must-never-be-written'), false);
    if (process.platform !== 'win32') {
      const mode = (await fs.stat(file)).mode & 0o777;
      assert.equal(mode, 0o600);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('auto-push target aliases normalize without accepting arbitrary repository names', () => {
  assert.equal(normalizeAutoPushTarget('bot'), 'ocha');
  assert.equal(normalizeAutoPushTarget('nadi'), 'ac');
  assert.equal(normalizeAutoPushTarget('both'), 'all');
  assert.equal(normalizeAutoPushTarget('attacker/repo'), null);
});

test('corrupt auto-push configuration is quarantined and both publishing lanes fail closed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-autopush-corrupt-'));
  try {
    const directory = path.join(root, '.private', 'automation');
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, 'auto-push.json');
    await fs.writeFile(file, '{ invalid json');
    const recovered = await loadAutoPushConfig({ root });
    assert.equal(recovered.targets.ocha.enabled, false);
    assert.equal(recovered.targets.ac.enabled, false);
    const names = await fs.readdir(directory);
    assert.ok(names.some(name => /^auto-push\.json\.corrupt-/.test(name)));
    assert.ok(names.includes('auto-push.json'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
