/**
 * Ocha Lidya public configuration facade.
 * Non-secret settings are persisted in the JSONL event database.
 * Secrets belong in .env and must never be written to this database.
 */
import { initializeDatabase, appendRecord, getRecords, getLatestConfigRecord, configureDatabase } from './core/database.js';

const DEFAULTS = Object.freeze({
  schemaVersion: 24,
  bot: { name: 'Ocha Lidya', aliases: ['Ocha', 'Lidya'], owner: '6283193905842', ownerName: 'Arifi Razzaq', creatorName: 'Arifi Razzaq', organization: 'Razzaq Ventures', publicCreatorDisclosure: true, expectedNumber: '6282177461231' },
  whatsapp: { authMode: 'pairing', pairingNumber: '6282177461231', browserName: 'Chrome', sessionDir: 'sessions/ocha-lidya', recoverInvalidSession: true, connectTimeoutMs: 60000, queryTimeoutMs: 60000, keepAliveIntervalMs: 25000 },
  logging: { level: 'info', color: 'auto', timeZone: 'Asia/Jakarta' },
  mode: 'public',
  ui: { buttonsEnabled: true },
  groupMetadata: { initialSync: true, fetchCooldownMs: 600000 },
  prefix: { mode: 'multi', single: '.', list: ['.', '!', '/', '#'] },
  commands: { caseSensitive: false, ignoreEmpty: true },
  security: {
    ownerOnlyInGroups: false,
    allowMasterInGroups: false,
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
  features: { autoRead: false, autoTyping: false, selfModeReply: false, groupsMuted: true },
  ai: { enabled: true, providerOrder: ['groq', 'gemini', 'deepseek', 'openai'], models: { gemini: 'gemini-3.8-flash', groq: 'openai/gpt-oss-120b', deepseek: 'deepseek-flash', openai: 'gpt-6.2-sol' }, freeOnly: true, timeoutMs: 3500, totalBudgetMs: 14000, maxOutputTokens: 180, temperature: 0.5, historyMessages: 3, maxInputChars: 3500, coalesceMs: 80 },
  codeLab: { enabled: true, aiExecutionEnabled: true, publicTunnelEnabled: true, websiteBuilderEnabled: true, websiteBuilderConcurrency: 2, websiteBuilderQueueLimit: 8, tunnelIdleMs: 300000, projectLibraryRoot: '', cloudflaredBin: 'cloudflared', containerRuntime: 'auto', port: 8787, ttlMs: 3600000, maxRuntimeMs: 120000, maxSourceBytes: 65536, maxOutputBytes: 49152, maxConcurrent: 2, maxSessionsTotal: 20, maxSessionsPerUser: 2, maxExecutionsPerMinute: 3, pythonImage: 'python:3.12-alpine', nodeImage: 'node:22-alpine' }
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
  activeConfig.ui = { ...DEFAULTS.ui, ...(activeConfig.ui || {}) };
  // v1.5.0: persist interactive-response mode.
  if (activeConfig.schemaVersion < 7) {
    activeConfig.schemaVersion = 7;
    activeConfig.ui = { ...DEFAULTS.ui, ...(activeConfig.ui || {}) };
    await appendRecord('config.replace', {
      config: activeConfig,
      changedBy: 'system:migration',
      reason: 'v1.5.0 add owner-controlled interactive command responses'
    });
  }
  // v1.5.0: low-latency AI profile and explicit group metadata cache policy.
  if (activeConfig.schemaVersion < 8) {
    activeConfig.schemaVersion = 8;
    activeConfig.groupMetadata = { ...DEFAULTS.groupMetadata, ...(activeConfig.groupMetadata || {}) };
    const ai = activeConfig.ai || (activeConfig.ai = {});
    ai.models = { ...DEFAULTS.ai.models, ...(ai.models || {}) };
    const previousDefaultOrder = ['gemini', 'groq', 'qwen', 'deepseek', 'openai'];
    if (JSON.stringify(ai.providerOrder) === JSON.stringify(previousDefaultOrder)) ai.providerOrder = [...DEFAULTS.ai.providerOrder];
    if (ai.models.groq === 'openai/gpt-oss-120b') ai.models.groq = DEFAULTS.ai.models.groq;
    if (ai.models.gemini === 'gemini-3.6-flash') ai.models.gemini = DEFAULTS.ai.models.gemini;
    if ([8500, 35000].includes(ai.timeoutMs)) ai.timeoutMs = DEFAULTS.ai.timeoutMs;
    if ([22000, 35000].includes(ai.totalBudgetMs) || !Number.isInteger(ai.totalBudgetMs)) ai.totalBudgetMs = DEFAULTS.ai.totalBudgetMs;
    if ([700, 1200].includes(ai.maxOutputTokens)) ai.maxOutputTokens = DEFAULTS.ai.maxOutputTokens;
    if ([10, 16].includes(ai.historyMessages)) ai.historyMessages = DEFAULTS.ai.historyMessages;
    if (ai.maxInputChars === 10000) ai.maxInputChars = DEFAULTS.ai.maxInputChars;
    if (!Number.isInteger(ai.coalesceMs)) ai.coalesceMs = DEFAULTS.ai.coalesceMs;
    await appendRecord('config.replace', {
      config: activeConfig,
      changedBy: 'system:migration',
      reason: 'v1.5.0 low-latency AI settings and one-time group metadata cache policy'
    });
  }
  // v1.5.0 schema v9: lower the default latency/output budget while preserving
  // owner-defined non-default values. This is a config.js + JSONL migration.
  if (activeConfig.schemaVersion < 9) {
    activeConfig.schemaVersion = 9;
    const ai = activeConfig.ai || (activeConfig.ai = {});
    if (ai.timeoutMs === 6500) ai.timeoutMs = DEFAULTS.ai.timeoutMs;
    if (ai.totalBudgetMs === 16000) ai.totalBudgetMs = DEFAULTS.ai.totalBudgetMs;
    if (ai.maxOutputTokens === 500) ai.maxOutputTokens = DEFAULTS.ai.maxOutputTokens;
    if (ai.historyMessages === 8) ai.historyMessages = DEFAULTS.ai.historyMessages;
    if (ai.coalesceMs === 180) ai.coalesceMs = DEFAULTS.ai.coalesceMs;
    await appendRecord('config.replace', {
      config: activeConfig,
      changedBy: 'system:migration',
      reason: 'v1.5.0 schema v9 lower-latency AI response profile'
    });
  }
  // v1.6.0 schema v10: remove Qwen from routing and remove the per-provider key-attempt cap.
  if (activeConfig.schemaVersion < 10) {
    activeConfig.schemaVersion = 10;
    const ai = activeConfig.ai || (activeConfig.ai = {});
    ai.providerOrder = (Array.isArray(ai.providerOrder) ? ai.providerOrder : DEFAULTS.ai.providerOrder).filter(name => name !== 'qwen');
    if (!ai.providerOrder.length) ai.providerOrder = [...DEFAULTS.ai.providerOrder];
    if (ai.models) delete ai.models.qwen;
    ai.models = { ...DEFAULTS.ai.models, ...(ai.models || {}) };
    delete ai.maxKeyAttempts;
    delete ai.retryPerProvider;
    if (ai.totalBudgetMs === 12000 || ai.totalBudgetMs === 16000) ai.totalBudgetMs = DEFAULTS.ai.totalBudgetMs;
    await appendRecord('config.replace', { config: activeConfig, changedBy: 'system:migration', reason: 'v1.6.0 remove Qwen and enable exhaustive per-provider API-key rotation' });
  }
  // v1.6.2 schema v11: make each developer runner independent and mute all
  // group interactions by default while retaining metadata/contact event processing.
  if (activeConfig.schemaVersion < 11) {
    activeConfig.schemaVersion = 11;
  activeConfig.security = { ...DEFAULTS.security, ...(activeConfig.security || {}) };
    delete activeConfig.security.masterExecEnabled;
    activeConfig.features = { ...DEFAULTS.features, ...(activeConfig.features || {}) };
    if (typeof activeConfig.features.groupsMuted !== 'boolean') activeConfig.features.groupsMuted = true;
    await appendRecord('config.replace', {
      config: activeConfig,
      changedBy: 'system:migration',
      reason: 'v1.6.2 independent master runners and default global group mute'
    });
  }
  // v1.7.1 schema v12: low-latency AI boost. Migrate only known shipped defaults;
  // preserve any owner-customized timeout, model, history, and output settings.
  if (activeConfig.schemaVersion < 12) {
    activeConfig.schemaVersion = 12;
    const ai = activeConfig.ai || (activeConfig.ai = {});
    const shipped = { timeoutMs: 7000, totalBudgetMs: 45000, maxOutputTokens: 320, temperature: 0.6, historyMessages: 6, maxInputChars: 6000, coalesceMs: 350 };
    const boosted = { timeoutMs: 3500, totalBudgetMs: 14000, maxOutputTokens: 180, temperature: 0.5, historyMessages: 3, maxInputChars: 3500, coalesceMs: 80, maxKeyAttempts: 3 };
    for (const [key, oldValue] of Object.entries(shipped)) if (ai[key] === oldValue) ai[key] = boosted[key];
    ai.maxKeyAttempts = 1;
    await appendRecord('config.replace', { config: activeConfig, changedBy: 'system:migration', reason: 'v1.7.1 low-latency AI boost profile' });
  }
  // v1.7.2 schema v13: add owner master workload guard without enabling runners.
  if (activeConfig.schemaVersion < 13) {
    activeConfig.schemaVersion = 13;
    await appendRecord('config.replace', { config: activeConfig, changedBy: 'system:migration', reason: 'v1.7.2 owner master workload guard and eval runtime context' });
  }
  // v1.7.3 schema v14: redact Signal session dumps and keep runtime directories
  // outside filesystem watchers. Logging color remains auto unless overridden.
  if (activeConfig.schemaVersion < 14) {
    activeConfig.schemaVersion = 14;
    activeConfig.logging = { ...DEFAULTS.logging, ...(activeConfig.logging || {}) };
    await appendRecord('config.replace', { config: activeConfig, changedBy: 'system:migration', reason: 'v1.7.3 secure terminal logging and runtime watcher exclusions' });
  }
  // v1.8.0 schema v15: add isolated multi-session Code Lab and Nexora capability controls.
  if (activeConfig.schemaVersion < 15) {
    activeConfig.schemaVersion = 15;
    activeConfig.codeLab = { ...DEFAULTS.codeLab, ...(activeConfig.codeLab || {}) };
    await appendRecord('config.replace', { config: activeConfig, changedBy: 'system:migration', reason: 'v1.8.0 isolated Code Lab workers and temporary TryCloudflare preview sessions' });
  }
  // v1.8.1 schema v16: persist one always-on Quick Tunnel per bot process,
  // bundle owner activation controls, and use a lower-memory worker default.
  if (activeConfig.schemaVersion < 16) {
    activeConfig.schemaVersion = 16;
    activeConfig.codeLab = { ...DEFAULTS.codeLab, ...(activeConfig.codeLab || {}) };
    if (activeConfig.codeLab.maxConcurrent === 3) activeConfig.codeLab.maxConcurrent = 2;
    else if (Number(activeConfig.codeLab.maxConcurrent) > 4) activeConfig.codeLab.maxConcurrent = 4;
    await appendRecord('config.replace', { config: activeConfig, changedBy: 'system:migration', reason: 'v1.8.1 persistent single tunnel and bounded low-memory worker pool' });
  }
  // v1.9.0 schema v17: enable the multi-file static website builder capability.
  if (activeConfig.schemaVersion < 17) {
    activeConfig.schemaVersion = 17;
    activeConfig.codeLab = { ...DEFAULTS.codeLab, ...(activeConfig.codeLab || {}) };
    if (typeof activeConfig.codeLab.websiteBuilderEnabled !== 'boolean') activeConfig.codeLab.websiteBuilderEnabled = true;
    await appendRecord('config.replace', { config: activeConfig, changedBy: 'system:migration', reason: 'v1.9.0 Nexora multi-file website builder capability' });
  }
  // v1.10.0 schema v18: public creator identity and relationship/profile engine defaults.
  if (activeConfig.schemaVersion < 18) {
    activeConfig.schemaVersion = 18;
    activeConfig.bot = { ...DEFAULTS.bot, ...(activeConfig.bot || {}) };
    activeConfig.ai = { ...DEFAULTS.ai, ...(activeConfig.ai || {}) };
    // v1.7.1 shipped maxKeyAttempts=1 as its fast default; v1.10 rotates up to
    // three eligible keys per provider to avoid repeatedly selecting one failing key.
    if (activeConfig.ai.maxKeyAttempts === 1) activeConfig.ai.maxKeyAttempts = 3;
    await appendRecord('config.replace', { config: activeConfig, changedBy: 'system:migration', reason: 'v1.10.0 public creator identity, relationship profiles, and fair provider key rotation' });
  }
  // v1.10.1 schema v19: on-demand shared Quick Tunnel lifecycle with
  // cross-process lease protection and configurable idle shutdown.
  if (activeConfig.schemaVersion < 19) {
    activeConfig.schemaVersion = 19;
    activeConfig.codeLab = { ...DEFAULTS.codeLab, ...(activeConfig.codeLab || {}) };
    if (!Number.isInteger(activeConfig.codeLab.tunnelIdleMs)) activeConfig.codeLab.tunnelIdleMs = DEFAULTS.codeLab.tunnelIdleMs;
    await appendRecord('config.replace', { config: activeConfig, changedBy: 'system:migration', reason: 'v1.10.1 on-demand shared Quick Tunnel, exclusive process lease, and idle shutdown lifecycle' });
  }
  // v1.10.2 schema v20: runtime auto-detection with Docker/Podman fallback.
  if (activeConfig.schemaVersion < 20) {
    activeConfig.schemaVersion = 20;
    activeConfig.codeLab = { ...DEFAULTS.codeLab, ...(activeConfig.codeLab || {}) };
    await appendRecord('config.replace', { config: activeConfig, changedBy: 'system:migration', reason: 'v1.10.2 adaptive container runtime discovery and fallback' });
  }
  // v1.10.4 schema v21: persistent per-user website repositories, task memory,
  // local version history, and configurable project-library root.
  if (activeConfig.schemaVersion < 21) {
    activeConfig.schemaVersion = 21;
    activeConfig.codeLab = { ...DEFAULTS.codeLab, ...(activeConfig.codeLab || {}) };
    if (typeof activeConfig.codeLab.projectLibraryRoot !== 'string') activeConfig.codeLab.projectLibraryRoot = '';
    await appendRecord('config.replace', { config: activeConfig, changedBy: 'system:migration', reason: 'v1.10.4 persistent isolated user project repositories and project memory' });
  }
  // v1.10.9 schema v22: ordered multi-provider fallback. Previous releases
  // intentionally persisted a single provider; keep that provider first, then
  // append the remaining supported providers as automatic fallback options.
  if (activeConfig.schemaVersion < 22) {
    activeConfig.schemaVersion = 22;
    const ai = activeConfig.ai || (activeConfig.ai = {});
    const supported = ['groq', 'gemini', 'deepseek', 'openai'];
    const currentOrder = Array.isArray(ai.providerOrder) ? ai.providerOrder.map(value => String(value || '').trim().toLowerCase()) : [];
    const normalizedOrder = [...new Set(currentOrder.filter(name => supported.includes(name)))];
    ai.providerOrder = !normalizedOrder.length
      ? [...DEFAULTS.ai.providerOrder]
      : normalizedOrder.length === 1
        ? [normalizedOrder[0], ...DEFAULTS.ai.providerOrder.filter(name => name !== normalizedOrder[0])]
        : normalizedOrder;
    delete ai.maxKeyAttempts;
    delete ai.retryPerProvider;
    ai.models = { ...DEFAULTS.ai.models, ...(ai.models || {}) };
    await appendRecord('config.replace', { config: activeConfig, changedBy: 'system:migration', reason: 'v1.10.9 ordered provider fallback with classified key/provider failure handling' });
  }
  // v1.10.10 schema v24: autonomous model discovery, independent 24-hour
  // catalog scheduling, and conservative free-tier routing defaults.
  if (activeConfig.schemaVersion < 24) {
    activeConfig.schemaVersion = 24;
    const ai = activeConfig.ai || (activeConfig.ai = {});
    if (typeof ai.freeOnly !== 'boolean') ai.freeOnly = true;
    ai.models = { ...DEFAULTS.ai.models, ...(ai.models || {}) };
    if (ai.models.groq === 'openai/gpt-oss-20b') ai.models.groq = DEFAULTS.ai.models.groq;
    await appendRecord('config.replace', { config: activeConfig, changedBy: 'system:migration', reason: 'v1.10.10 autonomous provider model catalog and free-tier-first routing' });
  }
  activeConfig.security = { ...DEFAULTS.security, ...(activeConfig.security || {}) };
  delete activeConfig.security.masterExecEnabled;
  activeConfig.features = { ...DEFAULTS.features, ...(activeConfig.features || {}) };
  activeConfig.groupMetadata = { ...DEFAULTS.groupMetadata, ...(activeConfig.groupMetadata || {}) };
  activeConfig.codeLab = { ...DEFAULTS.codeLab, ...(activeConfig.codeLab || {}) };
  activeConfig.ui = { ...DEFAULTS.ui, ...(activeConfig.ui || {}) };
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
  activeConfig.ui = { ...DEFAULTS.ui, ...(activeConfig.ui || {}) };
  configureDatabase(activeConfig.database);
  return getConfig();
}

export async function replaceConfig(next, metadata = {}) {
  if (!initialized) await loadConfig();
  const normalized = merge(DEFAULTS, next);
  validateConfig(normalized);
  await appendRecord('config.replace', { config: normalized, changedBy: metadata.actor || 'owner', reason: metadata.reason || 'configuration replacement' });
  activeConfig = normalized;
  activeConfig.ui = { ...DEFAULTS.ui, ...(activeConfig.ui || {}) };
  configureDatabase(activeConfig.database);
  return getConfig();
}

function validateConfig(c) {
  if (!['public', 'self'].includes(c.mode)) throw new Error('mode harus public atau self');
  if (typeof c.ui?.buttonsEnabled !== 'boolean') throw new Error('ui.buttonsEnabled harus boolean');
  if (typeof c.features?.groupsMuted !== 'boolean') throw new Error('features.groupsMuted harus boolean');
  if (typeof c.groupMetadata?.initialSync !== 'boolean') throw new Error('groupMetadata.initialSync harus boolean');
  if (!Number.isInteger(c.groupMetadata?.fetchCooldownMs) || c.groupMetadata.fetchCooldownMs < 1000 || c.groupMetadata.fetchCooldownMs > 86400000) throw new Error('groupMetadata.fetchCooldownMs harus 1000-86400000');
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
  for (const key of ['ownerName', 'creatorName', 'organization']) if (typeof c.bot?.[key] !== 'string' || !c.bot[key].trim() || c.bot[key].length > 80) throw new Error(`bot.${key} wajib berupa teks 1-80 karakter`);
  if (typeof c.bot?.publicCreatorDisclosure !== 'boolean') throw new Error('bot.publicCreatorDisclosure harus boolean');
  if (!Number.isInteger(c.database?.segmentMaxBytes) || c.database.segmentMaxBytes < 65536) throw new Error('database.segmentMaxBytes minimal 65536');
  if (!Number.isInteger(c.database?.archiveMaxCount) || c.database.archiveMaxCount < 1) throw new Error('database.archiveMaxCount minimal 1');
  if (c.ai && (!Array.isArray(c.ai.providerOrder) || c.ai.providerOrder.some(name => !['gemini','groq','deepseek','openai'].includes(name)))) throw new Error('ai.providerOrder berisi provider tidak dikenal');
  if (c.ai && typeof c.ai.freeOnly !== 'boolean') throw new Error('ai.freeOnly harus boolean');
  if (c.ai && (!Number.isInteger(c.ai.timeoutMs) || c.ai.timeoutMs < 1000 || c.ai.timeoutMs > 180000)) throw new Error('ai.timeoutMs harus 1000-180000');
  if (c.ai && (!Number.isInteger(c.ai.totalBudgetMs) || c.ai.totalBudgetMs < 3000 || c.ai.totalBudgetMs > 120000)) throw new Error('ai.totalBudgetMs harus 3000-120000');
  if (c.ai && (!Number.isInteger(c.ai.coalesceMs) || c.ai.coalesceMs < 0 || c.ai.coalesceMs > 2000)) throw new Error('ai.coalesceMs harus 0-2000');
  if (c.ai && (!Number.isInteger(c.ai.maxOutputTokens) || c.ai.maxOutputTokens < 64 || c.ai.maxOutputTokens > 32768)) throw new Error('ai.maxOutputTokens harus 64-32768');
  for (const key of ['enabled', 'aiExecutionEnabled', 'publicTunnelEnabled', 'websiteBuilderEnabled']) if (typeof c.codeLab?.[key] !== 'boolean') throw new Error(`codeLab.${key} harus boolean`);
  if (!Number.isInteger(c.codeLab?.websiteBuilderConcurrency) || c.codeLab.websiteBuilderConcurrency < 1 || c.codeLab.websiteBuilderConcurrency > 4) throw new Error('codeLab.websiteBuilderConcurrency harus 1-4');
  if (!Number.isInteger(c.codeLab?.websiteBuilderQueueLimit) || c.codeLab.websiteBuilderQueueLimit < 0 || c.codeLab.websiteBuilderQueueLimit > 40) throw new Error('codeLab.websiteBuilderQueueLimit harus 0-40');
  if (!Number.isInteger(c.codeLab?.tunnelIdleMs) || c.codeLab.tunnelIdleMs < 0 || c.codeLab.tunnelIdleMs > 3600000) throw new Error('codeLab.tunnelIdleMs harus 0-3600000');
  if (!Number.isInteger(c.codeLab?.port) || c.codeLab.port < 1024 || c.codeLab.port > 65535) throw new Error('codeLab.port harus 1024-65535');
  if (!Number.isInteger(c.codeLab?.ttlMs) || c.codeLab.ttlMs < 60000 || c.codeLab.ttlMs > 3600000) throw new Error('codeLab.ttlMs harus 60000-3600000');
  if (!Number.isInteger(c.codeLab?.maxRuntimeMs) || c.codeLab.maxRuntimeMs < 5000 || c.codeLab.maxRuntimeMs > 600000) throw new Error('codeLab.maxRuntimeMs harus 5000-600000');
  if (!Number.isInteger(c.codeLab?.maxConcurrent) || c.codeLab.maxConcurrent < 1 || c.codeLab.maxConcurrent > 4) throw new Error('codeLab.maxConcurrent harus 1-4');
  if (!Number.isInteger(c.codeLab?.maxSessionsTotal) || c.codeLab.maxSessionsTotal < 1 || c.codeLab.maxSessionsTotal > 100) throw new Error('codeLab.maxSessionsTotal harus 1-100');
  if (!Number.isInteger(c.codeLab?.maxSessionsPerUser) || c.codeLab.maxSessionsPerUser < 1 || c.codeLab.maxSessionsPerUser > 10) throw new Error('codeLab.maxSessionsPerUser harus 1-10');
  if (!Number.isInteger(c.codeLab?.maxSourceBytes) || c.codeLab.maxSourceBytes < 1024 || c.codeLab.maxSourceBytes > 262144) throw new Error('codeLab.maxSourceBytes harus 1024-262144');
  if (!Number.isInteger(c.codeLab?.maxOutputBytes) || c.codeLab.maxOutputBytes < 2048 || c.codeLab.maxOutputBytes > 49152) throw new Error('codeLab.maxOutputBytes harus 2048-49152');
  if (!['auto', 'docker', 'podman'].includes(c.codeLab?.containerRuntime)) throw new Error('codeLab.containerRuntime harus auto, docker, atau podman');
  if (typeof c.codeLab?.projectLibraryRoot !== 'string' || c.codeLab.projectLibraryRoot.length > 500) throw new Error('codeLab.projectLibraryRoot harus berupa path teks maksimal 500 karakter');
  for (const key of ['cloudflaredBin', 'pythonImage', 'nodeImage']) if (typeof c.codeLab?.[key] !== 'string' || !c.codeLab[key].trim()) throw new Error(`codeLab.${key} wajib diisi`);
}

export const configDefaults = DEFAULTS;
export default { loadConfig, getConfig, updateConfig, replaceConfig, configDefaults };
