/**
 * Ocha Lidya public configuration facade.
 * Non-secret settings are persisted in the JSONL event database.
 * Secrets belong in .env and must never be written to this database.
 */
import { initializeDatabase, appendRecord, getRecords, getLatestConfigRecord, configureDatabase } from './core/database.js';

const DEFAULTS = Object.freeze({
  schemaVersion: 6,
  bot: { name: 'Ocha Lidya', aliases: ['Ocha', 'Lidya'], owner: '6283193905842', expectedNumber: '6282177461231' },
  whatsapp: { authMode: 'pairing', pairingNumber: '6282177461231', browserName: 'Chrome', sessionDir: 'sessions/ocha-lidya', recoverInvalidSession: true, connectTimeoutMs: 60000, queryTimeoutMs: 60000, keepAliveIntervalMs: 25000 },
  logging: { level: 'info', color: 'auto', timeZone: 'Asia/Jakarta' },
  mode: 'public',
  prefix: { mode: 'multi', single: '.', list: ['.', '!', '/', '#'] },
  commands: { caseSensitive: false, ignoreEmpty: true },
  security: {
    ownerOnlyInGroups: false,
    allowMasterInGroups: false,
    masterExecEnabled: false,
    masterEvalEnabled: false,
    masterCliEnabled: false,
    masterPythonEnabled: false,
    masterGolangEnabled: false
  },
  limits: { messageMaxChars: 12000, pluginTimeoutMs: 15000, masterTimeoutMs: 8000, masterMaxOutput: 12000 },
  database: {
    segmentMaxBytes: 8 * 1024 * 1024,
    archiveMaxCount: 120,
    mirrorEnabled: true,
    fsync: true,
    verifyOnBoot: true
  },
  features: { autoRead: false, autoTyping: false, selfModeReply: false },
  ai: { enabled: true, providerOrder: ['gemini', 'groq', 'qwen', 'deepseek', 'openai'], models: { gemini: 'gemini-3.6-flash', groq: 'openai/gpt-oss-120b', qwen: 'qwen3.8-flash', deepseek: 'deepseek-flash', openai: 'gpt-6-luna' }, timeoutMs: 35000, maxOutputTokens: 1200, temperature: 0.7, historyMessages: 16, maxInputChars: 10000, retryPerProvider: 1 }
});

let activeConfig = structuredClone(DEFAULTS);
let initialized = false;

function merge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) out[key] = merge(out[key], value);
    else out[key] = value;
  }
  return out;
}

export async function loadConfig() {
  await initializeDatabase();
  const events = await getRecords({ type: 'config.replace' });
  const checkpoint = await getLatestConfigRecord();
  activeConfig = structuredClone(DEFAULTS);
  for (const event of events) activeConfig = merge(activeConfig, event.payload.config);
  const lastEvent = events.at(-1);
  if (checkpoint && (!lastEvent || checkpoint.ts >= lastEvent.ts)) {
    activeConfig = merge(activeConfig, checkpoint.payload.config);
  }
  // v1.4.2 migration: previous releases defaulted to QR. Move old installations
  // to pairing mode once so the shipped config.js default actually takes effect.
  if (!Number.isInteger(activeConfig.schemaVersion) || activeConfig.schemaVersion < 4) {
    activeConfig.schemaVersion = 4;
    activeConfig.whatsapp = { ...DEFAULTS.whatsapp, ...(activeConfig.whatsapp || {}), authMode: 'pairing' };
    await appendRecord('config.replace', {
      config: activeConfig,
      changedBy: 'system:migration',
      reason: 'v1.4.2 default WhatsApp login mode changed to pairing'
    });
  }
  // v1.4.3: browserName is a protocol identity, not the bot's display name.
  // Normalize existing installations to the known-compatible Chrome profile once.
  if (activeConfig.schemaVersion < 5) {
    activeConfig.schemaVersion = 5;
    activeConfig.whatsapp = {
      ...DEFAULTS.whatsapp,
      ...(activeConfig.whatsapp || {}),
      browserName: DEFAULTS.whatsapp.browserName
    };
    await appendRecord('config.replace', {
      config: activeConfig,
      changedBy: 'system:migration',
      reason: 'v1.4.3 normalize WhatsApp pairing browser identity to Chrome'
    });
  }
  // v1.4.4: add safe invalid-session quarantine and structured terminal logging.
  if (activeConfig.schemaVersion < 6) {
    activeConfig.schemaVersion = 6;
    activeConfig.whatsapp = {
      ...DEFAULTS.whatsapp,
      ...(activeConfig.whatsapp || {}),
      recoverInvalidSession: DEFAULTS.whatsapp.recoverInvalidSession
    };
    activeConfig.logging = { ...DEFAULTS.logging, ...(activeConfig.logging || {}) };
    await appendRecord('config.replace', {
      config: activeConfig,
      changedBy: 'system:migration',
      reason: 'v1.4.4 add invalid-session recovery and terminal logger settings'
    });
  }
  configureDatabase(activeConfig.database);
  initialized = true;
  return getConfig();
}

export function getConfig() {
  if (!initialized) throw new Error('Config belum diinisialisasi. Panggil await loadConfig() saat startup.');
  return structuredClone(activeConfig);
}

export async function updateConfig(mutator, metadata = {}) {
  if (!initialized) await loadConfig();
  const next = structuredClone(activeConfig);
  await mutator(next);
  validateConfig(next);
  await appendRecord('config.replace', { config: next, changedBy: metadata.actor || 'system', reason: metadata.reason || 'configuration update' });
  activeConfig = next;
  configureDatabase(activeConfig.database);
  return getConfig();
}

export async function replaceConfig(next, metadata = {}) {
  if (!initialized) await loadConfig();
  const normalized = merge(DEFAULTS, next);
  validateConfig(normalized);
  await appendRecord('config.replace', { config: normalized, changedBy: metadata.actor || 'owner', reason: metadata.reason || 'configuration replacement' });
  activeConfig = normalized;
  configureDatabase(activeConfig.database);
  return getConfig();
}

function validateConfig(c) {
  if (!['public', 'self'].includes(c.mode)) throw new Error('mode harus public atau self');
  if (!['qr', 'pairing'].includes(c.whatsapp?.authMode)) throw new Error('whatsapp.authMode harus qr atau pairing');
  if (!['Chrome', 'Firefox', 'IE', 'Opera', 'Safari', 'Edge'].includes(c.whatsapp?.browserName)) throw new Error('whatsapp.browserName harus Chrome, Firefox, IE, Opera, Safari, atau Edge');
  if (typeof c.whatsapp?.recoverInvalidSession !== 'boolean') throw new Error('whatsapp.recoverInvalidSession harus boolean');
  if (!['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'].includes(c.logging?.level)) throw new Error('logging.level tidak valid');
  if (!['auto', 'always', 'never'].includes(c.logging?.color)) throw new Error('logging.color harus auto, always, atau never');
  if (typeof c.logging?.timeZone !== 'string' || !c.logging.timeZone.trim()) throw new Error('logging.timeZone wajib diisi');
  if (!/^\d{8,15}$/.test(String(c.whatsapp?.pairingNumber || c.bot?.expectedNumber || ''))) throw new Error('whatsapp.pairingNumber harus nomor internasional 8-15 digit tanpa +');
  if (typeof c.whatsapp?.sessionDir !== 'string' || !c.whatsapp.sessionDir.trim()) throw new Error('whatsapp.sessionDir wajib diisi');
  if (!['single', 'multi', 'none'].includes(c.prefix?.mode)) throw new Error('prefix.mode tidak valid');
  if (!/^\d{8,15}$/.test(String(c.bot?.owner || ''))) throw new Error('bot.owner harus berupa nomor internasional tanpa +');
  if (!Number.isInteger(c.database?.segmentMaxBytes) || c.database.segmentMaxBytes < 65536) throw new Error('database.segmentMaxBytes minimal 65536');
  if (!Number.isInteger(c.database?.archiveMaxCount) || c.database.archiveMaxCount < 1) throw new Error('database.archiveMaxCount minimal 1');
  if (c.ai && (!Array.isArray(c.ai.providerOrder) || c.ai.providerOrder.some(name => !['gemini','groq','qwen','deepseek','openai'].includes(name)))) throw new Error('ai.providerOrder berisi provider tidak dikenal');
  if (c.ai && (!Number.isInteger(c.ai.timeoutMs) || c.ai.timeoutMs < 1000 || c.ai.timeoutMs > 180000)) throw new Error('ai.timeoutMs harus 1000-180000');
  if (c.ai && (!Number.isInteger(c.ai.maxOutputTokens) || c.ai.maxOutputTokens < 64 || c.ai.maxOutputTokens > 32768)) throw new Error('ai.maxOutputTokens harus 64-32768');
}

export const configDefaults = DEFAULTS;
export default { loadConfig, getConfig, updateConfig, replaceConfig, configDefaults };
