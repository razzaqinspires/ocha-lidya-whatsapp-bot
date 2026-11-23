import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { parseFeatureBuildIntent, createFeatureRequest, listFeatureRequests, updateFeatureRequest, formatFeatureRequest } from '../src/ai/feature-requests.js';

const userA = '628123456789@s.whatsapp.net';
const userB = '628123456788@s.whatsapp.net';
const userC = '628123456787@s.whatsapp.net';
const userD = '628123456786@s.whatsapp.net';
const vaultRoot = path.join(os.tmpdir(), `ocha-feature-requests-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
process.env.OCHA_ROO_ROOT = vaultRoot;
after(async () => { delete process.env.OCHA_ROO_ROOT; await fs.rm(vaultRoot, { recursive: true, force: true }); });

test('feature build intent recognizes a short confirmation only after an unavailable-feature offer', () => {
  const turns = [
    { role: 'user', content: 'main tictactoe yuk' },
    { role: 'assistant', content: 'Mode Tic-Tac-Toe belum aktif. Aku bisa siapkan pengembangannya dengan state permainan sungguhan. Kalau ingin, bilang buat aja.' }
  ];
  const parsed = parseFeatureBuildIntent('buat aja', turns);
  assert.equal(parsed.feature.key, 'tic-tac-toe');
  assert.equal(parsed.source, 'confirmed-followup');
  assert.equal(parseFeatureBuildIntent('buat aja', [{ role: 'user', content: 'main tictactoe yuk' }]), null);
  assert.equal(parseFeatureBuildIntent('apa itu Tic-Tac-Toe?', turns), null);
  assert.equal(parseFeatureBuildIntent('jangan buat dulu', turns), null);
  assert.equal(parseFeatureBuildIntent('iya', turns).feature.key, 'tic-tac-toe');
  assert.equal(parseFeatureBuildIntent('buat game itu', turns).feature.key, 'tic-tac-toe');
  const legacyTurns = [
    { role: 'user', content: 'main tictactoe yuk' },
    { role: 'assistant', content: 'Karena tidak ada state permainan tersimpan, saya tidak akan membuat papan atau memilih langkah. Fitur game baru bisa dijalankan setelah plugin game dengan state server-side benar-benar dipasang.' }
  ];
  assert.equal(parseFeatureBuildIntent('buat aja', legacyTurns).feature.key, 'tic-tac-toe');
});

test('direct feature build intent is recognized without claiming installation', () => {
  const parsed = parseFeatureBuildIntent('Tolong buatkan fitur game Tic-Tac-Toe');
  assert.equal(parsed.feature.key, 'tic-tac-toe');
  assert.equal(parsed.source, 'explicit-build');
});

test('feature requests are encrypted and isolated to the verified owner vault', async t => {
  const parsed = parseFeatureBuildIntent('buat aja', [
    { role: 'user', content: 'main tictactoe yuk' },
    { role: 'assistant', content: 'Tic-Tac-Toe belum aktif. Aku bisa siapkan pengembangannya.' }
  ]);
  const created = await createFeatureRequest(userA, parsed.feature, { sourceText: 'buat aja' });
  assert.equal(created.created, true);
  assert.match(created.request.id, /^FR-\d{8}-[A-F0-9]{6}$/);
  assert.equal(created.request.status, 'requested');
  assert.match(formatFeatureRequest(created.request), /giliran/);
  const duplicate = await createFeatureRequest(userA, parsed.feature, { sourceText: 'buat aja lagi' });
  assert.equal(duplicate.duplicate, true);
  assert.equal((await listFeatureRequests(userA)).length, 1);
  assert.equal((await listFeatureRequests(userB)).length, 0);
});

test('feature request status transitions are append-only and owner-vault scoped', async t => {
  const created = await createFeatureRequest(userC, 'tic-tac-toe');
  const progress = await updateFeatureRequest(userC, created.request.id, 'in-progress', 'Mulai implementasi state engine');
  assert.equal(progress.updated, true);
  assert.equal((await listFeatureRequests(userC))[0].status, 'in-progress');
  assert.equal((await updateFeatureRequest(userD, created.request.id, 'completed')).reason, 'not-found');
  const completed = await updateFeatureRequest(userC, created.request.id, 'completed', 'Tes acceptance selesai');
  assert.equal(completed.status, 'completed');
  assert.equal((await listFeatureRequests(userC)).length, 0);
  assert.equal((await listFeatureRequests(userC, { includeClosed: true }))[0].status, 'completed');
});
