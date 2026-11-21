import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMenuText, getMenuStats } from '../src/core/menu-renderer.js';

const plugins = [
  { name: 'menu', category: 'general' },
  { name: 'profile', category: 'general' },
  { name: 'test', category: 'owner', ownerOnly: true, usage: '<type> [args]', description: 'Do not show me' },
  { name: 'apikey', category: 'owner', ownerOnly: true, usage: '<action> <provider> [value]' },
  { name: 'run', category: 'developer', usage: '<language> <code>' },
  { name: 'test', category: 'owner', ownerOnly: true, usage: '<duplicate>' }
];

test('menu renderer is sourced from the plugin definitions and includes owner commands', () => {
  const body = buildMenuText({ plugins, config: { mode: 'public' }, prefixes: ['.', '!'] });
  assert.match(body, /PLUGINS\s+5/);
  assert.match(body, /\.test <type> \[args\]/);
  assert.match(body, /\.apikey <action> <provider> \[value\]/);
  assert.match(body, /\.run <language> <code>/);
  assert.match(body, /MASTER CONSOLE/);
  assert.doesNotMatch(body, /Do not show me/);
  assert.equal((body.match(/\.test/g) || []).length, 1, 'duplicate command names are rendered once');
});

test('menu renderer uses live prefixes and omits the master block when disabled', () => {
  const body = buildMenuText({ plugins: [{ name: 'ping', category: 'general' }], config: { mode: 'self' }, prefixes: [] , masterEnabled: false });
  assert.match(body, /PREFIX\s+\(tanpa prefix\)/);
  assert.match(body, /MODE\s+SELF/);
  assert.doesNotMatch(body, /MASTER CONSOLE/);
  assert.match(buildMenuText({ plugins: [{ name: 'ping', category: 'general' }], config: { mode: 'public' }, prefixes: ['!'], masterEnabled: false }), /01  !ping/);
  assert.equal(getMenuStats(plugins).commands, 5);
});
