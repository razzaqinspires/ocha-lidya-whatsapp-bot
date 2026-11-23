import { parseCommand } from './prefix.js';
import { getPlugin } from './plugin-loader.js';
import { runMasterCommand, isMasterSyntax } from '../master/dispatcher.js';
import { getConfig } from './config.js';
import { getPrefixes } from './prefix.js';
import { shouldSuppressGroupInteraction, isOwnerMuteControlMessage } from './group-policy.js';
import { answerMessage, isAITrigger } from '../ai/engine.js';
import { dispatchReplySession } from './reply-sessions.js';
import { isVerifiedOwnerMessage } from './identity.js';
import { isUserTemporarilyBanned } from './command-governor.js';
import { BILLING_EXEMPT_COMMANDS } from '../rental/catalog.js';
import { getTenantStatus, consumeTenantQuota } from '../rental/service.js';
import { executeRegisteredPlugin } from './plugin-execution.js';
import { getTicTacToeSession } from '../games/tictactoe.js';

const rentalNoticeAt = new Map();
function notifyRentalBlockOnce(key, now = Date.now()) {
  const until = rentalNoticeAt.get(key) || 0;
  if (until > now) return false;
  rentalNoticeAt.set(key, now + 60_000);
  if (rentalNoticeAt.size > 10_000) for (const [entry, expiry] of rentalNoticeAt) if (expiry <= now) rentalNoticeAt.delete(entry);
  return true;
}
function shortCountdown(ms) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return hours ? `${hours} jam ${minutes} menit` : `${Math.max(1, minutes)} menit`;
}

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
  const rentalPublicControl = Boolean(parsed && ['sewa', 'rent', 'paketsewa'].includes(String(parsed.command).toLowerCase()));
  const isOwnerMuteControl = isOwnerMuteControlMessage(message, ownerVerified);

  // Rental entitlement is enforced independently from mute overrides, so a
  // global unmute can never accidentally reactivate an expired tenant.
  if (message.isGroup && !ownerVerified && !rentalPublicControl && !isOwnerMuteControl) {
    const rentalStatus = await getTenantStatus(message.chat);
    if (rentalStatus.tenant && rentalStatus.status !== 'active') {
      const noticeKey = `${message.chat}:subscription:${rentalStatus.status}`;
      if (notifyRentalBlockOnce(noticeKey)) {
        const notice = rentalStatus.status === 'grace'
          ? `Masa aktif sewa grup berakhir. Masa tenggang ${shortCountdown(rentalStatus.graceRemainingMs)} masih tersedia untuk perpanjangan. Ketik .sewa.`
          : rentalStatus.status === 'over-limit'
            ? `Jumlah anggota grup (${rentalStatus.memberCount}) melebihi batas paket (${rentalStatus.memberLimit}). Kurangi anggota atau hubungi admin untuk meningkatkan paket. Ketik .sewa.`
            : 'Sewa grup sudah tidak aktif. Gunakan .sewa untuk membuat invoice perpanjangan.';
        await message.reply(notice);
      }
      return;
    }
  }

  // Muted groups allow only the verified owner mute control and tenant billing
  // commands. Other commands and AI triggers remain muted.
  if (shouldSuppressGroupInteraction(message, config) && !isOwnerMuteControl && !rentalPublicControl) return;

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
    return executeRegisteredPlugin({
      sock, message, plugin,
      parsed: { ...parsed, command: plugin.name, args: parsed.args, text: parsed.text },
      config, source: 'dispatcher'
    });
  }

  // Stateful game routing runs before the LLM. Natural-language game starts and
  // numeric moves are resolved only against the caller's private persisted session.
  if (!message.isGroup && !hasPrefix) {
    const gameText = body.toLowerCase();
    const startsTicTacToe = /(?:main|bermain|ayo|yuk|aj[a]?k).{0,35}(?:tic[\s-]?tac[\s-]?toe|tictactoe|permainan\s+xo)|(?:tic[\s-]?tac[\s-]?toe|tictactoe).{0,35}(?:main|bermain|yuk|mulai)/i.test(gameText);
    const playerId = String(message.sender || message.key?.participant || '').replace(/:\d+(?=@)/, '');
    let activeGame = null;
    if (playerId) {
      try { activeGame = await getTicTacToeSession(playerId); } catch (error) {
        // A vault integrity/decryption error must fail closed; do not fall back to LLM simulation.
        if (error.code?.startsWith('OCHA_VAULT_')) return;
        throw error;
      }
    }
    const isMove = activeGame?.status === 'playing' && /^[1-9]$/.test(gameText);
    const isGameControl = activeGame?.status === 'playing' && /^(?:status|papan|menyerah|stop|berhenti|ulang|reset)$/i.test(gameText);
    if (startsTicTacToe || isMove || isGameControl) {
      const gamePlugin = getPlugin('tictactoe');
      if (gamePlugin) {
        const args = startsTicTacToe ? ['mulai'] : [gameText];
        return executeRegisteredPlugin({ sock, message, plugin: gamePlugin, parsed: { command: gamePlugin.name, args, text: args.join(' '), prefix: '' }, config, source: 'natural-game-intent' });
      }
    }
  }

  // A prefixed message is always command intent. Unknown commands must never fall through to AI.
  if (hasPrefix) return;
  // In prefix mode "none", parseCommand treats all text as a command; unknown natural language falls through to AI.
  if (isAITrigger(sock, message, { prefixed: false, hasKnownCommand: false })) {
    if (message.isGroup && !ownerVerified) {
      const quota = await consumeTenantQuota({ groupJid: message.chat, command: 'ai', plugin: { name: 'ai', description: 'AI conversation response' } });
      if (quota.applies && !quota.allowed) {
        const noticeKey = `${message.chat}:${quota.reason}:${quota.resetAt || quota.tenant?.expiresAt || ''}`;
        if (notifyRentalBlockOnce(noticeKey)) {
          if (quota.reason === 'quota') await message.reply(`Kuota penggunaan grup habis (${quota.used}/${quota.limit} unit). Reset dalam ${shortCountdown(quota.remainingMs)}. Status: .sewa status`);
          else await message.reply('Langganan grup tidak aktif untuk sementara. Gunakan .sewa untuk memperpanjang layanan.');
        }
        return;
      }
    }
    await answerMessage(sock, message);
  }
}
