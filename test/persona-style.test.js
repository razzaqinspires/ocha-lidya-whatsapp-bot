import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalGreeting } from '../src/ai/persona-style.js';

test('verified owner gets restrained affectionate greeting only in private chat', () => {
  const privateGreeting = buildLocalGreeting({ isOwner: true, privateChat: true, ownerName: 'Arifi', greetingCount: 1 });
  const groupGreeting = buildLocalGreeting({ isOwner: true, privateChat: false, ownerName: 'Arifi', greetingCount: 1 });
  assert.match(privateGreeting, /sayang|kesayanganku/i);
  assert.doesNotMatch(groupGreeting, /sayang|kesayanganku/i);
  assert.match(groupGreeting, /Arifi/);
});

test('new contacts receive concise reserved greetings without assumed intimacy', () => {
  const greeting = buildLocalGreeting({ displayName: 'Visitor', familiarityLevel: 0, greetingCount: 1 });
  assert.equal(greeting, 'Halo. Ada yang ingin ditanyakan?');
  assert.doesNotMatch(greeting, /sayang|kesayanganku|sahabat/i);
});

test('familiar users receive a more relaxed greeting while preserving account-specific display names', () => {
  const greeting = buildLocalGreeting({ displayName: 'Ayu', familiarityLevel: 2, greetingCount: 1 });
  assert.match(greeting, /Ayu/);
  assert.match(greeting, /Ocha siap/);
});
