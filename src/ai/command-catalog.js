import { listPlugins, getPlugin } from '../core/plugin-loader.js';
import { getAICapabilityStatus } from './capability-manager.js';

function clean(value, max = 180) {
  return String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function getRuntimeCommandInventory({ isOwner = false, includeHidden = false } = {}) {
  return listPlugins()
    .filter(plugin => includeHidden || plugin.menu !== false)
    .filter(plugin => isOwner || (!plugin.ownerOnly && !['owner', 'system', 'developer'].includes(String(plugin.category || '').toLowerCase())))
    .map(plugin => ({
      name: String(plugin.name || '').toLowerCase(),
      aliases: Array.isArray(plugin.aliases) ? plugin.aliases.map(alias => String(alias).toLowerCase()).filter(Boolean).slice(0, 8) : [],
      category: clean(plugin.menuCategory || plugin.category || 'general', 40),
      description: clean(plugin.description || 'Tidak ada deskripsi', 110),
      usage: clean(plugin.usage || '', 70),
      access: plugin.ownerOnly ? 'owner-only' : plugin.groupOnly ? 'group-only' : plugin.privateOnly ? 'private-only' : 'public',
      aiCallable: plugin.aiCallable === true
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function buildRuntimeCapabilityPrompt({ isOwner = false } = {}) {
  const commands = getRuntimeCommandInventory({ isOwner, includeHidden: isOwner });
  // Include the complete visible registry, not an arbitrary first-N slice.
  // Compact each record so larger plugin libraries remain usable within model context.
  const commandLines = commands.map(item => {
    const alias = item.aliases.length ? ` | alias: ${item.aliases.join(', ')}` : '';
    const usage = item.usage ? ` | format: ${item.usage}` : '';
    const callable = item.aiCallable ? ' | AI-callable: yes (backend authorization required)' : ' | AI-callable: no';
    return `- .${item.name}${alias} | ${item.access} | ${item.description}${usage}${callable}`;
  });
  const capabilities = getAICapabilityStatus().map(item => `- ${clean(item.label, 80)}: ${item.enabled ? 'aktif' : 'nonaktif'} — ${clean(item.description, 120)}`);
  return [
    'REGISTRY FITUR DAN COMMAND RUNTIME (sumber kebenaran aplikasi, bukan hasil tebakan model):',
    `Jumlah plugin yang terlihat untuk sesi ini: ${commands.length}. Semua entri di bawah ini berasal dari registry runtime.`,
    ...commandLines,
    'Kapabilitas AI yang benar-benar terdaftar:',
    ...(capabilities.length ? capabilities : ['- Tidak ada kapabilitas AI yang terdaftar.']),
    'Aturan grounding: hanya klaim command/fitur yang tercantum di registry ini atau dikonfirmasi backend. Jika tidak tercantum, jawab bahwa fitur belum tersedia. Jangan membuat-buat game, command, tombol, file, gambar, video, atau hasil tindakan. Tanda AI-callable menunjukkan command boleh diminta melalui bahasa alami; semua izin dan guard tetap diperiksa server.'
  ].join('\n');
}

export function resolveRuntimeCommand(name) {
  const plugin = getPlugin(String(name || '').replace(/^[.!/#]+/, '').trim().toLowerCase());
  return plugin || null;
}

export function formatRuntimeCommandDirectory({ isOwner = false } = {}) {
  const commands = getRuntimeCommandInventory({ isOwner, includeHidden: isOwner });
  if (!commands.length) return 'Belum ada command yang terdaftar pada runtime ini.';
  const groups = new Map();
  for (const item of commands) {
    const key = String(item.category || 'general').toUpperCase();
    const rows = groups.get(key) || [];
    const aliases = item.aliases.length ? ` (alias: ${item.aliases.map(alias => `.${alias}`).join(', ')})` : '';
    const access = item.access !== 'public' ? ` · ${item.access}` : '';
    rows.push(`• .${item.name}${item.usage ? ` ${item.usage}` : ''}${aliases}${access} — ${item.description}`);
    groups.set(key, rows);
  }
  return [
    '*Direktori command Ocha Lidya*',
    'Daftar ini diambil langsung dari plugin yang sedang aktif, bukan contoh atau command yang belum dipasang.',
    ...[...groups.entries()].flatMap(([category, rows]) => [`\n*${category}*`, ...rows]),
    '\nCommand owner/system tidak ditampilkan pada direktori publik.'
  ].join('\n');
}

export function isCommandDirectoryIntent(text) {
  return /\b(?:daftar|list|direktori|menu|command|perintah)\b.{0,45}\b(?:kamu|bot|ocha|tersedia|aktif|apa\s+saja|semua)\b|\b(?:fitur|command|perintah)\s+(?:apa\s+saja|yang\s+tersedia|yang\s+aktif)\b/i.test(String(text || ''));
}
