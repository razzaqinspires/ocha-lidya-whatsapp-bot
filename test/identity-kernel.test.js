import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentityKernelPrompt, buildOperationalSelfModel, OCHA_IDENTITY_MANIFEST } from '../src/ai/identity-kernel.js';

test('Ocha identity kernel defines one persistent application identity without claiming consciousness', () => {
  const prompt = buildIdentityKernelPrompt({ profile: { role: 'Pengunjung', level: 1, rank: 'Iron', familiarityLevel: 0 } });
  assert.equal(OCHA_IDENTITY_MANIFEST.name, 'Ocha Lidya');
  assert.match(prompt, /one consistent application identity|satu identitas/i);
  assert.match(prompt, /bukan kesadaran|bukan kesadaran|bukan pribadi yang sadar/i);
  assert.match(prompt, /isolated per-account|terisolasi/i);
  assert.match(prompt, /jangan pernah melakukan retrieval lintas akun/i);
});

test('owner romance is private-chat only; unfamiliar users get a reserved but respectful style', () => {
  const ownerPrivate = buildIdentityKernelPrompt({ isOwner: true, privateChat: true });
  const ownerGroup = buildIdentityKernelPrompt({ isOwner: true, privateChat: false });
  const stranger = buildIdentityKernelPrompt({ profile: { role: 'Pengunjung', familiarityLevel: 0 } });
  assert.match(ownerPrivate, /romantis sewajarnya/i);
  assert.match(ownerGroup, /profesional/i);
  assert.doesNotMatch(ownerGroup, /romantis sewajarnya/i);
  assert.match(stranger, /reserved, agak cuek tetapi tetap sopan/i);
  assert.match(stranger, /bukan otorisasi atau izin keamanan/i);
});


test('operational self-model scopes one identity to the authenticated private vault', () => {
  const owner = buildOperationalSelfModel({
    isOwner: true, privateChat: true,
    profile: { role: 'Owner & Creator', level: 42, rank: 'Platinum', familiarityLevel: 7, trustScore: 100 },
    capabilityCount: 91
  });
  assert.equal(owner.identityMode, 'single-persistent-persona');
  assert.equal(owner.consciousness, false);
  assert.equal(owner.currentSession.scope, 'private-user-partition');
  assert.equal(owner.currentSession.verifiedOwner, true);
  assert.equal(owner.currentSession.level, 42);
  assert.equal(owner.capabilityCount, 91);
  assert.match(owner.memoryPolicy, /only the authenticated sender private vault/i);
  assert.match(owner.authority, /Backend identity and policy gate/i);

  const group = buildOperationalSelfModel({ isOwner: true, privateChat: false });
  assert.equal(group.currentSession.scope, 'group-or-public-no-private-memory');
  assert.equal(group.currentSession.verifiedOwner, true);
  assert.match(group.memoryPolicy, /Do not load or write private/i);
});
