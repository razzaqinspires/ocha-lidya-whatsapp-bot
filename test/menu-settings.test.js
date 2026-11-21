import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMenuText, getMenuPageCount } from '../src/core/menu-renderer.js';

const plugins = Array.from({ length: 25 }, (_, i) => ({ name: `command${String(i).padStart(2, '0')}`, category: i % 2 ? 'general' : 'owner', description: `Description ${i}`, usage: i === 0 ? '<value>' : '' }));
test('menu descriptions are globally controlled by config, hidden by default', () => {
  const hidden = buildMenuText({ plugins, config: { menu: { showDescriptions: false }, mode: 'public' }, prefixes: ['.'], masterEnabled: false });
  assert.doesNotMatch(hidden, /Description 0/);
  const shown = buildMenuText({ plugins, config: { menu: { showDescriptions: true }, mode: 'public' }, prefixes: ['.'], masterEnabled: false });
  assert.match(shown, /Description 0/);
});
test('menu pagination reports bounded page counts and stable command numbering', () => {
  const config = { menu: { pagination: { enabled: true, pageSize: 10 } }, mode: 'public' };
  assert.equal(getMenuPageCount(plugins, config, false), 3);
  const page2 = buildMenuText({ plugins, config, prefixes: ['.'], masterEnabled: false, page: 2 });
  assert.match(page2, /PAGE 2\/3/);
  assert.match(page2, /11  \.command/);
  assert.doesNotMatch(page2, /01  \.command/);
});
test('menu defaults to one full list when pagination is disabled', () => {
  const body = buildMenuText({ plugins, config: { menu: { pagination: { enabled: false } } }, prefixes: ['.'], masterEnabled: false });
  assert.doesNotMatch(body, /PAGE 1\//);
  assert.match(body, /25  \.command/);
});
