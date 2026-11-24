import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { listPlugins } from '../../core/plugin-loader.js';
import { getPrefixes } from '../../core/prefix.js';
import { getConfig } from '../../core/config.js';
import { buildMenuText, getMenuPageCount, getMenuStats } from '../../core/menu-renderer.js';
import { registerReplySession } from '../../core/reply-sessions.js';

const BANNER_PATH = fileURLToPath(new URL('../../../assets/menu-banner.jpg', import.meta.url));
const CATEGORY_LABELS = Object.freeze({
  general: 'UMUM',
  developer: 'DEVELOPER',
  owner: 'OWNER / SYSTEM'
});
const CATEGORY_ALIASES = Object.freeze({
  umum: 'general', general: 'general',
  dev: 'developer', developer: 'developer',
  owner: 'owner', system: 'owner', 'owner-system': 'owner'
});
const PAGE_SIZE = 7;
const MAX_ROW_TEXT = 24;
const MAX_ROW_DESCRIPTION = 72;

function truncate(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…` : text;
}

function visibleCommands(plugins, isOwner) {
  const unique = new Map();
  for (const plugin of plugins || []) {
    const name = String(plugin?.name || '').trim().toLowerCase();
    if (!name || plugin.menu === false || (!isOwner && (plugin.ownerOnly || String(plugin.menuCategory || plugin.category || '').toLowerCase() === 'owner'))) continue;
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name) || unique.has(name)) continue;
    const category = String(plugin.menuCategory || plugin.category || 'other').trim().toLowerCase() || 'other';
    unique.set(name, {
      name,
      category,
      usage: String(plugin.usage || '').trim(),
      description: String(plugin.description || '').trim()
    });
  }
  return [...unique.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'en', { numeric: true }));
}

function createListButton(title, sectionTitle, rows) {
  return {
    name: 'single_select',
    buttonParamsJson: JSON.stringify({
      title,
      sections: [{ title: sectionTitle, rows }]
    })
  };
}

export function buildMenuButtonModel({ plugins = [], prefixes = ['.'], isOwner = false, category = '', page = 1 } = {}) {
  const prefix = Array.isArray(prefixes) ? (prefixes[0] || '') : String(prefixes || '');
  const commands = visibleCommands(plugins, isOwner);
  const categories = [...new Set(commands.map(command => command.category))];
  const selectedCategory = CATEGORY_ALIASES[String(category || '').toLowerCase()] || String(category || '').toLowerCase();

  if (!selectedCategory) {
    const rows = categories.map(key => {
      const count = commands.filter(command => command.category === key).length;
      const label = CATEGORY_LABELS[key] || key.replace(/[_-]+/g, ' ').toUpperCase();
      return {
        id: `${prefix}menu ${key} 1`,
        title: truncate(label, MAX_ROW_TEXT),
        description: `${count} command tersedia · tekan untuk membuka`
      };
    });
    rows.push(
      { id: `${prefix}profile`, title: 'Profile Saya', description: 'XP, level, rank, aktivitas, dan badge' },
      { id: `${prefix}website`, title: 'Website Builder', description: 'Mulai membuat website profesional' }
    );
    return {
      kind: 'categories',
      title: 'Pilih kategori command',
      body: rows,
      buttons: [createListButton('Buka kategori', 'COMMAND DIRECTORY', rows.slice(0, 10))],
      totalCommands: commands.length,
      totalPages: 1
    };
  }

  const categoryCommands = commands.filter(command => command.category === selectedCategory);
  const totalPages = Math.max(1, Math.ceil(categoryCommands.length / PAGE_SIZE));
  const currentPage = Math.max(1, Math.min(totalPages, Math.floor(Number(page) || 1)));
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = categoryCommands.slice(start, start + PAGE_SIZE);
  const rows = visible.map(command => ({
    id: `${prefix}${command.name}`.trim(),
    title: truncate(`${prefix}${command.name}`, MAX_ROW_TEXT),
    description: truncate([command.usage, command.description].filter(Boolean).join(' · ') || 'Jalankan command ini', MAX_ROW_DESCRIPTION)
  }));

  if (currentPage > 1) rows.push({
    id: `${prefix}menu ${selectedCategory} ${currentPage - 1}`,
    title: '← Halaman sebelumnya',
    description: `Kembali ke halaman ${currentPage - 1}`
  });
  if (currentPage < totalPages) rows.push({
    id: `${prefix}menu ${selectedCategory} ${currentPage + 1}`,
    title: 'Halaman berikutnya →',
    description: `Lihat halaman ${currentPage + 1} dari ${totalPages}`
  });
  rows.push({ id: `${prefix}menu`, title: '← Kategori utama', description: 'Kembali ke pilihan kategori' });

  return {
    kind: 'commands',
    title: `${CATEGORY_LABELS[selectedCategory] || selectedCategory.toUpperCase()} · ${currentPage}/${totalPages}`,
    body: visible,
    buttons: [createListButton('Pilih command', `${CATEGORY_LABELS[selectedCategory] || selectedCategory.toUpperCase()} COMMANDS`, rows.slice(0, 10))],
    totalCommands: categoryCommands.length,
    totalPages,
    currentPage,
    category: selectedCategory
  };
}

function parseMenuArgs(args = []) {
  const first = String(args[0] || '').toLowerCase();
  const category = CATEGORY_ALIASES[first] || '';
  if (category) return { category, page: Number(args[1]) || 1 };
  return { category: '', page: Number(args[0]) || 1 };
}

async function sendInteractiveMenu(sock, message, options, image = null) {
  if (typeof sock.sendInteractive !== 'function') return null;
  try {
    return await sock.sendInteractive(message.chat, {
      title: options.title,
      subtitle: 'OCHA LIDYA · NEXORA COMMAND CENTER',
      body: options.body,
      footer: 'Razzaq Ventures · Pilih satu baris untuk menjalankan command',
      ...(image ? { image } : {}),
      buttons: options.buttons
    }, message);
  } catch (error) {
    // A native-flow failure should never suppress the ordinary text fallback.
    return null;
  }
}

async function sendMenuPage(sock, message, { category = '', page = 1, isOwner = false } = {}) {
  const config = getConfig();
  const plugins = listPlugins();
  const prefixes = getPrefixes();
  const prefix = prefixes[0] || '';
  let image = null;
  if (!category && Number(page) <= 1) {
    try { image = await fs.readFile(BANNER_PATH); } catch {}
  }

  if (category) {
    const model = buildMenuButtonModel({ plugins, prefixes, isOwner, category, page });
    const header = [
      '*OCHA LIDYA · COMMAND CENTER*',
      `Kategori: *${CATEGORY_LABELS[model.category] || model.category.toUpperCase()}*`,
      `Command tersedia: *${model.totalCommands}* · Halaman *${model.currentPage}/${model.totalPages}*`,
      '',
      ...model.body.map((command, index) => `${String((model.currentPage - 1) * PAGE_SIZE + index + 1).padStart(2, '0')}. ${prefix}${command.name}${command.usage ? ` ${command.usage}` : ''}`),
      '',
      'Tekan tombol *Pilih command* untuk menjalankan perintah.',
      `Navigasi teks: ${[model.currentPage > 1 ? `${prefix}menu ${model.category} ${model.currentPage - 1}` : '', model.currentPage < model.totalPages ? `${prefix}menu ${model.category} ${model.currentPage + 1}` : '', `${prefix}menu`].filter(Boolean).join(' · ')}`
    ].join('\n');
    const sent = await sendInteractiveMenu(sock, message, {
      title: model.title,
      body: header,
      buttons: model.buttons
    });
    if (sent) return sent;
    const help = `${header}\n\nNavigasi: ${prefix}menu ${model.category} ${Math.min(model.totalPages, model.currentPage + 1)} · ${prefix}menu`;
    return message.reply(help);
  }

  const menuPlugins = isOwner ? plugins : plugins.filter(plugin => !plugin.ownerOnly && String(plugin.menuCategory || plugin.category || '').toLowerCase() !== 'owner');
  const stats = getMenuStats(menuPlugins);
  const model = buildMenuButtonModel({ plugins, prefixes, isOwner });
  const summary = [
    '*OCHA LIDYA AI · NEXORA*',
    '*COMMAND CENTER*',
    '',
    `Command aktif: *${stats.commands}*`,
    `Kategori: *${model.body.filter(row => row.id.includes('menu ')).length}*`,
    `Prefix: *${prefix || '(tanpa prefix)'}*`,
    `Mode: *${String(config.mode || 'public').toUpperCase()}*`,
    '',
    'Pilih kategori untuk melihat daftar command. Setiap item dapat ditekan langsung dari daftar.',
    `Navigasi teks: ${prefix}menu general · ${prefix}menu developer${isOwner ? ` · ${prefix}menu owner` : ''} · ${prefix}profile · ${prefix}website`,
    'Akses command tetap mengikuti izin akun dan kebijakan grup.'
  ].join('\n');

  const sent = await sendInteractiveMenu(sock, message, {
    title: 'OCHA LIDYA · MENU UTAMA',
    body: summary,
    buttons: model.buttons
  }, image);
  if (sent) return sent;

  const pageCount = getMenuPageCount(menuPlugins, config, Boolean(isOwner));
  const selected = Math.max(1, Math.min(pageCount, Math.floor(Number(page) || 1)));
  const body = `${buildMenuText({ plugins: menuPlugins, config, prefixes, masterEnabled: Boolean(isOwner), page: selected })}\n\nPilih kategori dengan command: ${prefix}menu general · ${prefix}menu developer${isOwner ? ` · ${prefix}menu owner` : ''}`;
  let payload = { text: body };
  if (image) payload = { image, caption: body };
  let sentFallback;
  try { sentFallback = await sock.sendMessage(message.chat, payload, { quoted: message }); }
  catch { sentFallback = await message.reply(body); }
  if (pageCount > 1 && sentFallback?.key?.id) {
    registerReplySession({
      chat: message.chat,
      messageId: sentFallback.key.id,
      sender: message.sender,
      kind: 'menu-pagination',
      choices: Array.from({ length: pageCount }, (_, index) => ({ key: String(index + 1), label: `Page ${index + 1}`, value: index + 1 })),
      helpText: `Balas pesan menu ini dengan nomor halaman 1–${pageCount}.`,
      ttlMs: 15 * 60_000,
      onSelect: async ({ sock: replySock, message: replyMessage, value }) => sendMenuPage(replySock, replyMessage, { page: value, isOwner })
    });
  }
  return sentFallback;
}

export default {
  name: 'menu', aliases: ['help', 'commands'], category: 'general', usage: '[kategori] [halaman]',
  fullButton: false,
  description: 'Daftar command aktif dengan navigasi tombol native-flow',
  async execute({ sock, m, args, isOwner }) {
    const parsed = parseMenuArgs(args);
    return sendMenuPage(sock, m, { ...parsed, isOwner: Boolean(isOwner || m.isOwner) });
  }
};
