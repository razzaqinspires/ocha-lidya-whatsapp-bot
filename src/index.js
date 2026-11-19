import 'dotenv/config';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import makeWASocket, { DisconnectReason, useMultiFileAuthState, Browsers } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { logger, baileysLogger, configureLogger } from './core/logger.js';
import { loadConfig, getConfig } from './core/config.js';
import { loadStore } from './core/store.js';
import { initializeDatabase } from './core/database.js';
import { loadPlugins, watchSourceFiles } from './core/plugin-loader.js';
import { startAutoGitSync } from './core/auto-git-sync.js';
import { dispatch } from './core/dispatcher.js';
import { configureMessageMonitor, observeIncomingMessage, observeOutgoingMessage, observeMessageUpdates, observeGroupReceipts, getMessageMonitorStats } from './core/message-monitor.js';
import serializer from './lib/serializ_simple.js';
const { serialize, extendSocket, trackSentMessageId, setOutgoingMessageObserver } = serializer;
import { isOwner } from './core/identity.js';
import { initializeContacts, addContactFromPnJid } from './core/contacts.js';
import { initializeGroupMetadata } from './core/group-metadata.js';
import { resolveMessageSenderPn } from './core/jid-resolution.js';
import { ensureGroupMetadata, hydrateParticipatingGroupsOnce, handleGroupsUpsert, handleGroupsUpdate, handleGroupParticipantsUpdate } from './core/group-runtime.js';
import { resumePendingAI, initializeAIHistoryCache } from './ai/engine.js';
import { initializeProviderKeys } from './ai/providers.js';
import { getReconnectDelay, isValidInternationalNumber, normalizePhoneNumber, shouldRequestPairingCode, shouldStopReconnect, shouldRecoverInvalidSession } from './core/connection-policy.js';

setOutgoingMessageObserver(observeOutgoingMessage);

await initializeDatabase();
await loadConfig();
await initializeContacts();
await initializeGroupMetadata();
await initializeProviderKeys();
try {
  await initializeAIHistoryCache();
} catch (error) {
  logger.warn({ err: error }, 'AI history cache warm-up deferred');
}
configureLogger(getConfig().logging);
configureMessageMonitor({ color: getConfig().logging.color });
const whatsappConfig = getConfig().whatsapp;
const AUTH_DIR = whatsappConfig.sessionDir;
const AUTH_MODE = whatsappConfig.authMode;
const PAIRING_NUMBER = normalizePhoneNumber(whatsappConfig.pairingNumber || getConfig().bot.expectedNumber || '');
if (AUTH_MODE === 'pairing' && !isValidInternationalNumber(PAIRING_NUMBER)) {
  throw new Error('whatsapp.pairingNumber harus nomor internasional 8-15 digit tanpa +, spasi, atau tanda baca.');
}
await loadStore();
await loadPlugins();
await startAutoGitSync();

let reconnectTimer;
let restartTimer;
let activeSocket;
let reconnectAttempt = 0;
let startInFlight = false;
let restarting = false;
let credsSaveQueue = Promise.resolve();
let invalidSessionRecoveryUsed = false;
const processedIncoming = new Map();

function isDuplicateIncoming(key) {
  const id = key?.id;
  if (!id) return false;
  const identity = `${key.remoteJid || ''}:${id}`;
  const now = Date.now();
  const previous = processedIncoming.get(identity);
  if (previous && now - previous < 10 * 60_000) return true;
  processedIncoming.set(identity, now);
  if (processedIncoming.size > 5000) {
    for (const [storedId, timestamp] of processedIncoming) {
      if (now - timestamp > 10 * 60_000 || processedIncoming.size > 4000) processedIncoming.delete(storedId);
      else break;
    }
  }
  return false;
}

function requestControlledRestart({ file, event }) {
  if (restarting) return;
  restarting = true;
  logger.warn({ file, event }, 'Perubahan source inti terdeteksi; proses akan dimulai ulang secara terkontrol');
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    try { activeSocket?.end?.(new Error(`Source changed: ${file}`)); }
    catch (error) { logger.warn({ err: error }, 'Tidak dapat menutup socket sebelum restart'); }

    const child = spawn(process.execPath, process.argv.slice(1), {
      cwd: process.cwd(), env: process.env, detached: true, stdio: 'inherit'
    });
    child.once('spawn', () => { child.unref(); process.exit(0); });
    child.once('error', error => {
      restarting = false;
      logger.error({ err: error }, 'Gagal menjalankan proses pengganti; proses tetap aktif dan mencoba pulih');
      scheduleReconnect(0);
    });
  }, 900);
  restartTimer.unref();
}

watchSourceFiles({ onRestartRequired: requestControlledRestart });


async function quarantineInvalidSessionAndReconnect() {
  // Finish pending auth writes before moving the directory. The old session is
  // kept as a timestamped backup; it is never recursively deleted.
  await credsSaveQueue;
  const source = path.resolve(AUTH_DIR);
  let backup;
  try {
    await fs.access(source);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backup = `${source}.invalid-${stamp}-${process.pid}`;
    await fs.rename(source, backup);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  logger.warn({ authDir: AUTH_DIR, backup: backup || '(session directory was already absent)' },
    'Sesi tersimpan ditolak WhatsApp (401). Backup dipertahankan; Ocha Lidya akan memulai pairing baru satu kali.');
  scheduleReconnect(0);
}

function scheduleReconnect(code) {
  if (restarting || reconnectTimer) return;
  const delay = getReconnectDelay(reconnectAttempt, code, { restartRequiredCode: DisconnectReason.restartRequired ?? 515 });
  reconnectAttempt += 1;
  logger.warn({ code, attempt: reconnectAttempt, delayMs: delay }, 'Menjadwalkan koneksi ulang WhatsApp');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    start().catch(error => {
      logger.error({ err: error }, 'Koneksi ulang gagal');
      scheduleReconnect(error?.output?.statusCode);
    });
  }, delay);
  reconnectTimer.unref?.();
}

async function start() {
  if (restarting || startInFlight) return;
  startInFlight = true;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const sock = makeWASocket({
      auth: state,
      // Baileys expects a recognized browser name here, not the bot's display name.
      // WhatsApp's phone-number pairing flow accepts canonical values such as Chrome (Ubuntu).
      browser: Browsers.ubuntu(whatsappConfig.browserName),
      logger: baileysLogger,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: whatsappConfig.connectTimeoutMs,
      defaultQueryTimeoutMs: whatsappConfig.queryTimeoutMs,
      keepAliveIntervalMs: whatsappConfig.keepAliveIntervalMs,
      retryRequestDelayMs: 250,
      getMessage: async () => undefined
    });
    activeSocket = sock;
    extendSocket(sock);

    let pairingRequested = false;
    sock.ev.on('creds.update', () => {
      // Serialize credential writes to avoid overlapping writes during reconnect/pairing.
      credsSaveQueue = credsSaveQueue
        .then(() => saveCreds())
        .catch(error => logger.error({ err: error }, 'Gagal menyimpan kredensial WhatsApp'));
    });

    sock.ev.on('connection.update', update => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && AUTH_MODE === 'qr') {
        logger.info('Scan QR WhatsApp Ocha Lidya melalui Perangkat tertaut:');
        qrcode.generate(qr, { small: true });
      }

      // In Baileys the first QR event is emitted after the initial pair-device stanza.
      // Use it as the readiness signal so requestPairingCode is not sent too early.
      if (shouldRequestPairingCode({ authMode: AUTH_MODE, registered: Boolean(state.creds.registered || state.creds.me?.id), qr, pairingRequested })) {
        pairingRequested = true;
        logger.debug('Baileys pairing readiness signal received; requesting phone-number code');
        void sock.requestPairingCode(PAIRING_NUMBER)
          .then(code => {
            logger.info({ phone: `${PAIRING_NUMBER.slice(0, 3)}••••${PAIRING_NUMBER.slice(-3)}` }, 'Kode pairing Ocha Lidya siap');
            process.stdout.write(`\n\n OCHA LIDYA PAIRING CODE: ${code}\n`);
            process.stdout.write('Buka WhatsApp > Perangkat tertaut > Tautkan perangkat > Tautkan dengan nomor telepon.\n\n');
          })
          .catch(error => {
            pairingRequested = false;
            logger.error({ err: error }, 'Gagal meminta kode pairing WhatsApp');
            // Do not spin on the same socket; a fresh socket is required for another attempt.
            if (activeSocket === sock) activeSocket = undefined;
            try { sock.end?.(error); } catch {}
            scheduleReconnect(0);
          });
      }

      if (connection === 'open') {
        reconnectAttempt = 0;
        const actual = sock.user?.id?.split(':')[0]?.split('@')[0];
        logger.info({ bot: actual, expected: getConfig().bot.expectedNumber, groupMute: getConfig().features.groupsMuted ? 'ON' : 'OFF', messageMonitor: getMessageMonitorStats() }, 'Ocha Lidya connected');
        void resumePendingAI(sock).catch(error => logger.error({ err: error }, 'AI checkpoint recovery failed'));
        void hydrateParticipatingGroupsOnce(sock).catch(error => logger.warn({ err: error }, 'Group cache bootstrap failed'));
        if (actual && actual !== getConfig().bot.expectedNumber) {
          logger.warn('Nomor bot aktual berbeda dari EXPECTED_BOT_NUMBER. Periksa akun yang dipasangkan.');
        }
      }

      if (connection === 'close') {
        if (activeSocket !== sock || restarting) return;
        activeSocket = undefined;
        const code = lastDisconnect?.error?.output?.statusCode;
        logger.warn({ code, error: lastDisconnect?.error?.message }, 'Koneksi WhatsApp terputus');

        const registeredSession = Boolean(state.creds.registered || state.creds.me?.id);
        if (shouldRecoverInvalidSession({
          code,
          authMode: AUTH_MODE,
          recoverEnabled: whatsappConfig.recoverInvalidSession,
          registered: registeredSession,
          recoveryUsed: invalidSessionRecoveryUsed
        })) {
          invalidSessionRecoveryUsed = true;
          void quarantineInvalidSessionAndReconnect().catch(error => {
            logger.error({ err: error, authDir: AUTH_DIR }, 'Pemulihan sesi gagal; sesi lama tetap dipertahankan');
          });
          return;
        }

        if (shouldStopReconnect(code, { loggedOutCode: DisconnectReason.loggedOut ?? 401, badSessionCode: DisconnectReason.badSession ?? 500 })) {
          logger.error({ authDir: AUTH_DIR, registered: registeredSession }, 'Sesi WhatsApp ditolak atau sudah logout. Tidak ada retry otomatis untuk mencegah loop login.');
          return;
        }
        // 515 is expected after a successful QR/pairing handshake; reconnect immediately.
        scheduleReconnect(code);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const raw of messages) {
        if (!raw.message || raw.key.remoteJid === 'status@broadcast' || isDuplicateIncoming(raw.key)) continue;
        try {
          const isGroup = raw.key.remoteJid?.endsWith('@g.us') || false;
          const senderPn = await resolveMessageSenderPn(sock, raw.key, isGroup);
          const message = serialize(sock, raw);
          if (senderPn) {
            message.sender = senderPn;
            message.senderPn = senderPn;
          }
          message.isOwner = isOwner([senderPn, message.sender], getConfig().bot.owner);
          observeIncomingMessage(message);
          if (message.fromMe && !message.isOwner) continue;
          if (!message.fromMe && senderPn) await addContactFromPnJid(senderPn);
          if (message.isGroup) await ensureGroupMetadata(sock, message.chat);
          await dispatch(sock, message);
        } catch (error) {
          logger.error({ err: error }, 'Message pipeline failed');
        }
      }
    });

    sock.ev.on('groups.upsert', payload => {
      void handleGroupsUpsert(sock, payload).catch(error => logger.error({ err: error }, 'Group upsert cache failed'));
    });
    sock.ev.on('groups.update', payload => {
      void handleGroupsUpdate(sock, payload).catch(error => logger.error({ err: error }, 'Group metadata event cache failed'));
    });
    sock.ev.on('group-participants.update', update => {
      void handleGroupParticipantsUpdate(sock, update).catch(error => logger.error({ err: error, groupId: update?.id }, 'Group participant cache update failed'));
    });

    sock.ev.on('messages.update', updates => {
      for (const update of updates) if (update.key?.id) trackSentMessageId(update.key.id);
      observeMessageUpdates(updates);
    });
    sock.ev.on('message-receipt.update', updates => {
      observeGroupReceipts(updates);
    });
  } finally {
    startInFlight = false;
  }
}

process.on('unhandledRejection', error => logger.error({ err: error }, 'Unhandled rejection'));
process.on('uncaughtException', error => {
  logger.fatal({ err: error }, 'Uncaught exception');
  process.exit(1);
});

start().catch(error => {
  logger.fatal({ err: error }, 'Startup failed');
  process.exitCode = 1;
  scheduleReconnect(error?.output?.statusCode);
});
