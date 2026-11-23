import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const original = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-legacy-history-test-'));
process.chdir(temp);
process.env.OCHA_ROO_ROOT = path.join(temp, 'data', 'roo');
process.env.OCHA_ROO_MASTER_KEY = 'b'.repeat(64);
const vault = await import(pathToFileURL(path.join(original, 'src', 'ai', 'user-vault.js')).href);
const migration = await import(pathToFileURL(path.join(original, 'src', 'ai', 'legacy-history-migration.js')).href);
const userA = '6281234567890@s.whatsapp.net';
const userB = '6289876543210@s.whatsapp.net';

const rows = [
  { seq: 1, ts: '2024-01-01T10:00:00.000Z', payload: { chat: userA, sender: userA, role: 'user', content: 'Riwayat privat milik A.' } },
  { seq: 2, ts: '2024-01-01T10:00:05.000Z', payload: { chat: userA, sender: userA, role: 'assistant', content: 'Jawaban privat untuk A.' } },
  { seq: 3, ts: '2024-01-01T10:00:10.000Z', payload: { chat: '120363000000000000@g.us', sender: userA, role: 'user', content: 'Ini pesan grup dan tidak boleh masuk ke vault privat.' } },
  { seq: 4, ts: '2024-01-02T10:00:00.000Z', payload: { chat: userB, sender: userB, role: 'user', content: 'Riwayat privat milik B.' } },
  { seq: 5, ts: '2024-01-03T10:00:00.000Z', payload: { chat: userB, sender: userA, role: 'user', content: 'Identitas tidak cocok dan harus diabaikan.' } }
];

test('legacy private DM history migrates to separate encrypted user vaults and excludes groups', async () => {
  const result = await migration.migrateLegacyPrivateAIHistory(rows);
  assert.deepEqual(result, { users: 2, turns: 3, examinedUsers: 2 });
  const a = await vault.getRecentUserConversationTurns(userA, { limit: 10 });
  const b = await vault.getRecentUserConversationTurns(userB, { limit: 10 });
  assert.equal(a.length, 2);
  assert.equal(b.length, 1);
  assert.match(a[0].content, /Riwayat privat milik A/);
  assert.equal(a.some(turn => turn.content.includes('pesan grup')), false);
  assert.match(a[0].createdAt, /^2024-01-01/);
  assert.equal(b.some(turn => turn.content.includes('milik A')), false);
  const identity = await vault.loadUserVaultSnapshot(userA, 'identity');
  assert.equal(identity.legacyPrivateHistoryMigration.complete, true);
});

test('migration is idempotent and never duplicates an already imported source sequence', async () => {
  const result = await migration.migrateLegacyPrivateAIHistory(rows);
  assert.deepEqual(result, { users: 0, turns: 0, examinedUsers: 2 });
  const a = await vault.getRecentUserConversationTurns(userA, { limit: 10 });
  assert.equal(a.length, 2);
});

test.after(async () => { process.chdir(original); await fs.rm(temp, { recursive: true, force: true }); });
