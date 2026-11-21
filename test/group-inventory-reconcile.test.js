import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('participating group inventory refresh discovers offline joins and removes groups no longer joined', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-group-reconcile-'));
  process.chdir(temp);
  try {
    const source = name => pathToFileURL(path.resolve(original, `src/${name}`)).href;
    const config = await import(source('config.js'));
    await config.loadConfig();
    const metadata = await import(source('core/group-metadata.js'));
    await metadata.initializeGroupMetadata();
    const controls = await import(source('core/group-control.js'));
    const runtime = await import(source('core/group-runtime.js'));
    const first = '120363111111111111@g.us';
    const second = '120363222222222222@g.us';
    let snapshot = { [first]: { id: first, subject: 'Old Group', participants: [] } };
    const sock = { user: { id: '6282177461231@s.whatsapp.net' }, groupFetchAllParticipating: async () => snapshot };

    await runtime.hydrateParticipatingGroupsOnce(sock, { force: true });
    await controls.setGroupInteractionMuted(first, false, { actor: 'test-owner' });
    assert.ok(metadata.getGroupMetadata(first));

    snapshot = { [second]: { id: second, subject: 'New Offline Group', participants: [] } };
    await runtime.hydrateParticipatingGroupsOnce(sock, { force: true });
    assert.equal(metadata.getGroupMetadata(first), null, 'stale group absent from current WhatsApp membership is removed');
    assert.equal(metadata.getGroupMetadata(second).subject, 'New Offline Group', 'group joined while bot was offline is discovered');
    assert.equal(config.getConfig().features.groupMuteOverrides[first], undefined, 'stale per-group mute override is cleared');
    assert.equal(controls.getGroupInteractionState(second).muted, true, 'newly discovered groups remain muted by global default');
  } finally {
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
