import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMenuText, getMenuStats } from '../src/core/menu-renderer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = path.join(root, 'src', 'plugins');

function walk(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) result.push(full);
  }
  return result;
}

function readCommandMetadata(file) {
  const source = fs.readFileSync(file, 'utf8');
  const exportStart = source.lastIndexOf('export default {');
  const pluginSource = exportStart >= 0 ? source.slice(exportStart) : source;
  const name = pluginSource.match(/\bname\s*:\s*['"]([^'"]+)['"]/m)?.[1];
  if (!name) return null;
  const category = pluginSource.match(/\bcategory\s*:\s*['"]([^'"]+)['"]/m)?.[1] || 'other';
  const usage = pluginSource.match(/\busage\s*:\s*['"]([^'"]*)['"]/m)?.[1] || '';
  const aliasesSource = pluginSource.match(/\baliases\s*:\s*\[([^\]]*)\]/m)?.[1] || '';
  const aliases = [...aliasesSource.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
  const menuFalse = /\bmenu\s*:\s*false/.test(pluginSource);
  return {
    name,
    category,
    usage,
    aliases,
    menu: menuFalse ? false : undefined,
    menuFalse,
    ownerOnly: /\bownerOnly\s*:\s*true/.test(pluginSource),
    privateOnly: /\bprivateOnly\s*:\s*true/.test(pluginSource),
  };
}

test('public source plugins contribute canonical commands while private .test stays outside the public menu', () => {
  const plugins = walk(pluginRoot).map(readCommandMetadata).filter(Boolean);
  const body = buildMenuText({ plugins, config: { mode: 'public', bot: { name: 'Ocha Lidya' } }, prefixes: ['.'] });
  const stats = getMenuStats(plugins);
  assert.ok(plugins.length >= 25, `expected broad public plugin set, found ${plugins.length}`);
  assert.ok(
    !plugins.some(plugin => plugin.name === 'test'),
    'private message lab must not be part of the public source registry',
  );
  assert.doesNotMatch(
    body,
    /\.test \[pilihan dari daftar\]/,
    'private message lab must stay hidden in public compatibility mode',
  );
  assert.match(body, /\.react \[menu\|on\|off\|status\]/);
  assert.match(body, /\.apikey <add\|delete\|list\|get> <provider> \[value\]/);
  const expectedCommands = plugins
    .filter(plugin => !plugin.menuFalse)
    .reduce((total, plugin) => total + 1 + (plugin.aliases || []).length, 0);
  assert.equal(stats.commands, expectedCommands);
  assert.match(body, /\.ytmp3/);
  assert.doesNotMatch(
    body,
    /daftar perintah|Kelola API key|laboratorium uji/i,
    'menu lists command syntax without descriptions',
  );
});

test('private message lab source retains ownerOnly and privateOnly descriptor flags', async t => {
  const privatePlugin = path.join(
    root,
    '.private',
    'ocha-private-runtime',
    'src',
    'plugins',
    'owner',
    'message-lab.js',
  );
  let source;
  try {
    source = await fsPromises.readFile(privatePlugin, 'utf8');
  } catch {
    t.skip('private runtime source is not included in a public-only checkout');
    return;
  }
  const descriptor = source.slice(source.lastIndexOf('export default {'));
  assert.match(descriptor, /ownerOnly\s*:\s*true/);
  assert.match(descriptor, /privateOnly\s*:\s*true/);
  assert.match(descriptor, /name\s*:\s*['"]test['"]/);
});

test('two-repository auto-push control remains owner-private, hidden and collision-free', () => {
  const plugins = walk(pluginRoot).map(readCommandMetadata).filter(Boolean);
  const autopush = plugins.find(plugin => plugin.name === 'autopush');
  assert.ok(autopush, 'autopush plugin must be registered');
  assert.deepEqual(autopush.aliases, ['gitpush', 'autogit']);
  assert.equal(autopush.ownerOnly, true);
  assert.equal(autopush.privateOnly, true);
  assert.equal(autopush.menuFalse, true);
  const identifiers = new Map();
  const collisions = [];
  for (const plugin of plugins) {
    for (const identifier of [plugin.name, ...(plugin.aliases || [])]) {
      const key = identifier.toLowerCase();
      if (identifiers.has(key)) collisions.push({ key, first: identifiers.get(key), second: plugin.name });
      else identifiers.set(key, plugin.name);
    }
  }
  assert.deepEqual(collisions, [], 'all canonical commands and aliases must be unique');
  const ownerMenu = buildMenuText({ plugins, config: { mode: 'self', bot: { name: 'Ocha Lidya' } }, prefixes: ['.'] });
  assert.doesNotMatch(ownerMenu, /\.autopush|\.gitpush|\.autogit/i, 'push controls must not appear in any menu');
});
