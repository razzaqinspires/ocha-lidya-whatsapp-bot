import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileSvg } from '../src/ai/profile-card.js';

test('profile canvas renders the redesigned dimensions and core profile metrics', () => {
  const svg = buildProfileSvg({
    displayName: 'Arifi', role: 'Owner & Creator', rank: 'Gold', level: 20,
    xp: 12345, xpRemaining: 210, progressPercent: 62.5,
    totalInteractions: 250, activeDays: 60, currentStreak: 8, longestStreak: 21,
    familiarityLevel: 7, trustScore: 99, greetingCount: 35,
    interactionStyle: 'natural', achievements: ['Early Supporter', 'Consistent User'],
    relationshipProgress: { nextRole: 'Mitra Tepercaya', progressPercent: 88 }
  }, { productName: 'Ocha Lidya AI', organization: 'Razzaq Ventures', creatorName: 'Arifi Razzaq' });
  assert.match(svg, /width="1080" height="1520" viewBox="0 0 1080 1520"/);
  assert.match(svg, /ACTIVITY OVERVIEW/);
  assert.match(svg, /EXPERIENCE \/ XP/);
  assert.match(svg, /RELATIONSHIP &amp; PERSONALIZATION|RELATIONSHIP & PERSONALIZATION/);
  assert.match(svg, /ACHIEVEMENTS/);
  assert.match(svg, /Arifi/);
  assert.match(svg, /12\.345 XP/);
});

test('profile canvas escapes user-controlled labels and clamps progress values', () => {
  const svg = buildProfileSvg({
    displayName: '<script>alert(1)</script>', progressPercent: 150,
    trustScore: -10, familiarityLevel: 99, achievements: ['<image href=x onerror=alert(1)>']
  });
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.ok(svg.includes('width="872"'));
  assert.ok(svg.includes('width="0"'));
});
