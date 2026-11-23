import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const original = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-user-profile-test-'));
process.chdir(temp);
const config = await import(pathToFileURL(path.resolve(original, 'src/config.js')).href);
await config.loadConfig();
const profiles = await import(pathToFileURL(path.resolve(original, 'src/ai/user-profiles.js')).href);
const vault = await import(pathToFileURL(path.resolve(original, 'src/ai/user-vault.js')).href);
const card = await import(pathToFileURL(path.resolve(original, 'src/ai/profile-card.js')).href);

test('XP, levels, ranks, and relationship roles progress independently', async () => {
  let profile = await profiles.recordUserInteraction({ userId: '6281111111111@s.whatsapp.net', displayName: 'Ayu', messageId: 'm1', text: 'Halo', now: new Date('2026-11-20T04:00:00Z') });
  assert.equal(profile.xp, 12, 'first valid daily interaction earns base XP plus daily bonus');
  assert.equal(profile.level, 1);
  assert.equal(profile.role, 'Pengunjung');
  const duplicate = await profiles.recordUserInteraction({ userId: '6281111111111@s.whatsapp.net', displayName: 'Ayu', messageId: 'm1', text: 'Halo', now: new Date('2026-11-20T04:00:00Z') });
  assert.equal(duplicate.xp, 12, 'same WhatsApp message ID cannot award XP twice');
  for (let i = 2; i <= 6; i++) {
    const day = i < 4 ? '2026-11-20' : '2026-11-21';
    profile = await profiles.recordUserInteraction({ userId: '6281111111111@s.whatsapp.net', displayName: 'Ayu', messageId: `m${i}`, text: `Bantu jelaskan kebutuhan secara singkat nomor ${i}`, now: new Date(`${day}T${String(4 + i).padStart(2, '0')}:00:00Z`) });
  }
  assert.equal(profile.role, 'Kenalan');
  assert.equal(profile.totalInteractions, 6);
  assert.equal(profiles.levelFromXp(100), 2);
  assert.equal(profiles.rankForLevel(10), 'Silver');
  assert.equal(profiles.rankForLevel(50), 'Diamond');
});

test('owner profile resolves from trusted configuration, not WhatsApp push name', async () => {
  const profile = await profiles.recordUserInteraction({ userId: '6283193905842@s.whatsapp.net', displayName: 'Sky', messageId: 'owner-1', text: 'Halo', isOwner: true, now: new Date('2026-11-20T04:00:00Z') });
  assert.equal(profile.displayName, 'Arifi Razzaq');
  assert.equal(profile.role, 'Owner & Creator');
});

test('XP has no daily ceiling; a cooldown prevents farming while interaction count remains accurate', async () => {
  let profile;
  for (let i = 0; i < 30; i++) {
    profile = await profiles.recordUserInteraction({ userId: '6282222222222@s.whatsapp.net', displayName: 'Cap', messageId: `cap-${i}`, text: `Pertanyaan unik berisi konteks yang berbeda nomor ${i} dengan tujuan jelas`, now: new Date(Date.parse('2026-11-20T04:00:00Z') + i * 61_000) });
  }
  assert.equal(profile.dailyXpEarned, 190);
  assert.equal(profile.xp, 190);
  assert.equal(profile.totalInteractions, 30);
  assert.equal(profile.level, 2);
});


test('daily streak increments on consecutive Jakarta dates and resets after a gap', async () => {
  let profile = await profiles.recordUserInteraction({
    userId: '6283333333333@s.whatsapp.net', displayName: 'Streak User', messageId: 'streak-1', text: 'Halo',
    now: new Date('2026-11-20T04:00:00Z')
  });
  assert.equal(profile.currentStreak, 1);
  profile = await profiles.recordUserInteraction({
    userId: '6283333333333@s.whatsapp.net', displayName: 'Streak User', messageId: 'streak-2', text: 'Halo lagi',
    now: new Date('2026-11-21T04:00:00Z')
  });
  assert.equal(profile.currentStreak, 2);
  assert.equal(profile.longestStreak, 2);
  profile = await profiles.recordUserInteraction({
    userId: '6283333333333@s.whatsapp.net', displayName: 'Streak User', messageId: 'streak-3', text: 'Masih hari ini',
    now: new Date('2026-11-21T07:00:00Z')
  });
  assert.equal(profile.currentStreak, 2, 'more than one interaction on the same day does not increase streak');
  profile = await profiles.recordUserInteraction({
    userId: '6283333333333@s.whatsapp.net', displayName: 'Streak User', messageId: 'streak-4', text: 'Kembali setelah jeda',
    now: new Date('2026-11-23T04:00:00Z')
  });
  assert.equal(profile.currentStreak, 1);
  assert.equal(profile.longestStreak, 2);
  assert.ok(profile.achievements.includes('FIRST CONTACT'));
  assert.equal(profile.xpSystem, 'arbitrary-precision-progression-no-level-or-daily-xp-cap-unique-meaningful-content-only');
});

test('BigInt XP continues beyond Number.MAX_SAFE_INTEGER without a level ceiling', async () => {
  const initial = 900719925474099312345n;
  await vault.saveUserVaultSnapshot('6284444444444@s.whatsapp.net', 'profile', {
    userId: '6284444444444@s.whatsapp.net', displayName: 'Big XP', xp: initial.toString(), xpExact: initial.toString(),
    totalInteractions: 10, meaningfulInteractions: 4, activeDays: 3, createdAt: '2026-01-01T00:00:00.000Z',
    lastActiveDate: '2026-11-22', lastXpAt: null, styleCounts: {}, currentStreak: 2, longestStreak: 2,
    recentMessageIds: [], dailyXpEarned: 0
  });
  const profile = await profiles.recordUserInteraction({
    userId: '6284444444444@s.whatsapp.net', messageId: 'bigxp-1', text: 'Bantu analisis arsitektur memori untuk proyek ini',
    now: new Date('2026-11-23T04:00:00Z')
  });
  assert.equal(profile.xpExact, (initial + 19n).toString());
  assert.equal(typeof profile.xp, 'string');
  assert.ok(Number(profile.level) > 1_000_000_000);
  assert.match(profile.rank, /^Singularity(?: \d+)?$/);
  assert.ok(BigInt(profiles.xpRequiredForLevel(profile.level)) <= BigInt(profile.xpExact));
});

test('profile card SVG escapes user-controlled names and contains progress data', () => {
  const svg = card.buildProfileSvg({ displayName: '<script>alert(1)</script>', role: 'Kenalan', rank: 'Iron', level: 1, xp: 15, progressPercent: 15, xpRemaining: 85, totalInteractions: 1, activeDays: 1 }, { productName: 'Ocha Lidya', organization: 'Razzaq Ventures' });
  assert.equal(svg.includes('<script>'), false);
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /15 XP/);
  assert.match(svg, /CURRENT STREAK/);
  assert.match(svg, /BEST STREAK/);
});

test('durable XP identity ledgers do not truncate after 500 or 1000 records', async () => {
  const userId = '6288888888888@s.whatsapp.net';
  const seededIds = Array.from({ length: 600 }, (_, index) => `ledger-id-${index}`);
  const seededHashes = Array.from({ length: 1200 }, (_, index) => index.toString(16).padStart(64, '0'));
  await vault.saveUserVaultSnapshot(userId, 'profile', {
    userId, displayName: 'Long Ledger', xp: '0', xpExact: '0', totalInteractions: 0, meaningfulInteractions: 0,
    activeDays: 0, createdAt: '2026-01-01T00:00:00.000Z', lastActiveDate: null, lastXpAt: null,
    styleCounts: {}, currentStreak: 0, longestStreak: 0, recentMessageIds: seededIds, recentContentHashes: seededHashes
  });
  const profile = await profiles.recordUserInteraction({
    userId, displayName: 'Long Ledger', messageId: 'ledger-new-id',
    text: 'Tambahkan satu entri ledger baru untuk memverifikasi riwayat profil yang persisten',
    now: new Date('2026-11-23T04:00:00Z')
  });
  const persisted = await vault.loadUserVaultSnapshot(userId, 'profile');
  assert.equal(profile.recentMessageIds.length, 601);
  assert.equal(profile.recentContentHashes.length, 1201);
  assert.equal(persisted.recentMessageIds.at(-1), 'ledger-new-id');
  assert.equal(persisted.recentContentHashes.length, 1201);
});

test.after(async () => { process.chdir(original); await fs.rm(temp, { recursive: true, force: true }); });

test('concurrent profile updates serialize XP and interaction counters without lost writes', async () => {
  const userId = '6286666666666@s.whatsapp.net';
  const base = Date.parse('2026-11-22T04:00:00.000Z');
  const results = await Promise.all(Array.from({ length: 24 }, (_, index) => profiles.recordUserInteraction({
    userId, displayName: 'Parallel', messageId: `parallel-${index}`, text: `Interaksi paralel nomor ${index} dengan empat kata tambahan`,
    now: new Date(base + index * 61_000)
  })));
  const final = await profiles.getUserProfile(userId);
  assert.equal(final.totalInteractions, 24);
  assert.equal(final.recentMessageIds.length, 24);
  assert.ok(results.every(result => result.totalInteractions >= 1));
  assert.equal(final.xpExact, '154');
});


test('repeated low-signal text cannot farm XP after the daily first-contact award', async () => {
  let profile;
  for (let i = 0; i < 12; i++) {
    profile = await profiles.recordUserInteraction({
      userId: '6287777777777@s.whatsapp.net', displayName: 'Low Signal',
      messageId: `low-${i}`, text: 'halo',
      now: new Date(Date.parse('2026-11-22T04:00:00Z') + i * 61_000)
    });
  }
  assert.equal(profile.totalInteractions, 12);
  assert.equal(profile.xpExact, '12', 'only the valid first contact of that day earns XP');
});

test('ranks extend beyond the previous Eternal tier without granting security permissions', () => {
  assert.equal(profiles.rankForLevel(1000), 'Eternal');
  assert.equal(profiles.rankForLevel(2500), 'Nova');
  assert.equal(profiles.rankForLevel(10000), 'Apex');
  assert.equal(profiles.rankForLevel(50000), 'Nexus');
  assert.equal(profiles.rankForLevel(100000), 'Singularity');
  assert.equal(profiles.rankForLevel(1_000_000), 'Singularity 2');
  assert.equal(profiles.rankForLevel(10_000_000), 'Singularity 3');
  assert.equal(profiles.rankForLevel(100_000_000_000), 'Singularity 7');
});
