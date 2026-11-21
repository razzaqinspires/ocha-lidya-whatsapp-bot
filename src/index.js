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
import { isVerifiedOwnerMessage } from './core/identity.js';
import { initializeContacts, addContactFromPnJid } from './core/contacts.js';
import { initializeGroupMetadata } from './core/group-metadata.js';
import { resolveMessageSenderPn } from './core/jid-resolution.js';
import { ensureGroupMetadata, hydrateParticipatingGroupsOnce, handleGroupsUpsert, handleGroupsUpdate, handleGroupParticipantsUpdate } from './core/group-runtime.js';
import { resumePendingAI, initializeAIHistoryCache } from './ai/engine.js';
import { initializeUserProfiles } from './ai/user-profiles.js';
import { initializeProviderKeys } from './ai/providers.js';
import { startModelCatalogScheduler, stopModelCatalogScheduler } from './ai/model-catalog.js';
import { ensureModelCatalogWorkerStarted } from './ai/model-catalog-worker-manager.js';
import { getReconnectDelay, isValidInternationalNumber, normalizePhoneNumber, shouldRequestPairingCode, shouldStopReconnect, shouldRecoverInvalidSession } from './core/connection-policy.js';
import { startCodeLab, stopCodeLab } from './runtime/code-lab.js';
import { runNexoraBootstrap } from './runtime/bootstrap-agent.js';

setOutgoingMessageObserver(observeOutgoingMessage);

await initializeDatabase();
await loadConfig();
try {
  await runNexoraBootstrap(getConfig().codeLab);
} catch (error) {
  logger.warn({ message: error.message }, 'Nexora dependency bootstrap incomplete; bot will continue and Code Lab will report unavailable capabilities');
}
await initializeContacts();
await initializeGroupMetadata();
await initializeProviderKeys();
try {
  const catalog = await startModelCatalogScheduler({ refreshAtStartup: true });
  logger.info({ active: catalog.active, mode: catalog.mode, checkedAt: catalog.checkedAt, nextRunAt: catalog.nextRunAt, intervalHours: catalog.intervalHours }, 'In-process autonomous AI model catalog scheduler active');
} catch (error) {
  logger.warn({ err: error }, 'In-process AI model catalog scheduler could not initialize; it will retry on the next process start');
}
try {
  const worker = ensureModelCatalogWorkerStarted();
  logger.info({ active: worker.active, workerStarted: worker.started, workerPid: worker.pid, logFile: worker.logFile || null }, 'Detached AI model catalog worker ensured');
} catch (error) {
  logger.warn({ err: error }, 'Detached AI model catalog worker could not start; in-process scheduler remains active');
}
try {
  await initializeAIHistoryCache();
  await initializeUserProfiles();
} catch (error) {
  logger.warn({ err: error }, 'AI history cache warm-up deferred');
}
configureLogger(getConfig().logging);
configureMessageMonitor({ color: getConfig().logging.color });
try {
  const codeLabStatus = await startCodeLab();
  if (codeLabStatus.enabled) logger.info({ gateway: codeLabStatus.gateway, maxConcurrent: codeLabStatus.maxConcurrent }, 'Nexora Code Lab initialized');
} catch (error) {
  logger.error({ message: error.message }, 'Nexora Code Lab initialization failed; WhatsApp bot continues without code preview');
}
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
let socketGeneration = 0;
let reconnectAttempt = 0;
let startInFlight = false;
let restarting = false;
let shutdownInProgress = false;
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
  if (restarting || shutdownInProgress) return;
  restarting = true;
  logger.warn({ pid: process.pid, file, event }, 'Perubahan source inti terdeteksi; proses akan dimulai ulang secara terkontrol');
  clearTimeout(restartTimer);
  restartTimer = setTimeout(async () => {
    try { await stopCodeLab(); }
    catch (error) { logger.warn({ message: error.message }, 'Code Lab cleanup before restart failed'); }
    const socketToClose = activeSocket;
    activeSocket = undefined;
    try { socketToClose?.end?.(new Error(`Source changed: ${file}`)); }
    catch (error) { logger.warn({ err: error }, 'Tidak dapat menutup socket sebelum restart'); }

    const child = spawn(process.execPath, process.argv.slice(1), {
      cwd: process.cwd(), env: process.env, detached: true, stdio: 'inherit'
    });
    child.once('spawn', () => {
      logger.warn({ oldPid: process.pid, replacementPid: child.pid, file }, 'Proses pengganti berhasil dibuat oleh source watcher; proses lama akan keluar');
      child.unref();
      process.exit(0);
    });
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
  if (restarting || shutdownInProgress || activeSocket) return;
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
  // A reconnect is permitted only after the previous socket has been detached.
  // This also blocks late callbacks from a retired socket from creating a second one.
  if (restarting || shutdownInProgress || activeSocket || reconnectTimer) return;
  const delay = getReconnectDelay(reconnectAttempt, code, { restartRequiredCode: DisconnectReason.restartRequired ?? 515 });
  reconnectAttempt += 1;
  logger.warn({ code, attempt: reconnectAttempt, delayMs: delay }, 'Menjadwalkan koneksi ulang WhatsApp');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    if (restarting || shutdownInProgress || activeSocket) return;
    start().catch(error => {
      logger.error({ err: error }, 'Koneksi ulang gagal');
      scheduleReconnect(error?.output?.statusCode);
    });
  }, delay);
  reconnectTimer.unref?.();
}

async function start() {
  if (restarting || shutdownInProgress || startInFlight || activeSocket) return;
  startInFlight = true;
  let sock;
  try {
    // A 515 restart can arrive just after creds.update. Never load auth state
    // while a preceding saveCreds() write is still pending.
    await credsSaveQueue;
    if (restarting || shutdownInProgress || activeSocket) return;
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    if (restarting || shutdownInProgress || activeSocket) return;
    sock = makeWASocket({
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
    extendSocket(sock);
    if (restarting || shutdownInProgress) {
      try { sock.end?.(new Error('Runtime is shutting down or restarting')); } catch {}
      return;
    }
    activeSocket = sock;
    const generation = ++socketGeneration;
    logger.info({ pid: process.pid, generation }, 'WhatsApp socket dibuat dalam proses yang sedang berjalan');

    let pairingRequested = false;
    sock.ev.on('creds.update', () => {
      // Serialize credential writes to avoid overlapping writes during reconnect/pairing.
      credsSaveQueue = credsSaveQueue
        .then(() => saveCreds())
        .catch(error => logger.error({ err: error }, 'Gagal menyimpan kredensial WhatsApp'));
    });

    sock.ev.on('connection.update', update => {
      if (activeSocket !== sock) {
        logger.debug({ pid: process.pid, generation }, 'Mengabaikan update dari socket WhatsApp yang sudah tidak aktif');
        return;
      }
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
            if (activeSocket !== sock || restarting || shutdownInProgress) {
              logger.debug('Mengabaikan respons kode pairing dari socket yang sudah tidak aktif');
              return;
            }
            logger.info({ phone: `${PAIRING_NUMBER.slice(0, 3)}••••${PAIRING_NUMBER.slice(-3)}` }, 'Kode pairing Ocha Lidya siap');
            process.stdout.write(`\n\n OCHA LIDYA PAIRING CODE: ${code}\n`);
            process.stdout.write('Buka WhatsApp > Perangkat tertaut > Tautkan perangkat > Tautkan dengan nomor telepon.\n\n');
          })
          .catch(error => {
            // The same socket may already have closed and a replacement may be
            // connecting. A late rejection from this old request must be inert.
            if (activeSocket !== sock || restarting || shutdownInProgress) {
              logger.debug('Mengabaikan kegagalan pairing dari socket yang sudah tidak aktif');
              return;
            }
            pairingRequested = false;
            logger.error({ err: error }, 'Gagal meminta kode pairing WhatsApp');
            activeSocket = undefined;
            try { sock.end?.(error); } catch {}
            scheduleReconnect(0);
          });
      }

      if (connection === 'open') {
        if (activeSocket !== sock || restarting || shutdownInProgress) return;
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
        reconnectAttempt = 0;
        const actual = sock.user?.id?.split(':')[0]?.split('@')[0];
        logger.info({ pid: process.pid, generation, bot: actual, expected: getConfig().bot.expectedNumber, groupMute: getConfig().features.groupsMuted ? 'ON' : 'OFF', messageMonitor: getMessageMonitorStats() }, 'Ocha Lidya connected');
        void resumePendingAI(sock).catch(error => logger.error({ err: error }, 'AI checkpoint recovery failed'));
        void hydrateParticipatingGroupsOnce(sock).catch(error => logger.warn({ err: error }, 'Group cache bootstrap failed'));
        if (actual && actual !== getConfig().bot.expectedNumber) {
          logger.warn('Nomor bot aktual berbeda dari EXPECTED_BOT_NUMBER. Periksa akun yang dipasangkan.');
        }
      }

      if (connection === 'close') {
        activeSocket = undefined;
        if (restarting || shutdownInProgress) return;
        const code = lastDisconnect?.error?.output?.statusCode;
        logger.warn({ pid: process.pid, generation, code, error: lastDisconnect?.error?.message }, 'Koneksi WhatsApp terputus');

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

        if (shouldStopReconnect(code, {
          loggedOutCode: DisconnectReason.loggedOut ?? 401,
          forbiddenCode: DisconnectReason.forbidden ?? 403,
          multideviceMismatchCode: DisconnectReason.multideviceMismatch ?? 411,
          connectionReplacedCode: DisconnectReason.connectionReplaced ?? 440,
          badSessionCode: DisconnectReason.badSession ?? 500
        })) {
          const message = Number(code) === Number(DisconnectReason.connectionReplaced ?? 440)
            ? 'Sesi WhatsApp digantikan koneksi lain (440). Reconnect otomatis dihentikan agar dua instance tidak saling merebut sesi; periksa proses bot lain.'
            : 'Sesi WhatsApp ditolak atau memerlukan tindakan pengguna. Reconnect otomatis dihentikan untuk mencegah loop login.';
          logger.error({ code, authDir: AUTH_DIR, registered: registeredSession }, message);
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
          const senderPn = await resolveMessageSenderPn(sock, raw.key, isGroup, { ownerNumber: getConfig().bot.owner });
          const message = serialize(sock, raw);
          if (senderPn) {
            message.sender = senderPn;
            message.senderPn = senderPn;
          }
          message.isOwner = isVerifiedOwnerMessage({ ...message, senderPn }, getConfig().bot.owner);
          logger.debug({
            messageId: message.id,
            ownerVerified: message.isOwner,
            senderPnResolved: Boolean(senderPn),
            senderIsLid: String(raw.key.participant || raw.key.remoteJid || '').endsWith('@lid'),
            isGroup: message.isGroup,
            fromMe: Boolean(message.fromMe)
          }, 'Incoming sender identity verified from WhatsApp metadata');
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
  } catch (error) {
    if (activeSocket === sock) activeSocket = undefined;
    try { sock?.end?.(error); } catch {}
    throw error;
  } finally {
    startInFlight = false;
  }
}

async function shutdownRuntime(signal, exitCode = 0) {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  logger.warn({ signal }, 'Shutting down Ocha runtime and temporary Code Lab sessions');
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  clearTimeout(restartTimer);
  const socketToClose = activeSocket;
  activeSocket = undefined;
  try { socketToClose?.end?.(new Error(`Process shutdown: ${signal}`)); } catch {}
  stopModelCatalogScheduler();
  try { await stopCodeLab(); }
  catch (error) { logger.error({ message: error.message }, 'Code Lab shutdown cleanup failed'); }
  process.exit(exitCode);
}

process.once('SIGINT', () => { void shutdownRuntime('SIGINT', 0); });
process.once('SIGTERM', () => { void shutdownRuntime('SIGTERM', 0); });
process.once('SIGHUP', () => { void shutdownRuntime('SIGHUP', 0); });
process.on('unhandledRejection', error => logger.error({ err: error }, 'Unhandled rejection'));
process.on('uncaughtException', error => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdownRuntime('uncaughtException', 1);
});

start().catch(error => {
  logger.fatal({ err: error }, 'Startup failed');
  process.exitCode = 1;
  scheduleReconnect(error?.output?.statusCode);
});
