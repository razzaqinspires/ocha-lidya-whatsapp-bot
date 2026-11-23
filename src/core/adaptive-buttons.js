const HARD_EXEMPTIONS = new Map([
  ['buttons', 'pengelola kebijakan tombol'],
  ['menu', 'menu memiliki banner dan navigasi halaman sendiri'],
  ['sewa', 'checkout memiliki Native Flow dan alur pembayaran khusus'],
  ['yts', 'hasil YouTube memakai carousel dan daftar resolusi khusus'],
  ['test', 'laboratorium serializer mengirim payload uji secara eksplisit'],
  ['groupinfo', 'navigasi metadata memakai reply-session yang terikat ke pesan'],
  ['profile', 'profil memakai kartu gambar dan fallback caption'],
  ['owner', 'kartu kontak dikirim melalui payload kontak khusus']
]);

const SAFE_READ_ACTIONS = new Set([
  'about', 'all', 'audit', 'catalog', 'db', 'free', 'help', 'history', 'info',
  'list', 'ls', 'menu', 'models', 'pending', 'plans', 'plugins', 'quota',
  'runtime', 'status', 'storage', 'usage', 'version'
]);

const ACTION_LABELS = {
  about: 'Tentang Bot', all: 'Semua Data', audit: 'Audit', catalog: 'Katalog',
  db: 'Database', free: 'Model Gratis', help: 'Panduan', history: 'Riwayat',
  info: 'Informasi', list: 'Daftar', ls: 'Daftar', menu: 'Menu Utama',
  models: 'Daftar Model', pending: 'Menunggu', plans: 'Paket', plugins: 'Plugin',
  quota: 'Kuota', runtime: 'Runtime', status: 'Status', storage: 'Penyimpanan',
  usage: 'Penggunaan', version: 'Versi'
};

const DEFAULT_ACTIONS = {
  general: [
    { label: 'Menu Utama', command: 'menu', description: 'Lihat daftar command' },
    { label: 'Tentang Bot', command: 'about', description: 'Informasi Ocha Lidya' },
    { label: 'Kontak Owner', command: 'owner', description: 'Hubungi pengelola bot' }
  ],
  developer: [
    { label: 'Menu Utama', command: 'menu', description: 'Lihat daftar command' },
    { label: 'Runtime', command: 'runtime', description: 'Periksa kondisi proses' },
    { label: 'Tentang Bot', command: 'about', description: 'Informasi sistem' }
  ],
  owner: [
    { label: 'Menu Utama', command: 'menu', description: 'Lihat daftar command' },
    { label: 'Database', command: 'dbstatus', description: 'Ringkasan status penyimpanan' },
    { label: 'Runtime', command: 'runtime', description: 'Periksa kondisi proses' }
  ]
};

const PROGRESS_PATTERN = /^(?:\s|[.\-_*])*?(?:memproses|sedang memproses|menyiapkan|mengunduh|menjalankan|build(?:ing)?\b|deploy(?:ing)?\b|queued\b|processing\b|please wait\b|mohon tunggu\b)/i;
const CODE_OR_DIAGNOSTIC_PATTERN = /```|^\s*(?:at\s.+:\d+:\d+|(?:Error|TypeError|ReferenceError|SyntaxError):)|\b(?:stack trace|stderr|stdout|traceback)\b/im;
const COMMAND_TOKEN = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

function normalizeCommand(value) {
  return String(value || '').trim().toLowerCase().replace(/^[/!.#]+/, '').split(/\s+/)[0];
}

function normalizeActionCommand(value) {
  const parts = String(value || '').trim().toLowerCase().replace(/^[/!.#]+/, '').split(/\s+/).filter(Boolean);
  if (!parts.length || parts.length > 4 || parts.some(part => !COMMAND_TOKEN.test(part))) return '';
  return parts.join(' ');
}

function getPrefix(config, requestedPrefix = '') {
  if (typeof requestedPrefix === 'string' && requestedPrefix) return requestedPrefix;
  const prefix = config?.prefix || {};
  if (prefix.mode === 'none') return '';
  if (prefix.mode === 'single') return String(prefix.single || '.');
  const list = Array.isArray(prefix.list) ? prefix.list.filter(value => typeof value === 'string' && value) : [];
  return list.sort((a, b) => b.length - a.length)[0] || '.';
}

function makeAction(label, command, description = '') {
  const normalized = normalizeActionCommand(command);
  if (!normalized) return null;
  return {
    label: String(label || ACTION_LABELS[normalized] || normalized).replace(/\s+/g, ' ').trim().slice(0, 22),
    command: normalized,
    description: String(description || '').replace(/\s+/g, ' ').trim().slice(0, 72)
  };
}

function extractUsageActions(plugin) {
  const usage = String(plugin?.usage || '');
  const match = usage.match(/<([^<>]{1,180})>/);
  if (!match) return [];
  const verbs = [...new Set(match[1].split('|').map(value => value.trim().toLowerCase()).filter(value => SAFE_READ_ACTIONS.has(value)))];
  return verbs.slice(0, 8).map(verb => makeAction(ACTION_LABELS[verb] || verb, `${plugin.name} ${verb}`, `Buka bagian ${verb}`)).filter(Boolean);
}

function explicitActions(plugin) {
  const raw = plugin?.ui?.fullButton?.actions;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 8).map(item => makeAction(item?.label, item?.command, item?.description)).filter(Boolean);
}

function uniqueActions(actions, pluginName, prefix) {
  const seen = new Set();
  return actions.filter(action => {
    const cmd = normalizeActionCommand(action.command);
    const commandHead = normalizeCommand(cmd);
    if (!cmd || (commandHead === normalizeCommand(pluginName) && cmd.split(' ').length === 1) || seen.has(cmd)) return false;
    action.command = cmd;
    seen.add(cmd);
    action.id = `${prefix}${action.command}`.trim();
    return true;
  }).slice(0, 8);
}

function getCandidateActions(plugin, prefix) {
  const name = normalizeCommand(plugin?.name);
  let actions = explicitActions(plugin);
  if (!actions.length) actions = extractUsageActions(plugin);
  const fallback = DEFAULT_ACTIONS[String(plugin?.category || 'general').toLowerCase()] || DEFAULT_ACTIONS.general;
  // Safe read-only subcommands take priority; generic navigation fills only
  // the remaining space. Destructive verbs are never derived from usage text.
  if (actions.length < 2) actions = [...actions, ...fallback];
  return uniqueActions(actions, name, prefix);
}

function classifyBody(text, maxBodyChars) {
  const body = String(text || '').trim();
  if (!body) return { eligible: false, reason: 'empty' };
  if (body.length > maxBodyChars) return { eligible: false, reason: 'body-too-long' };
  if (CODE_OR_DIAGNOSTIC_PATTERN.test(body)) return { eligible: false, reason: 'code-or-diagnostic' };
  if (body.split(/\r?\n/).length > 22) return { eligible: false, reason: 'long-structured-output' };
  if (PROGRESS_PATTERN.test(body)) return { eligible: false, reason: 'progress-message' };
  return { eligible: true, reason: 'adaptive-candidate' };
}

export function buildAdaptiveButtonPlan({ plugin, text, config = {}, prefix = '' } = {}) {
  const ui = config.ui || {};
  const settings = ui.fullButton || {};
  const command = normalizeCommand(plugin?.name);
  const configuredExemptions = new Set((Array.isArray(settings.excludedCommands) ? settings.excludedCommands : []).map(normalizeCommand));
  const hardExemption = HARD_EXEMPTIONS.get(command);

  if (!settings.enabled) return { mode: 'text', eligible: false, reason: 'disabled', command };
  if (hardExemption) return { mode: 'exempt', eligible: false, reason: hardExemption, command };
  if (plugin?.fullButton === false || plugin?.ui?.fullButton === 'exclude' || plugin?.ui?.fullButton?.enabled === false) {
    return { mode: 'exempt', eligible: false, reason: 'plugin-explicit-exemption', command };
  }
  if (configuredExemptions.has(command)) return { mode: 'exempt', eligible: false, reason: 'owner-excluded', command };

  const maxBodyChars = Math.max(300, Math.min(3500, Number(settings.maxBodyChars) || 1800));
  const bodyClass = classifyBody(text, maxBodyChars);
  if (!bodyClass.eligible) return { mode: 'text', eligible: false, reason: bodyClass.reason, command };

  const commandPrefix = getPrefix(config, prefix);
  const actions = getCandidateActions(plugin, commandPrefix);
  if (!actions.length) return { mode: 'text', eligible: false, reason: 'no-safe-actions', command };

  // Keep up to three clear actions visible as direct buttons. Four or more
  // choices move into one native selection list to avoid button crowding.
  const mode = actions.length >= 4 ? 'single_select' : 'quick_reply';
  return {
    mode,
    eligible: true,
    reason: actions.length >= 4 ? 'multiple-safe-actions' : actions.length > 0 ? 'compact-contextual-actions' : 'contextual-navigation',
    command,
    title: `OCHA · ${String(plugin?.name || 'COMMAND').toUpperCase().slice(0, 18)}`,
    body: String(text).trim(),
    actions
  };
}

export function planButtonInventory(plugins = [], config = {}, prefix = '') {
  return plugins.map(plugin => {
    const plan = buildAdaptiveButtonPlan({ plugin, text: 'Command berhasil dijalankan.', config: { ...config, ui: { ...(config.ui || {}), fullButton: { ...(config.ui?.fullButton || {}), enabled: true } } }, prefix });
    return {
      name: plugin.name,
      aliases: Array.isArray(plugin.aliases) ? plugin.aliases : [],
      mode: plan.mode,
      reason: plan.reason,
      actionCount: plan.actions?.length || 0
    };
  });
}

function toNativeButtons(plan) {
  if (plan.mode === 'single_select') {
    return [{
      name: 'single_select',
      buttonParamsJson: JSON.stringify({
        title: 'Pilih Aksi',
        sections: [{
          title: 'Aksi yang tersedia',
          rows: plan.actions.map(action => ({
            title: action.label,
            description: action.description || `Jalankan ${action.id}`,
            id: action.id
          }))
        }]
      })
    }];
  }
  return plan.actions.slice(0, 3).map(action => ({
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({ display_text: action.label, id: action.id })
  }));
}

/**
 * Temporarily adapts a plugin's plain-text m.reply calls while that plugin is
 * running. The original serializer method is restored in all dispatcher paths.
 * Explicit media/quoted/fake replies and command-specific UI are left alone.
 */
export function withCommandButtons(sock, message, context = {}) {
  const config = context.config || {};
  if (!config.ui?.fullButton?.enabled || typeof message?.reply !== 'function' || typeof sock?.sendInteractive !== 'function') {
    return () => {};
  }

  const originalReply = message.reply;
  const plugin = context.plugin;
  const wrappedReply = async function (text, quoted = message, options = {}) {
    if (quoted !== message || (options && Object.keys(options).length > 0) || typeof text !== 'string') {
      return originalReply.call(message, text, quoted, options);
    }

    const plan = buildAdaptiveButtonPlan({ plugin, text, config, prefix: context.prefix });
    if (!plan.eligible) return originalReply.call(message, text, quoted, options);

    try {
      return await sock.sendInteractive(message.chat, {
        title: plan.title,
        body: plan.body,
        footer: 'Ocha Lidya AI · Razzaq Ventures',
        buttons: toNativeButtons(plan),
        messageParamsJson: '{}',
        messageVersion: 1
      }, message);
    } catch {
      // Text is the universal fallback. A transient relay/serialization failure
      // must never turn a successful command into a lost response.
      return originalReply.call(message, text, quoted, options);
    }
  };

  message.reply = wrappedReply;
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    if (message.reply === wrappedReply) message.reply = originalReply;
  };
}

export function getHardButtonExemptions() {
  return Object.fromEntries(HARD_EXEMPTIONS);
}
