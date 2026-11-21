import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCommandCooldown, evaluateCooldown, shouldNotifyCooldown, resetCommandGovernorMemory } from '../src/core/command-governor.js';

test('adaptive cooldown is command-specific and workload-weighted', () => {
  const simple = estimateCommandCooldown({ name: 'ping' }, 'ping');
  const heavy = estimateCommandCooldown({ name: 'run', description: 'execute code preview website' }, 'run');
  assert.ok(simple.milliseconds >= 1200);
  assert.ok(heavy.milliseconds > simple.milliseconds);
  assert.ok(heavy.milliseconds <= 45000);
});
test('cooldown keys are isolated by sender, chat and command', () => {
  resetCommandGovernorMemory();
  const plugin = { name: 'menu' };
  const first = evaluateCooldown({ sender: 'u1', chat: 'c1', command: 'menu', plugin, now: 1000 });
  const second = evaluateCooldown({ sender: 'u1', chat: 'c1', command: 'menu', plugin, now: 1100 });
  const otherCommand = evaluateCooldown({ sender: 'u1', chat: 'c1', command: 'ping', plugin: { name: 'ping' }, now: 1100 });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(otherCommand.allowed, true);
});
test('cooldown notice is rate-limited to one notice per command window', () => {
  resetCommandGovernorMemory();
  const args = { sender: 'u', chat: 'c', command: 'search', now: 1000 };
  assert.equal(shouldNotifyCooldown(args), true);
  assert.equal(shouldNotifyCooldown({ ...args, now: 2000 }), false);
  assert.equal(shouldNotifyCooldown({ ...args, now: 62001 }), true);
});
