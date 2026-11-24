const CATEGORY_ORDER = ['general', 'developer', 'owner'];
const CATEGORY_LABELS = { general: 'GENERAL', developer: 'DEVELOPER', owner: 'OWNER / SYSTEM' };
function normalizeCategory(plugin) { return String(plugin?.menuCategory || plugin?.category || 'other').trim().toLowerCase() || 'other'; }
function formatUsage(plugin) { const usage = String(plugin?.usage || '').trim(); return usage ? ` ${usage}` : ''; }
function commandInventory(plugins = []) {
  const source = (plugins || []).filter(plugin => plugin?.name && plugin.menu !== false);
  const canonicalNames = new Set(source.map(plugin => String(plugin.name).trim().toLowerCase()).filter(Boolean));
  const unique = new Map();
  for (const plugin of source) {
    const name = String(plugin.name).trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name) || unique.has(name)) continue;
    unique.set(name, { name, usage: formatUsage(plugin), description: String(plugin.description || '').trim(), category: normalizeCategory(plugin), canonical: name, alias: false });
  }
  for (const plugin of source) {
    const canonical = String(plugin.name).trim().toLowerCase();
    for (const rawAlias of Array.isArray(plugin.aliases) ? plugin.aliases : []) {
      const alias = String(rawAlias || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(alias) || canonicalNames.has(alias) || unique.has(alias)) continue;
      const description = String(plugin.description || '').trim();
      unique.set(alias, { name: alias, usage: '', description: `Alias dari .${canonical}. ${description}`.trim(), category: normalizeCategory(plugin), canonical, alias: true });
    }
  }
  return [...unique.values()];
}

export function buildMenuText({ plugins = [], config = {}, prefixes = [], masterEnabled = true, page = 1, pageSize, showDescriptions } = {}) {
  const rawCommands = commandInventory(plugins);
  const categories = [...new Set(rawCommands.map(command => command.category))];
  const orderedCategories = [...CATEGORY_ORDER.filter(category => categories.includes(category)), ...categories.filter(category => !CATEGORY_ORDER.includes(category)).sort()];
  const commands = [...rawCommands].sort((a, b) => orderedCategories.indexOf(a.category) - orderedCategories.indexOf(b.category) || a.name.localeCompare(b.name));
  const settings = config.menu || {};
  const paginated = Boolean(settings.pagination?.enabled);
  const limit = Math.max(10, Math.min(200, Number(pageSize || settings.pagination?.pageSize || 50)));
  const currentPage = paginated ? Math.max(1, Math.floor(Number(page) || 1)) : 1;
  const totalCommands = commands.length + (masterEnabled ? 4 : 0);
  const totalPages = paginated ? Math.max(1, Math.ceil(totalCommands / limit)) : 1;
  const start = paginated ? (currentPage - 1) * limit : 0;
  const end = paginated ? start + limit : Infinity;
  const includeDescriptions = typeof showDescriptions === 'boolean' ? showDescriptions : Boolean(settings.showDescriptions);
  const prefixLabel = prefixes.length ? prefixes.join(' ') : '(tanpa prefix)';
  const commandPrefix = prefixes[0] || '';
  const mode = String(config.mode || 'public').toUpperCase();
  const botName = String(config.bot?.name || 'Ocha Lidya').trim().toUpperCase();
  const lines = [`*${botName} AI · NEXORA*`, `COMMAND DIRECTORY · ${totalCommands} COMMANDS`, '', `PLUGINS ${commands.length} · CATEGORIES ${categories.length}`, `PREFIX ${prefixLabel} · MODE ${mode}`];
  if (paginated) lines.push(`PAGE ${currentPage}/${totalPages} · COMMANDS ${Math.min(start + 1, totalCommands)}–${Math.min(end, totalCommands)} OF ${totalCommands}`);
  lines.push('');
  for (const category of orderedCategories) {
    const entries = commands.filter(command => command.category === category).sort((a, b) => a.name.localeCompare(b.name));
    const visible = entries.filter((_, i) => {
      const globalIndex = commands.filter(item => orderedCategories.indexOf(item.category) < orderedCategories.indexOf(category)).length + i;
      return globalIndex >= start && globalIndex < end;
    });
    if (!visible.length) continue;
    lines.push(`*${CATEGORY_LABELS[category] || category.replace(/[_-]+/g, ' ').toUpperCase()}*`);
    for (const command of visible) {
      const globalIndex = commands.indexOf(command) + 1;
      lines.push(`${String(globalIndex).padStart(2, '0')}  ${commandPrefix}${command.name}${command.usage}`);
      if (includeDescriptions && command.description) lines.push(`    ${command.description}`);
    }
    lines.push('');
  }
  if (masterEnabled) {
    const master = ['=> <javascript>', '$ <javascript>', '>> <python>', '>>> <go>'];
    const offset = commands.length;
    const visible = master.filter((_, i) => offset + i >= start && offset + i < end);
    if (visible.length) { lines.push('*MASTER CONSOLE*'); lines.push(...visible); lines.push(''); }
  }
  if (paginated) lines.push(`Balas pesan menu ini dengan nomor halaman 1–${totalPages}.`);
  lines.push('RAZZAQ VENTURES · OCHA LIDYA / NEXORA');
  return lines.join('\n').trim();
}
export function getMenuStats(plugins = []) {
  const commands = commandInventory(plugins);
  return { commands: commands.length, categories: new Set(commands.map(item => item.category)).size };
}
export function getMenuPageCount(plugins = [], config = {}, masterEnabled = true) {
  const count = commandInventory(plugins).length + (masterEnabled ? 4 : 0);
  return config.menu?.pagination?.enabled ? Math.max(1, Math.ceil(count / Math.max(10, Math.min(200, Number(config.menu.pagination.pageSize) || 50)))) : 1;
}
