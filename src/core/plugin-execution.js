import { authorize } from './permissions.js';
import { getConfig } from './config.js';
import { logger } from './logger.js';
import { isVerifiedOwnerMessage } from './identity.js';
import { evaluateCooldown, shouldNotifyCooldown, inspectAntiSpam, isUserTemporarilyBanned, formatDuration } from './command-governor.js';
import { BILLING_EXEMPT_COMMANDS } from '../rental/catalog.js';
import { consumeTenantQuota } from '../rental/service.js';
import { withCommandButtons } from './ui.js';
import { isTenantCommandAllowed } from '../rental/command-access.js';

const rentalNoticeAt = new Map();
function notifyRentalBlockOnce(key, now = Date.now()) {
  const until = rentalNoticeAt.get(key) || 0;
  if (until > now) return false;
  rentalNoticeAt.set(key, now + 60_000);
  if (rentalNoticeAt.size > 10_000) {
    for (const [entry, expiry] of rentalNoticeAt) if (expiry <= now) rentalNoticeAt.delete(entry);
  }
  return true;
}
function shortCountdown(ms) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return hours ? `${hours} jam ${minutes} menit` : `${Math.max(1, minutes)} menit`;
}

async function deny(message, reason, plugin) {
  if (reason === 'mute' && ['mute', 'groupmute'].includes(plugin.name)) return { handled: true, allowed: false, reason };
  const copy = {
    group: 'Perintah ini hanya dapat digunakan di dalam grup.',
    private: 'Perintah ini hanya dapat digunakan di chat pribadi.',
    owner: 'Perintah ini khusus owner.',
    self: 'Bot sedang dalam mode self.'
  }[reason];
  if (copy) await message.reply(copy);
  return { handled: true, allowed: false, reason };
}

/** Resolve the spelling that invoked the plugin without weakening canonical policy checks. */
export function resolvePluginExecutionCommand(plugin, parsed = {}) {
  if (plugin?.preserveAlias) {
    return String(parsed?.matchedCommand || parsed?.command || plugin.name || '').toLowerCase();
  }
  return String(parsed?.command || plugin?.name || '').toLowerCase();
}

/** Shared policy gate for direct commands and explicit AI-requested commands. */
export async function executeRegisteredPlugin({ sock, message, plugin, parsed, config = getConfig(), source = 'dispatcher' } = {}) {
  if (!plugin || typeof plugin.execute !== 'function') return { handled: false, reason: 'plugin_missing' };
  const command = String(parsed?.command || plugin.name || '').toLowerCase();
  const executionCommand = resolvePluginExecutionCommand(plugin, parsed);
  const ownerVerified = isVerifiedOwnerMessage(message, config.bot.owner);
  message.isOwner = ownerVerified;

  const guardConfig = config.commandGuard || {};
  if (!ownerVerified && guardConfig.antiSpam?.enabled) {
    const sanction = await isUserTemporarilyBanned(message.sender);
    if (sanction.banned) return { handled: true, allowed: false, reason: 'temporary_ban' };
  }

  const auth = authorize(message, plugin);
  if (!auth.ok) return deny(message, auth.reason, plugin);
  if (String(plugin.name || '').toLowerCase() === 'master' && message.isGroup && !config.security?.allowMasterInGroups) {
    await message.reply('Master console dinonaktifkan di grup. Aktifkan dari DM owner dengan .master group on.');
    return { handled: true, allowed: false, reason: 'master_group_disabled' };
  }

  if (message.isGroup && !ownerVerified) {
    const access = await isTenantCommandAllowed(message.chat, plugin.name);
    if (!access.allowed) {
      await message.reply(access.policy.mode === 'allowlist'
        ? `Command .${plugin.name} belum diaktifkan oleh admin grup.`
        : `Command .${plugin.name} dinonaktifkan oleh admin grup.`);
      return { handled: true, allowed: false, reason: 'tenant_command_policy' };
    }
  }

  if (message.isGroup && !auth.owner && !BILLING_EXEMPT_COMMANDS.has(String(plugin.name || '').toLowerCase())) {
    const quota = await consumeTenantQuota({ groupJid: message.chat, command: plugin.name, plugin });
    if (quota.applies && !quota.allowed) {
      const noticeKey = `${message.chat}:${quota.reason}:${quota.resetAt || quota.tenant?.expiresAt || ''}`;
      if (notifyRentalBlockOnce(noticeKey)) {
        if (quota.reason === 'quota') {
          await message.reply(`Kuota harian grup telah habis (${quota.used}/${quota.limit} unit). Reset dalam ${shortCountdown(quota.remainingMs)}. Semua command tersedia kembali setelah kuota 24 jam diperbarui. Periksa .sewa status atau perpanjang melalui .sewa.`);
        } else if (quota.reason === 'grace') {
          await message.reply(`Masa aktif sewa grup telah berakhir. Masa tenggang masih tersisa ${shortCountdown(quota.graceRemainingMs)}. Selama masa tenggang, command berbayar ditangguhkan; perpanjang melalui .sewa.`);
        } else {
          await message.reply('Langganan grup sedang tidak aktif. Gunakan .sewa untuk membuat atau memperpanjang invoice.');
        }
      }
      return { handled: true, allowed: false, reason: quota.reason };
    }
  }

  const isGuardControl = ['guard', 'commandguard', 'antispam'].includes(String(parsed?.command || '').toLowerCase());
  if (!auth.owner && guardConfig.antiSpam?.enabled) {
    const spam = await inspectAntiSpam({ sender: message.sender, command });
    if (!spam.allowed) {
      if (spam.banned) {
        if (spam.durationMs) await message.reply(`Akses command ditangguhkan sementara selama ${formatDuration(spam.durationMs)} karena pelanggaran anti-spam berulang. Bot dapat digunakan kembali setelah masa penangguhan berakhir.`);
        return { handled: true, allowed: false, reason: 'anti_spam_ban' };
      }
      if (spam.initialWarning) await message.reply('Peringatan: pola command terlalu cepat/berulang. Kurangi frekuensi penggunaan. Pelanggaran berikutnya akan tercatat dalam limit anti-spam harian.');
      else if (spam.warnings) await message.reply(`Peringatan anti-spam ${spam.warnings}/5. Jika mencapai 5 peringatan dalam sehari, akses command akan ditangguhkan sementara.`);
      return { handled: true, allowed: false, reason: 'anti_spam' };
    }
  }

  if (guardConfig.cooldown?.enabled && !isGuardControl) {
    const cooldown = evaluateCooldown({ sender: message.sender, chat: message.chat, command, plugin });
    if (!cooldown.allowed) {
      if (shouldNotifyCooldown({ sender: message.sender, chat: message.chat, command, cooldownMs: cooldown.remainingMs })) {
        await message.reply(`Command ini masih dalam cooldown. Coba lagi sekitar ${formatDuration(cooldown.remainingMs)}.`);
      }
      return { handled: true, allowed: false, reason: 'cooldown', remainingMs: cooldown.remainingMs };
    }
  }

  const restoreCommandButtons = withCommandButtons(sock, message, {
    plugin,
    command,
    args: parsed?.args || [],
    prefix: parsed?.prefix || '',
    config
  });
  try {
    const result = await plugin.execute({
      sock, m: message, args: parsed?.args || [], text: parsed?.text || '', command: executionCommand,
      config, isOwner: auth.owner
    });
    return { handled: true, allowed: true, result, source };
  } catch (error) {
    logger.error({ err: error, plugin: plugin.name, chat: message.chat, source }, 'Plugin execution error');
    await message.reply(`Terjadi kesalahan saat menjalankan ${plugin.name}.\n${String(error.message || error).slice(0, 1200)}`);
    return { handled: true, allowed: false, reason: 'plugin_error', error };
  } finally {
    try { restoreCommandButtons(); } catch (error) {
      logger.warn({ err: error, plugin: plugin.name }, 'Command-button adapter restore failed');
    }
  }
}
