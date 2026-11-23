import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const original = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-user-vault-test-'));
process.chdir(temp);
process.env.OCHA_ROO_ROOT = path.join(temp, 'data', 'roo');
process.env.OCHA_ROO_MASTER_KEY = 'a'.repeat(64);
const vault = await import(pathToFileURL(path.resolve(original, 'src/ai/user-vault.js')).href);

const userA = '6281234567890@s.whatsapp.net';
const userB = '6289876543210@s.whatsapp.net';

test('private user archives are encrypted and isolated from other accounts', async () => {
  await vault.appendUserVaultEvent(userA, 'conversation.turn', { role: 'user', content: 'Rahasia milik akun alpha dan proyek pribadi.' });
  await vault.appendUserVaultEvent(userA, 'conversation.turn', { role: 'assistant', content: 'Catatan rahasia alpha disimpan di ruang privat.' });
  await vault.appendUserVaultEvent(userB, 'conversation.turn', { role: 'user', content: 'Ini hanya milik akun beta.' });

  const root = process.env.OCHA_ROO_ROOT;
  const entries = await fs.readdir(root);
  const userAFolder = crypto.createHash('sha256').update(userA).digest('hex');
  const userBFolder = crypto.createHash('sha256').update(userB).digest('hex');
  assert.equal(entries.includes(userA), false, 'folder name must not reveal a WhatsApp identifier');
  assert.equal(entries.includes(userB), false);
  assert.ok(entries.includes(userAFolder));
  assert.ok(entries.includes(userBFolder));
  const userAFiles = await fs.readdir(path.join(root, userAFolder, 'journal'));
  assert.ok(userAFiles.length >= 1);
  const raw = await fs.readFile(path.join(root, entries.find(name => name !== '.master-key'), 'journal', userAFiles[0]), 'utf8');
  assert.equal(raw.includes('Rahasia milik akun alpha'), false, 'journal payload must not be stored as plaintext');

  const a = await vault.getRecentUserConversationTurns(userA, { limit: 10 });
  const b = await vault.getRecentUserConversationTurns(userB, { limit: 10 });
  assert.equal(a.length, 2);
  assert.equal(b.length, 1);
  assert.equal(a.some(turn => turn.content.includes('beta')), false);
  assert.equal(b.some(turn => turn.content.includes('alpha')), false);
});

test('archive has no application event cap and recent retrieval returns newest turns in order', async () => {
  for (let i = 0; i < 120; i++) {
    await vault.appendUserVaultEvent(userA, 'conversation.turn', { role: i % 2 ? 'assistant' : 'user', content: `archive marker item ${i}` });
  }
  const recent = await vault.getRecentUserConversationTurns(userA, { limit: 7 });
  assert.equal(recent.length, 7);
  assert.match(recent[0].content, /item 113/);
  assert.match(recent.at(-1).content, /item 119/);
  const stats = await vault.getUserVaultStats(userA);
  assert.equal(stats.events, 122);
  assert.equal(stats.encrypted, true);
});

test('conversation search and export operate only on the selected user vault', async () => {
  const results = await vault.searchUserConversation(userA, 'archive marker item 24', { limit: 4 });
  assert.ok(results.some(item => item.content.includes('item 24')));
  const output = path.join(temp, 'alpha-export.jsonl');
  await vault.exportUserVaultTranscript(userA, output);
  const exported = await fs.readFile(output, 'utf8');
  assert.match(exported, /export.meta/);
  assert.match(exported, /Rahasia milik akun alpha/);
  assert.equal(exported.includes('Ini hanya milik akun beta'), false);
});


test('encrypted search index can be rebuilt from the authenticated archive', async () => {
  const root = process.env.OCHA_ROO_ROOT;
  const userAFolder = crypto.createHash('sha256').update(userA).digest('hex');
  const indexDir = path.join(root, userAFolder, 'index');
  for (const name of await fs.readdir(indexDir)) await fs.unlink(path.join(indexDir, name));
  const results = await vault.searchUserConversation(userA, 'archive marker item 24', { limit: 3 });
  assert.ok(results.some(item => item.content.includes('item 24')));
  assert.ok((await fs.readdir(indexDir)).some(name => name.endsWith('.vault')));
});

test('concurrent appends preserve a sequential hash-chained journal', async () => {
  const userC = '6281111222233@s.whatsapp.net';
  await Promise.all(Array.from({ length: 48 }, (_, index) =>
    vault.appendUserVaultEvent(userC, 'conversation.turn', { role: index % 2 ? 'assistant' : 'user', content: `concurrent write ${index}` })
  ));
  const events = await vault.readUserVaultEvents(userC, { types: 'conversation.turn', limit: 100 });
  assert.equal(events.length, 48);
  assert.deepEqual(events.map(event => event.seq), Array.from({ length: 48 }, (_, index) => index + 1));
  assert.equal(new Set(events.map(event => event.payload.content)).size, 48);
});

test('integrity check blocks altered encrypted journal rows', async () => {
  const root = process.env.OCHA_ROO_ROOT;
  const userDir = path.join(root, crypto.createHash('sha256').update(userA).digest('hex'), 'journal');
  const fileName = (await fs.readdir(userDir))[0];
  const file = path.join(userDir, fileName);
  const text = await fs.readFile(file, 'utf8');
  const row = JSON.parse(text.split('\n')[0]);
  row.data = `${row.data[0] === 'A' ? 'B' : 'A'}${row.data.slice(1)}`;
  await fs.writeFile(file, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  vault.clearUserVaultKeyCache();
  await assert.rejects(() => vault.readUserVaultEvents(userA), error => error.code === 'OCHA_VAULT_INTEGRITY_FAILED');
});

test('User Vault rejects group IDs and path-like identities', async () => {
  await assert.rejects(() => vault.appendUserVaultEvent('120363123456789@g.us', 'conversation.turn', {}), /hanya menerima identitas pengguna/);
  await assert.rejects(() => vault.appendUserVaultEvent('../../root', 'conversation.turn', {}), /Format identitas pengguna tidak valid/);
});

test.after(async () => {
  process.chdir(original);
  delete process.env.OCHA_ROO_ROOT;
  delete process.env.OCHA_ROO_MASTER_KEY;
  await fs.rm(temp, { recursive: true, force: true });
});
