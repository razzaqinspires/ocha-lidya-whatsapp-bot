import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  return { name, category, usage };
}

test('all current source plugins contribute canonical commands, including .test and .apikey', () => {
  const plugins = walk(pluginRoot).map(readCommandMetadata).filter(Boolean);
  const body = buildMenuText({ plugins, config: { mode: 'public', bot: { name: 'Ocha Lidya' } }, prefixes: ['.'] });
  const stats = getMenuStats(plugins);
  assert.ok(plugins.length >= 25, `expected broad plugin set, found ${plugins.length}`);
  assert.match(body, /\.test <type> \[args\]/);
  assert.match(body, /\.apikey <add\|delete\|list\|get> <provider> \[value\]/);
  assert.equal(stats.commands, plugins.length);
  assert.doesNotMatch(body, /daftar perintah|Kelola API key|laboratorium uji/i, 'menu lists command syntax without descriptions');
});
