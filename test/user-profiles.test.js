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
const card = await import(pathToFileURL(path.resolve(original, 'src/ai/profile-card.js')).href);

test('XP, levels, ranks, and relationship roles progress independently', async () => {
  let profile = await profiles.recordUserInteraction({ userId: 'user-a@s.whatsapp.net', displayName: 'Ayu', messageId: 'm1', text: 'Halo', now: new Date('2026-11-20T04:00:00Z') });
  assert.equal(profile.xp, 15, 'first daily interaction earns base XP plus daily bonus');
  assert.equal(profile.level, 1);
  assert.equal(profile.role, 'Pengunjung');
  const duplicate = await profiles.recordUserInteraction({ userId: 'user-a@s.whatsapp.net', displayName: 'Ayu', messageId: 'm1', text: 'Halo', now: new Date('2026-11-20T04:00:00Z') });
  assert.equal(duplicate.xp, 15, 'same WhatsApp message ID cannot award XP twice');
  for (let i = 2; i <= 6; i++) {
    profile = await profiles.recordUserInteraction({ userId: 'user-a@s.whatsapp.net', displayName: 'Ayu', messageId: `m${i}`, text: 'Bantu jelaskan ini secara singkat', now: new Date('2026-11-20T04:00:00Z') });
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

test('daily XP cap prevents farming while interaction count remains accurate', async () => {
  let profile;
  for (let i = 0; i < 30; i++) {
    profile = await profiles.recordUserInteraction({ userId: 'user-cap@s.whatsapp.net', displayName: 'Cap', messageId: `cap-${i}`, text: 'Pertanyaan rutin', now: new Date('2026-11-20T04:00:00Z') });
  }
  assert.equal(profile.dailyXpEarned, 100);
  assert.equal(profile.xp, 100);
  assert.equal(profile.totalInteractions, 30);
  assert.equal(profile.level, 2);
});


test('daily streak increments on consecutive Jakarta dates and resets after a gap', async () => {
  let profile = await profiles.recordUserInteraction({
    userId: 'streak-user@s.whatsapp.net', displayName: 'Streak User', messageId: 'streak-1', text: 'Halo',
    now: new Date('2026-11-20T04:00:00Z')
  });
  assert.equal(profile.currentStreak, 1);
  profile = await profiles.recordUserInteraction({
    userId: 'streak-user@s.whatsapp.net', displayName: 'Streak User', messageId: 'streak-2', text: 'Halo lagi',
    now: new Date('2026-11-21T04:00:00Z')
  });
  assert.equal(profile.currentStreak, 2);
  assert.equal(profile.longestStreak, 2);
  profile = await profiles.recordUserInteraction({
    userId: 'streak-user@s.whatsapp.net', displayName: 'Streak User', messageId: 'streak-3', text: 'Masih hari ini',
    now: new Date('2026-11-21T07:00:00Z')
  });
  assert.equal(profile.currentStreak, 2, 'more than one interaction on the same day does not increase streak');
  profile = await profiles.recordUserInteraction({
    userId: 'streak-user@s.whatsapp.net', displayName: 'Streak User', messageId: 'streak-4', text: 'Kembali setelah jeda',
    now: new Date('2026-11-23T04:00:00Z')
  });
  assert.equal(profile.currentStreak, 1);
  assert.equal(profile.longestStreak, 2);
  assert.ok(profile.achievements.includes('FIRST CONTACT'));
  assert.equal(profile.dailyXpCap, 100);
});

test('profile card SVG escapes user-controlled names and contains progress data', () => {
  const svg = card.buildProfileSvg({ displayName: '<script>alert(1)</script>', role: 'Kenalan', rank: 'Iron', level: 1, xp: 15, progressPercent: 15, xpRemaining: 85, totalInteractions: 1, activeDays: 1 }, { productName: 'Ocha Lidya', organization: 'Razzaq Ventures' });
  assert.equal(svg.includes('<script>'), false);
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /15 XP/);
  assert.match(svg, /CURRENT STREAK/);
  assert.match(svg, /BEST STREAK/);
});

test.after(async () => { process.chdir(original); await fs.rm(temp, { recursive: true, force: true }); });
