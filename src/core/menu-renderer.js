const CATEGORY_ORDER = ['general', 'developer', 'owner'];
const CATEGORY_LABELS = { general: 'GENERAL', developer: 'DEVELOPER', owner: 'OWNER / SYSTEM' };

export const MENU_TEMPLATES = Object.freeze({
  corporate: { top: '╭━━━〔', mid: '┃', bottom: '╰━━━━━━━━━━━━━━━━' },
  minimal: { top: '┌─', mid: '│', bottom: '└────────────' },
  terminal: { top: '╔══[', mid: '║', bottom: '╚════════════' },
  elegant: { top: '┏━━━━━━━━', mid: '┃', bottom: '┗━━━━━━━━━━━━' },
  aurora: { top: '✦･ﾟ〔', mid: '✧', bottom: '✦━━━━━━━━━━━━' },
  classic: { top: '╔════〔', mid: '║', bottom: '╚════════════' },
  compact: { top: '〔', mid: '›', bottom: '┈┈┈┈┈┈┈┈┈' },
  minimalist: { top: '┌─', mid: '·', bottom: '└────────────' },
  cyberpunk: { top: '╔═[', mid: '▸', bottom: '╚════════════' },
  fantasy: { top: '✧༺', mid: '✦', bottom: '༻✧━━━━━━━━━━' },
  ocean: { top: '🌊 ━〔', mid: '≈', bottom: '🌊 ━━━━━━━━━' },
  sunset: { top: '🌇 ╭〔', mid: '☀', bottom: '╰━━━━━━━━🌇' },
  emerald: { top: '❖ ╭〔', mid: '◆', bottom: '╰━━━━━━━━❖' },
  sakura: { top: '🌸 ╭〔', mid: '✿', bottom: '╰━━━━━━━━🌸' },
  monochrome: { top: '▰▰〔', mid: '│', bottom: '▰▰▰▰▰▰▰' },
  royal: { top: '♛ ╔〔', mid: '♜', bottom: '╚════════♛' },
});

const mapChars = (text, upper, lower, digits = null) =>
  String(text).replace(/[A-Za-z0-9]/g, char => {
    const code = char.charCodeAt(0);
    if (code >= 65 && code <= 90) return upper ? String.fromCodePoint(upper + code - 65) : char;
    if (code >= 97 && code <= 122) return lower ? String.fromCodePoint(lower + code - 97) : char;
    if (code >= 48 && code <= 57) return digits ? String.fromCodePoint(digits + code - 48) : char;
    return char;
  });

const replaceMap = (value, source, target) => {
  const mapping = new Map([...source].map((char, index) => [char, target[index] || char]));
  return [...String(value)].map(char => mapping.get(char) || mapping.get(char.toLowerCase()) || char).join('');
};

const superscriptSource = 'abcdefghijklmnopqrstuvwxyz';
const superscriptTarget = 'ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖqʳˢᵗᵘᵛʷˣʸᶻ';
const smallCapsTarget = 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ';

export const MENU_FONTS = Object.freeze({
  normal: value => String(value),
  bolditalic: value => mapChars(value, 0x1d468, 0x1d482),
  bold: value => mapChars(value, 0x1d400, 0x1d41a, 0x1d7ce),
  sans: value => mapChars(value, 0x1d5d4, 0x1d5ee, 0x1d7f6),
  mono: value => mapChars(value, 0x1d670, 0x1d68a, 0x1d7f6),
  superscript: value =>
    [...String(value)]
      .map(char => {
        const index = superscriptSource.indexOf(char.toLowerCase());
        return index >= 0 ? [...superscriptTarget][index] || char : char;
      })
      .join(''),
  double: value => mapChars(value, 0x1d538, 0x1d552, 0x1d7d8),
  smallcaps: value =>
    [...String(value)]
      .map(char => {
        const index = superscriptSource.indexOf(char.toLowerCase());
        return index >= 0 ? [...smallCapsTarget][index] || char : char;
      })
      .join(''),
  fraktur: value => mapChars(value, 0x1d56c, 0x1d586),
  italic: value => mapChars(value, 0x1d434, 0x1d44e),
  script: value => mapChars(value, 0x1d49c, 0x1d4b6),
  circled: value =>
    replaceMap(
      value,
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
      'ⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ',
    ),
});

export function applyMenuFont(value, font = 'normal') {
  const transform = MENU_FONTS[String(font || 'normal').toLowerCase()] || MENU_FONTS.normal;
  return transform(String(value));
}

export function getMenuTemplate(config = {}) {
  const name = String(config?.menu?.template || 'corporate').toLowerCase();
  return MENU_TEMPLATES[name] || MENU_TEMPLATES.corporate;
}

function normalizeCategory(plugin) {
  return (
    String(plugin?.menuCategory || plugin?.category || 'other')
      .trim()
      .toLowerCase() || 'other'
  );
}

function formatUsage(plugin) {
  const usage = String(plugin?.usage || '').trim();
  return usage ? ` ${usage}` : '';
}

function commandInventory(plugins = []) {
  const source = (plugins || []).filter(plugin => plugin?.name && plugin.menu !== false);
  const canonicalNames = new Set(source.map(plugin => String(plugin.name).trim().toLowerCase()).filter(Boolean));
  const unique = new Map();
  for (const plugin of source) {
    const name = String(plugin.name).trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name) || unique.has(name)) continue;
    unique.set(name, {
      name,
      usage: formatUsage(plugin),
      description: String(plugin.description || '').trim(),
      category: normalizeCategory(plugin),
      canonical: name,
      alias: false,
    });
  }
  for (const plugin of source) {
    const canonical = String(plugin.name).trim().toLowerCase();
    for (const rawAlias of Array.isArray(plugin.aliases) ? plugin.aliases : []) {
      const alias = String(rawAlias || '')
        .trim()
        .toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(alias) || canonicalNames.has(alias) || unique.has(alias)) continue;
      const description = String(plugin.description || '').trim();
      unique.set(alias, {
        name: alias,
        usage: '',
        description: `Alias dari .${canonical}. ${description}`.trim(),
        category: normalizeCategory(plugin),
        canonical,
        alias: true,
      });
    }
  }
  return [...unique.values()];
}

function sortCommands(commands, order = 'category') {
  const items = [...commands];
  if (order === 'az') return items.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  if (order === 'za') return items.sort((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true }));
  return items.sort((a, b) => {
    const categoryOrder = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    if (categoryOrder !== 0) {
      if (CATEGORY_ORDER.includes(a.category) && CATEGORY_ORDER.includes(b.category)) return categoryOrder;
      if (CATEGORY_ORDER.includes(a.category)) return -1;
      if (CATEGORY_ORDER.includes(b.category)) return 1;
      return a.category.localeCompare(b.category);
    }
    return a.name.localeCompare(b.name, 'en', { numeric: true });
  });
}

export function buildMenuText({
  plugins = [],
  config = {},
  prefixes = [],
  masterEnabled = true,
  page = 1,
  pageSize,
  showDescriptions,
} = {}) {
  const settings = config.menu || {};
  const commands = sortCommands(commandInventory(plugins), settings.order || 'category');
  const categories = [...new Set(commands.map(command => command.category))];
  const paginated = Boolean(settings.pagination?.enabled);
  const limit = Math.max(10, Math.min(200, Math.floor(Number(pageSize || settings.pagination?.pageSize || 50))));
  const totalCommands = commands.length + (masterEnabled ? 4 : 0);
  const totalPages = paginated ? Math.max(1, Math.ceil(totalCommands / limit)) : 1;
  const currentPage = paginated ? Math.max(1, Math.min(totalPages, Math.floor(Number(page) || 1))) : 1;
  const start = paginated ? (currentPage - 1) * limit : 0;
  const end = paginated ? start + limit : Infinity;
  const includeDescriptions =
    typeof showDescriptions === 'boolean' ? showDescriptions : Boolean(settings.showDescriptions);
  const prefixLabel = prefixes.length ? prefixes.join(' ') : '(tanpa prefix)';
  const commandPrefix = prefixes[0] || '';
  const mode = String(config.mode || 'public').toUpperCase();
  const botName = String(config.bot?.name || 'Ocha Lidya')
    .trim()
    .toUpperCase();
  const template = getMenuTemplate(config);
  const font = settings.font || 'normal';
  const decorate = value => applyMenuFont(value, font);
  const lines = [];

  if (settings.topBorder !== false) lines.push(`${template.top} ${decorate(botName)} · MENU`);
  else lines.push(`${decorate(botName)} · MENU`);
  lines.push(decorate(`COMMAND DIRECTORY · ${totalCommands} COMMANDS`));
  lines.push(`${decorate(`PLUGINS ${commands.length} · CATEGORIES ${categories.length}`)}`);
  lines.push(`${decorate(`PREFIX ${prefixLabel} · MODE ${mode}`)}`);
  if (paginated)
    lines.push(
      decorate(
        `PAGE ${currentPage}/${totalPages} · COMMANDS ${Math.min(start + 1, totalCommands)}–${Math.min(end, totalCommands)} OF ${totalCommands}`,
      ),
    );
  lines.push('');

  const appendCommand = (command, index) => {
    // Command identifiers remain plain ASCII so users can copy and execute them.
    lines.push(`${String(index + 1).padStart(2, '0')}  ${commandPrefix}${command.name}${command.usage}`);
    if (includeDescriptions && command.description) lines.push(`    ${command.description}`);
    if (Number(settings.spacing) > 0) lines.push('');
  };

  const pageCommands = commands.filter((_, index) => index >= start && index < end);
  if (settings.order === 'az' || settings.order === 'za') {
    if (pageCommands.length) {
      lines.push(`${template.mid} ${decorate(settings.order === 'za' ? 'ALL COMMANDS · Z–A' : 'ALL COMMANDS · A–Z')}`);
      pageCommands.forEach(command => {
        const originalIndex = commands.indexOf(command);
        appendCommand(command, originalIndex);
      });
    }
  } else {
    for (const category of categories) {
      const entries = commands.filter(command => command.category === category);
      const visible = entries.filter(command => {
        const globalIndex = commands.indexOf(command);
        return globalIndex >= start && globalIndex < end;
      });
      if (!visible.length) continue;
      if (lines.at(-1) !== '') lines.push('');
      lines.push(
        `${template.mid} *${decorate(CATEGORY_LABELS[category] || category.replace(/[_-]+/g, ' ').toUpperCase())}*`,
      );
      visible.forEach(command => appendCommand(command, commands.indexOf(command)));
    }
  }

  if (masterEnabled) {
    const master = ['=> <javascript>', '$ <javascript>', '>> <python>', '>>> <go>'];
    const visible = master.filter((_, index) => commands.length + index >= start && commands.length + index < end);
    if (visible.length) {
      if (lines.at(-1) !== '') lines.push('');
      lines.push(`${template.mid} *${decorate('MASTER CONSOLE')}*`);
      lines.push(...visible);
    }
  }
  if (paginated) {
    lines.push('');
    lines.push(decorate(`Balas pesan menu ini dengan nomor halaman 1–${totalPages}.`));
  }
  if (settings.bottomBorder !== false) lines.push(template.bottom);
  lines.push(decorate('RAZZAQ VENTURES · OCHA LIDYA / NEXORA'));
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function getMenuStats(plugins = []) {
  const commands = commandInventory(plugins);
  return { commands: commands.length, categories: new Set(commands.map(item => item.category)).size };
}

export function getMenuPageCount(plugins = [], config = {}, masterEnabled = true) {
  const count = commandInventory(plugins).length + (masterEnabled ? 4 : 0);
  const size = Math.max(10, Math.min(200, Math.floor(Number(config.menu?.pagination?.pageSize) || 50)));
  return config.menu?.pagination?.enabled ? Math.max(1, Math.ceil(count / size)) : 1;
}

export const menuRendererTestHooks = Object.freeze({ commandInventory, sortCommands });
