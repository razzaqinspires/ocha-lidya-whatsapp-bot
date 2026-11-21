import { parseCommand } from './prefix.js';
import { getPlugin } from './plugin-loader.js';
import { authorize } from './permissions.js';
import { runMasterCommand, isMasterSyntax } from '../master/dispatcher.js';
import { getConfig } from './config.js';
import { logger } from './logger.js';
import { getPrefixes } from './prefix.js';
import { shouldSuppressGroupInteraction, isOwnerMuteControlMessage } from './group-policy.js';
import { answerMessage, isAITrigger } from '../ai/engine.js';
import { dispatchReplySession } from './reply-sessions.js';
import { isVerifiedOwnerMessage } from './identity.js';
import { evaluateCooldown, shouldNotifyCooldown, inspectAntiSpam, isUserTemporarilyBanned, formatDuration } from './command-governor.js';

export async function dispatch(sock, message) {
  const config = getConfig();
  const ownerVerified = isVerifiedOwnerMessage(message, config.bot.owner);
  message.isOwner = ownerVerified;
  if (message.fromMe && !ownerVerified) return;
  const body = String(message.body || '').trim();
  const guardConfig = config.commandGuard || {};
  if (!ownerVerified && guardConfig.antiSpam?.enabled) {
    const sanction = await isUserTemporarilyBanned(message.sender);
    if (sanction.banned) return;
  }
  const parsed = parseCommand(body);
  const isOwnerMuteControl = isOwnerMuteControlMessage(message, ownerVerified);

  // Muted groups have one narrow control-channel exception: verified owner
  // may issue .mute on/off/status in that same group. No other command, AI
  // trigger, or non-owner message is allowed through the gate.
  if (shouldSuppressGroupInteraction(message, config) && !isOwnerMuteControl) return;

  // Priority lane 1: replies to an active command screen (e.g. `.groupinfo`
  // followed by `1`). It must consume the message before command parsing or AI.
  const sessionResult = await dispatchReplySession(sock, message);
  if (sessionResult.matched) return;

  if (!body) return;
  if (isMasterSyntax(body)) {
    if (!ownerVerified) return;
    if (message.isGroup && !config.security.allowMasterInGroups) return message.reply('Master console dinonaktifkan di grup.');
    return runMasterCommand(sock, message, body);
  }
  const prefixes = getPrefixes();
  const hasPrefix = prefixes.some(prefix => body.startsWith(prefix));
  const plugin = parsed ? getPlugin(parsed.command) : null;

  if (plugin) {
    const auth = authorize(message, plugin);
    if (!auth.ok) {
      // Mute control is intentionally silent for non-owners, including in
      // active groups, so ordinary members cannot probe owner-only controls.
      if (['mute', 'groupmute'].includes(plugin.name) && auth.reason === 'owner') return;
      if (auth.reason === 'group') return message.reply('Perintah ini hanya dapat digunakan di dalam grup.');
      if (auth.reason === 'private') return message.reply('Perintah ini hanya dapat digunakan di chat pribadi.');
      if (auth.reason === 'owner') return message.reply('Perintah ini khusus owner.');
      if (auth.reason === 'self') return message.reply('Bot sedang dalam mode self.');
      return;
    }
    const guardConfig = config.commandGuard || {};
    const isGuardControl = ['guard', 'commandguard', 'antispam'].includes(String(parsed.command || '').toLowerCase());
    if (!auth.owner && guardConfig.antiSpam?.enabled) {
      const spam = await inspectAntiSpam({ sender: message.sender, command: parsed.command });
      if (!spam.allowed) {
        if (spam.banned) {
          if (spam.durationMs) await message.reply(`Akses command ditangguhkan sementara selama ${formatDuration(spam.durationMs)} karena pelanggaran anti-spam berulang. Bot dapat digunakan kembali setelah masa penangguhan berakhir.`);
          return;
        }
        if (spam.initialWarning) return message.reply('Peringatan: pola command terlalu cepat/berulang. Kurangi frekuensi penggunaan. Pelanggaran berikutnya akan tercatat dalam limit anti-spam harian.');
        if (spam.warnings) return message.reply(`Peringatan anti-spam ${spam.warnings}/5. Jika mencapai 5 peringatan dalam sehari, akses command akan ditangguhkan sementara.`);
        return;
      }
    }
    if (guardConfig.cooldown?.enabled && !isGuardControl) {
      const cooldown = evaluateCooldown({ sender: message.sender, chat: message.chat, command: plugin.name, plugin });
      if (!cooldown.allowed) {
        if (shouldNotifyCooldown({ sender: message.sender, chat: message.chat, command: plugin.name, cooldownMs: cooldown.remainingMs })) {
          return message.reply(`Command ini masih dalam cooldown. Coba lagi sekitar ${formatDuration(cooldown.remainingMs)}.`);
        }
        return;
      }
    }
    try {
      await plugin.execute({ sock, m:message, args:parsed.args, text:parsed.text, command:parsed.command, config, isOwner:auth.owner });
    } catch (error) {
      logger.error({err:error,plugin:plugin.name,chat:message.chat}, 'Plugin execution error');
      await message.reply(`Terjadi kesalahan saat menjalankan ${plugin.name}.\n${error.message || error}`);
    }
    return;
  }

  // A prefixed message is always command intent. Unknown commands must never fall through to AI.
  if (hasPrefix) return;
  // In prefix mode "none", parseCommand treats all text as a command; unknown natural language falls through to AI.
  if (isAITrigger(sock, message, { prefixed: false, hasKnownCommand: false })) {
    await answerMessage(sock, message);
  }
}
