import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

test('all members can read active group rules, but only a verified admin can change them', async () => {
  const pluginUrl = pathToFileURL(path.resolve('src/plugins/general/groupadmin.js')).href;
  const metadataUrl = pathToFileURL(path.resolve('src/core/group-metadata.js')).href;
  const repositoryUrl = pathToFileURL(path.resolve('src/core/repository.js')).href;
  const toolsUrl = pathToFileURL(path.resolve('src/core/group-tools.js')).href;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `ocha-gadmin-auth-${process.pid}-`));
  const script = `
    import assert from 'node:assert/strict';
    const plugin = (await import(${JSON.stringify(pluginUrl)})).default;
    const metadata = await import(${JSON.stringify(metadataUrl)});
    const repository = await import(${JSON.stringify(repositoryUrl)});
    const tools = await import(${JSON.stringify(toolsUrl)});
    const group = '120363998877665544@g.us';
    const admin = '6281234567001@s.whatsapp.net';
    const member = '6281234567002@s.whatsapp.net';
    await metadata.upsertGroupMetadata({ id: group, subject: 'Access Test', participants: [{ id: admin, admin: 'admin' }, { id: member, admin: null }] });
    await repository.putRecord('rental.tenant', group, { groupJid: group, groupName: 'Access Test', status: 'active', manuallySuspended: false, planId: 'mini', planName: 'Mini', dailyQuota: 120, maxMembers: 50, expiresAt: new Date(Date.now() + 86400000).toISOString(), graceUntil: new Date(Date.now() + 3 * 86400000).toISOString() });
    await tools.updateGroupRules(group, 'Hormati semua anggota.', admin);
    const responses = [];
    const sock = { sendMessage: async () => {} };
    const message = sender => ({ isGroup: true, chat: group, sender, senderPn: sender, reply: async text => responses.push(text) });
    await plugin.execute({ sock, m: message(member), args: ['aturan'] });
    assert.match(responses.at(-1), /Hormati semua anggota/);
    await assert.rejects(() => plugin.execute({ sock, m: message(member), args: ['aturan', 'aturan baru'] }), /khusus admin grup/);
    await plugin.execute({ sock, m: message(admin), args: ['aturan', 'Aturan baru berlaku.'] });
    assert.equal((await tools.getGroupTools(group)).rules, 'Aturan baru berlaku.');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: temp, encoding: 'utf8', timeout: 30_000 });
  await fs.rm(temp, { recursive: true, force: true });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
