import path from 'node:path';
import { listPluginEntries } from './plugin-loader.js';
import { putRecord } from './repository.js';

const norm = value => String(value || '').trim().toLowerCase();
export async function auditCommandCollisions({ persist = true } = {}) {
  const index = new Map();
  const entries = listPluginEntries();
  for (const { plugin, file } of entries) {
    const fileHint = path.relative(process.cwd(), file).replaceAll(path.sep, '/');
    const entries = [{ value: plugin.name, kind: 'canonical' }, ...(Array.isArray(plugin.aliases) ? plugin.aliases.map(value => ({ value, kind: 'alias' })) : [])];
    for (const entry of entries) {
      const command = norm(entry.value);
      if (!command) continue;
      const list = index.get(command) || [];
      list.push({ command, plugin: plugin.name, category: plugin.category || 'other', kind: entry.kind, fileHint });
      index.set(command, list);
    }
  }
  const collisions = [...index.entries()].filter(([, items]) => items.length > 1).map(([command, items]) => ({
    command, items,
    recommendation: items.some(item => item.kind === 'canonical')
      ? 'Pertahankan command kanonis yang paling stabil; pindahkan command lain ke nama spesifik domain dan pertahankan kompatibilitas melalui alias unik.'
      : 'Pilih satu alias utama; ganti alias lainnya dengan nama yang lebih spesifik.'
  }));
  const report = { scannedPlugins: entries.length, collisions, scannedAt: new Date().toISOString(), mode: 'detect-and-stage-no-destructive-edit' };
  if (persist && collisions.length) {
    await putRecord('command.governance.report', new Date().toISOString(), report, { source: 'command-governance', reason: 'autonomous command and alias collision scan' });
  }
  return report;
}
