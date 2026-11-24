import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('tenant command access saves allowlist/denylist and protects billing controls', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-command-policy-'));
  process.chdir(temp);
  try {
    const { initializeDatabase } = await import(pathToFileURL(path.resolve(original, 'src/core/database.js')));
    const { putRecord } = await import(pathToFileURL(path.resolve(original, 'src/core/repository.js')));
    const { updateTenantCommandPolicy, isTenantCommandAllowed } = await import(pathToFileURL(path.resolve(original, 'src/rental/command-access.js')));
    await initializeDatabase();
    const groupJid = '120363123456789@g.us';
    await putRecord('rental.tenant', groupJid, {
      groupJid, status: 'active', manuallySuspended: false, planId: 'standard', planName: 'Standard',
      maxMembers: 200, dailyQuota: 350, expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      graceUntil: new Date(Date.now() + 172_800_000).toISOString(), billingContact: '628123456789@s.whatsapp.net'
    });
    const policy = await updateTenantCommandPolicy(groupJid, { mode: 'denylist', commands: ['sticker', 'download'] }, '628123456789@s.whatsapp.net');
    assert.equal(policy.mode, 'denylist');
    assert.equal((await isTenantCommandAllowed(groupJid, 'sticker')).allowed, false);
    assert.equal((await isTenantCommandAllowed(groupJid, 'profile')).allowed, true);
    assert.equal((await isTenantCommandAllowed(groupJid, 'sewa')).allowed, true);
    await updateTenantCommandPolicy(groupJid, { mode: 'allowlist', commands: ['ai'] }, '628123456789@s.whatsapp.net');
    assert.equal((await isTenantCommandAllowed(groupJid, 'ai')).allowed, true);
    assert.equal((await isTenantCommandAllowed(groupJid, 'sticker')).allowed, false);
    await assert.rejects(updateTenantCommandPolicy(groupJid, { mode: 'denylist', commands: ['sewa'] }), /tidak boleh/);
  } finally {
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
