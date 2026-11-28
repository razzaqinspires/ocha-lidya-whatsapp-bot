import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { listPlugins } from '../../core/plugin-loader.js';
import { getPrefixes } from '../../core/prefix.js';
import { getConfig } from '../../core/config.js';
import {
  applyMenuFont,
  buildMenuText,
  getMenuPageCount,
  getMenuStats,
  getMenuTemplate,
} from '../../core/menu-renderer.js';
import { registerReplySession } from '../../core/reply-sessions.js';

const BANNER_PATH = fileURLToPath(new URL('../../../assets/menu-banner.jpg', import.meta.url));
const CATEGORY_LABELS = Object.freeze({
  general: 'UMUM',
  developer: 'DEVELOPER',
  owner: 'OWNER / SYSTEM',
});
const CATEGORY_ALIASES = Object.freeze({
  umum: 'general',
  general: 'general',
  dev: 'developer',
  developer: 'developer',
  owner: 'owner',
  system: 'owner',
  'owner-system': 'owner',
});
const PAGE_SIZE = 7;
const MAX_ROW_TEXT = 24;
const MAX_ROW_DESCRIPTION = 72;

function truncate(value, max) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…` : text;
}

function usageForCommand(plugin, commandName) {
  const usage = String(plugin?.usage || '').trim();
  if (!usage) return '';
  const pieces = usage
    .split('|')
    .map(item => item.trim())
    .filter(Boolean);
  const matching = pieces.find(item => {
    const normalized = item.replace(/^[.!/#]+/, '').toLowerCase();
    return normalized === commandName || normalized.startsWith(`${commandName} `);
  });
  if (matching) return matching.replace(/^[.!/#]*[a-z0-9_-]+/i, '').trim();
  return commandName === String(plugin?.name || '').toLowerCase() ? usage : '';
}

function visibleCommands(plugins, isOwner) {
  const source = (plugins || []).filter(
    plugin =>
      plugin?.name &&
      plugin.menu !== false &&
      (isOwner ||
        (!plugin.ownerOnly && String(plugin.menuCategory || plugin.category || '').toLowerCase() !== 'owner')),
  );
  const canonicalNames = new Set(source.map(plugin => String(plugin.name).trim().toLowerCase()).filter(Boolean));
  const unique = new Map();
  for (const plugin of source) {
    const canonical = String(plugin.name || '')
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(canonical) || unique.has(canonical)) continue;
    const category =
      String(plugin.menuCategory || plugin.category || 'other')
        .trim()
        .toLowerCase() || 'other';
    unique.set(canonical, {
      name: canonical,
      canonical,
      alias: false,
      category,
      usage: usageForCommand(plugin, canonical),
      description: String(plugin.description || '').trim(),
    });
  }
  // Keep aliases visible as executable entries. Canonical names always win
  // collisions, matching getPlugin() and preserveAlias dispatch semantics.
  for (const plugin of source) {
    const canonical = String(plugin.name || '')
      .trim()
      .toLowerCase();
    const category =
      String(plugin.menuCategory || plugin.category || 'other')
        .trim()
        .toLowerCase() || 'other';
    for (const rawAlias of Array.isArray(plugin.aliases) ? plugin.aliases : []) {
      const alias = String(rawAlias || '')
        .trim()
        .toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(alias) || canonicalNames.has(alias) || unique.has(alias)) continue;
      unique.set(alias, {
        name: alias,
        canonical,
        alias: true,
        category,
        usage: usageForCommand(plugin, alias),
        description: `Alias dari .${canonical}. ${String(plugin.description || '').trim()}`.trim(),
      });
    }
  }
  return [...unique.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'en', { numeric: true }),
  );
}

function createListButton(title, sectionTitle, rows) {
  return {
    name: 'single_select',
    buttonParamsJson: JSON.stringify({
      title,
      sections: [{ title: sectionTitle, rows }],
    }),
  };
}

export function buildMenuButtonModel({
  plugins = [],
  prefixes = ['.'],
  isOwner = false,
  category = '',
  page = 1,
  order = 'category',
  config = {},
} = {}) {
  const prefix = Array.isArray(prefixes) ? prefixes[0] || '' : String(prefixes || '');
  const commands = visibleCommands(plugins, isOwner);
  const categories = [...new Set(commands.map(command => command.category))];
  const selectedCategory =
    CATEGORY_ALIASES[String(category || '').toLowerCase()] || String(category || '').toLowerCase();

  if (!selectedCategory) {
    const orderedCategories = ['general', 'developer', 'owner'].filter(key => categories.includes(key));
    orderedCategories.push(...categories.filter(key => !orderedCategories.includes(key)).sort());
    const rows = orderedCategories.map(key => {
      const count = commands.filter(command => command.category === key).length;
      const label = CATEGORY_LABELS[key] || key.replace(/[_-]+/g, ' ').toUpperCase();
      return {
        id: `${prefix}menu ${key} 1`,
        title: truncate(label, MAX_ROW_TEXT),
        description: `${count} command tersedia · tekan untuk membuka`,
      };
    });
    rows.push(
      { id: `${prefix}yts`, title: 'YouTube Search', description: 'Cari video dan pilih unduhan MP3 atau MP4' },
      { id: `${prefix}profile`, title: 'Profile Saya', description: 'XP, level, rank, aktivitas, dan badge' },
      { id: `${prefix}website`, title: 'Website Builder', description: 'Mulai membuat website profesional' },
    );
    if (isOwner)
      rows.push(
        { id: `${prefix}test`, title: 'Message Test Lab', description: '16 pengujian payload WhatsApp bernomor' },
        {
          id: `${prefix}master status`,
          title: 'Master Console',
          description: 'Status runner, warning, dan akses grup owner',
        },
      );
    const font = config?.menu?.font || 'normal';
    return {
      kind: 'categories',
      title: applyMenuFont('Pilih kategori command', font),
      body: rows,
      buttons: [createListButton('Buka kategori', 'COMMAND DIRECTORY', rows.slice(0, 10))],
      totalCommands: commands.length,
      totalPages: 1,
    };
  }

  const categoryCommands = commands.filter(command => command.category === selectedCategory);
  categoryCommands.sort((a, b) =>
    order === 'za'
      ? b.name.localeCompare(a.name, 'en', { numeric: true })
      : a.name.localeCompare(b.name, 'en', { numeric: true }),
  );
  const totalPages = Math.max(1, Math.ceil(categoryCommands.length / PAGE_SIZE));
  const currentPage = Math.max(1, Math.min(totalPages, Math.floor(Number(page) || 1)));
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = categoryCommands.slice(start, start + PAGE_SIZE);
  const rows = visible.map(command => ({
    id: `${prefix}${command.name}`.trim(),
    title: truncate(`${prefix}${command.name}`, MAX_ROW_TEXT),
    description: truncate(
      [command.usage, config?.menu?.showDescriptions ? command.description : ''].filter(Boolean).join(' · ') ||
        'Jalankan command ini',
      MAX_ROW_DESCRIPTION,
    ),
  }));

  if (currentPage > 1)
    rows.push({
      id: `${prefix}menu ${selectedCategory} ${currentPage - 1}`,
      title: '← Halaman sebelumnya',
      description: `Kembali ke halaman ${currentPage - 1}`,
    });
  if (currentPage < totalPages)
    rows.push({
      id: `${prefix}menu ${selectedCategory} ${currentPage + 1}`,
      title: 'Halaman berikutnya →',
      description: `Lihat halaman ${currentPage + 1} dari ${totalPages}`,
    });
  rows.push({ id: `${prefix}menu`, title: '← Kategori utama', description: 'Kembali ke pilihan kategori' });

  return {
    kind: 'commands',
    title: applyMenuFont(
      `${CATEGORY_LABELS[selectedCategory] || selectedCategory.toUpperCase()} · ${currentPage}/${totalPages}`,
      config?.menu?.font || 'normal',
    ),
    body: visible,
    buttons: [
      createListButton(
        'Pilih command',
        `${CATEGORY_LABELS[selectedCategory] || selectedCategory.toUpperCase()} COMMANDS`,
        rows.slice(0, 10),
      ),
    ],
    totalCommands: categoryCommands.length,
    totalPages,
    currentPage,
    category: selectedCategory,
  };
}

function parseMenuArgs(args = []) {
  const first = String(args[0] || '').toLowerCase();
  const category = CATEGORY_ALIASES[first] || '';
  if (category) return { category, page: Number(args[1]) || 1 };
  return { category: '', page: Number(args[0]) || 1 };
}

async function sendInteractiveMenu(sock, message, options, image = null) {
  if (typeof sock.buttonBuilder !== 'function') return null;
  try {
    const listButton = (options.buttons || []).find(
      button => String(button?.name || '').toLowerCase() === 'single_select',
    );
    if (!listButton) return null;
    const params =
      typeof listButton.buttonParamsJson === 'string'
        ? JSON.parse(listButton.buttonParamsJson)
        : listButton.buttonParamsJson || {};
    if (!Array.isArray(params.sections) || !params.sections.length) return null;
    const builder = sock
      .buttonBuilder()
      .setTitle(options.title || '')
      .setSubtitle(options.subtitle || 'OCHA LIDYA · NEXORA COMMAND CENTER')
      .setBody(options.body || '')
      .setFooter(options.footer || 'Razzaq Ventures');
    if (image) builder.setImage(image);
    builder.addSelection(params.title || 'Pilih');
    for (const section of params.sections) {
      builder.makeSection(section.title || 'Pilihan', section.highlight_label || '');
      for (const row of section.rows || []) {
        builder.makeRow(row.header || '', row.title || '', row.description || '', row.id || '');
      }
    }
    return await builder.send(message.chat, { quoted: message });
  } catch (error) {
    // Use the same serializer ButtonBuilder used by working carousel/test flows.
    // If it cannot serialize, callers deliberately fall back to text output.
    return null;
  }
}

async function sendMenuPage(sock, message, { category = '', page = 1, isOwner = false } = {}) {
  const config = getConfig();
  const plugins = listPlugins();
  const prefixes = getPrefixes();
  const prefix = prefixes[0] || '';
  const menuConfig = config.menu || {};
  const font = menuConfig.font || 'normal';
  const decorate = value => applyMenuFont(value, font);
  const template = getMenuTemplate(config);
  let image = null;
  if (!category && Number(page) <= 1) {
    try {
      image = await fs.readFile(BANNER_PATH);
    } catch {}
  }

  if (category) {
    const model = buildMenuButtonModel({ plugins, prefixes, isOwner, category, page, order: menuConfig.order, config });
    const headerLines = [
      menuConfig.topBorder !== false
        ? `${template.top} ${decorate('OCHA LIDYA · COMMAND CENTER')}`
        : decorate('OCHA LIDYA · COMMAND CENTER'),
      `${decorate('Kategori')}: *${decorate(CATEGORY_LABELS[model.category] || model.category.toUpperCase())}*`,
      `${decorate('Command tersedia')}: *${model.totalCommands}* · ${decorate('Halaman')} *${model.currentPage}/${model.totalPages}*`,
      '',
      ...model.body.flatMap((command, index) => {
        const lines = [
          `${String((model.currentPage - 1) * PAGE_SIZE + index + 1).padStart(2, '0')}. ${prefix}${command.name}${command.usage ? ` ${command.usage}` : ''}`,
        ];
        if (menuConfig.showDescriptions && command.description) lines.push(`    ${command.description}`);
        for (let gap = 0; gap < Math.max(0, Math.min(3, Number(menuConfig.spacing) || 0)); gap += 1) lines.push('');
        return lines;
      }),
      '',
      decorate('Tekan tombol Pilih command untuk menjalankan perintah.'),
      `Navigasi teks: ${[model.currentPage > 1 ? `${prefix}menu ${model.category} ${model.currentPage - 1}` : '', model.currentPage < model.totalPages ? `${prefix}menu ${model.category} ${model.currentPage + 1}` : '', `${prefix}menu`].filter(Boolean).join(' · ')}`,
    ];
    if (menuConfig.bottomBorder !== false) headerLines.push(template.bottom);
    const header = headerLines.join('\n');
    const sent = await sendInteractiveMenu(sock, message, {
      title: model.title,
      body: header,
      buttons: model.buttons,
    });
    if (sent) return sent;
    const help = `${header}\n\nNavigasi: ${prefix}menu ${model.category} ${Math.min(model.totalPages, model.currentPage + 1)} · ${prefix}menu`;
    return message.reply(help);
  }

  const menuPlugins = isOwner
    ? plugins
    : plugins.filter(
        plugin => !plugin.ownerOnly && String(plugin.menuCategory || plugin.category || '').toLowerCase() !== 'owner',
      );
  const stats = getMenuStats(menuPlugins);
  const model = buildMenuButtonModel({ plugins, prefixes, isOwner, order: menuConfig.order, config });
  const summary = [
    menuConfig.topBorder !== false
      ? `${template.top} ${decorate('OCHA LIDYA AI · NEXORA')}`
      : decorate('OCHA LIDYA AI · NEXORA'),
    `*${decorate('COMMAND CENTER')}*`,
    '',
    `Command aktif: *${stats.commands}*`,
    `Kategori: *${model.body.filter(row => row.id.includes('menu ')).length}*`,
    `Prefix: *${prefix || '(tanpa prefix)'}*`,
    `Mode: *${String(config.mode || 'public').toUpperCase()}*`,
    '',
    decorate('Pilih kategori untuk melihat daftar command. Setiap item dapat ditekan langsung dari daftar.'),
    `Akses cepat: ${prefix}yts · ${prefix}profile · ${prefix}website${isOwner ? ` · ${prefix}test · ${prefix}master status` : ''}`,
    `Navigasi teks: ${prefix}menu general · ${prefix}menu developer${isOwner ? ` · ${prefix}menu owner` : ''}`,
    decorate('Akses command tetap mengikuti izin akun dan kebijakan grup.'),
    ...(menuConfig.bottomBorder !== false ? [template.bottom] : []),
  ].join('\n');

  const sent = await sendInteractiveMenu(
    sock,
    message,
    {
      title: decorate('OCHA LIDYA · MENU UTAMA'),
      body: summary,
      buttons: model.buttons,
    },
    image,
  );
  if (sent) return sent;

  const pageCount = getMenuPageCount(menuPlugins, config, Boolean(isOwner));
  const selected = Math.max(1, Math.min(pageCount, Math.floor(Number(page) || 1)));
  const body = `${buildMenuText({ plugins: menuPlugins, config, prefixes, masterEnabled: Boolean(isOwner), page: selected })}\n\nPilih kategori dengan command: ${prefix}menu general · ${prefix}menu developer${isOwner ? ` · ${prefix}menu owner` : ''}`;
  let payload = { text: body };
  if (image) payload = { image, caption: body };
  let sentFallback;
  try {
    sentFallback = await sock.sendMessage(message.chat, payload, { quoted: message });
  } catch {
    sentFallback = await message.reply(body);
  }
  if (pageCount > 1 && sentFallback?.key?.id) {
    registerReplySession({
      chat: message.chat,
      messageId: sentFallback.key.id,
      sender: message.sender,
      kind: 'menu-pagination',
      choices: Array.from({ length: pageCount }, (_, index) => ({
        key: String(index + 1),
        label: `Page ${index + 1}`,
        value: index + 1,
      })),
      helpText: `Balas pesan menu ini dengan nomor halaman 1–${pageCount}.`,
      ttlMs: 15 * 60_000,
      onSelect: async ({ sock: replySock, message: replyMessage, value }) =>
        sendMenuPage(replySock, replyMessage, { page: value, isOwner }),
    });
  }
  return sentFallback;
}

export const menuButtonTestHooks = Object.freeze({ sendInteractiveMenu, buildMenuButtonModel });

export default {
  name: 'menu',
  aliases: ['help', 'commands'],
  category: 'general',
  usage: '[kategori] [halaman]',
  fullButton: false,
  description: 'Daftar command aktif dengan navigasi tombol native-flow',
  async execute({ sock, m, args, isOwner }) {
    const parsed = parseMenuArgs(args);
    return sendMenuPage(sock, m, { ...parsed, isOwner: Boolean(isOwner || m.isOwner) });
  },
};
