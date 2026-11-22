import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

test('group admin settings persist rules and welcome message and handle member joins', async () => {
  const toolsUrl = pathToFileURL(path.resolve('src/core/group-tools.js')).href;
  const metadataUrl = pathToFileURL(path.resolve('src/core/group-metadata.js')).href;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `ocha-group-tools-${process.pid}-`));
  const script = `
    import assert from 'node:assert/strict';
    const tools = await import(${JSON.stringify(toolsUrl)});
    const metadata = await import(${JSON.stringify(metadataUrl)});
    const group = '120363998877665544@g.us';
    const member = '6281234567890@s.whatsapp.net';
    await metadata.upsertGroupMetadata({ id: group, subject: 'Group Tools Test', participants: [{ id: member }] });
    await tools.updateGroupRules(group, '1. Saling menghormati.\\n2. Dilarang spam.', 'admin');
    await tools.updateGroupWelcome(group, true, 'Silakan baca aturan sebelum mengirim pesan.', 'admin');
    const settings = await tools.getGroupTools(group);
    assert.match(settings.rules, /Dilarang spam/);
    assert.equal(settings.welcome.enabled, true);
    const sent = [];
    const result = await tools.handleGroupWelcome({ sendMessage: async (jid, payload) => sent.push({ jid, payload }) }, group, [member], 'add');
    assert.equal(result.sent, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].jid, group);
    assert.match(sent[0].payload.text, /Silakan baca aturan/);
    assert.deepEqual(sent[0].payload.mentions, [member]);
    await assert.rejects(() => tools.updateGroupRules(group, 'x'.repeat(1501), 'admin'), /1.500 karakter/);
    await assert.rejects(() => tools.updateGroupWelcome(group, true, 'x'.repeat(501), 'admin'), /500 karakter/);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: temp, encoding: 'utf8', timeout: 30_000 });
  await fs.rm(temp, { recursive: true, force: true });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
