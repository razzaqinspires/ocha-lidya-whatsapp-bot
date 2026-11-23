import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { listProviderModels, providerNames, reloadProviderKeyVault } from './providers.js';
import { logger } from '../core/logger.js';

export const MODEL_CATALOG_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MODEL_POLICY_RESEARCHED_AT = '2026-11-23';
export const MODEL_POLICY_VERSION = 2;
const SCHEDULER_RETRY_MS = 60 * 60 * 1000;
const SCHEDULER_CONTENTION_RETRY_MS = 2 * 60 * 1000;
const MAX_STALE_SELECTION_MS = 7 * 24 * 60 * 60 * 1000;
const CATALOG_FILE = path.resolve('data/ai-model-catalog.json');
const LOCK_FILE = path.resolve('data/ai-model-catalog.lock');
const LOCK_STALE_MS = 5 * 60 * 1000;
const WORKER_STATUS_FILE = path.resolve('data/ai-model-catalog-worker.json');

// Free-tier policy is deliberately separate from the live model directory:
// providers list all models visible to an API key, including paid-only models.
// These allowlists are based on provider pricing/rate-limit documentation.
export const MODEL_ACCESS_POLICY = Object.freeze({
  groq: Object.freeze({
    // Keep the production fallback conservative: GPT-OSS 120B is the verified
    // primary model for this deployment. Other visible models are not silently
    // promoted merely because the Models endpoint lists them.
    tier: 'free-plan-access-subject-to-account-quotas; usage-priced-on-developer-tier',
    freeModels: ['openai/gpt-oss-120b'],
    preferredFree: ['openai/gpt-oss-120b'],
    preferredPaid: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    docs: ['https://console.groq.com/docs/models', 'https://console.groq.com/docs/rate-limits', 'https://console.groq.com/docs/billing-faqs', 'https://console.groq.com/docs/deprecations']
  }),
  gemini: Object.freeze({
    // Google documents Gemini 3.8 Flash as having a free API tier. A 503 from
    // the inference endpoint is a capacity/service incident, not proof that
    // the model ID is incompatible. Keep it as secondary free-tier fallback.
    tier: 'official-free-tier-available-with-model-and-project-quotas',
    freeModels: ['gemini-3.8-flash'],
    preferredFree: ['gemini-3.8-flash'],
    preferredPaid: ['gemini-3.1-pro-preview', 'gemini-3.8-flash'],
    docs: ['https://ai.google.dev/gemini-api/docs/models', 'https://ai.google.dev/gemini-api/docs/pricing']
  }),
  deepseek: Object.freeze({
    tier: 'no-documented-no-cost-inference-tier',
    freeModels: [],
    preferredFree: [],
    preferredPaid: ['deepseek-flash', 'deepseek-v4-pro'],
    docs: ['https://api-docs.deepseek.com/api/list-models/', 'https://api-docs.deepseek.com/quick_start/pricing/', 'https://api-docs.deepseek.com/quick_start/error_codes/']
  }),
  openai: Object.freeze({
    tier: 'paid-api-no-guaranteed-free-model-access',
    freeModels: [],
    preferredFree: [],
    preferredPaid: ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-terra', 'gpt-6-luna'],
    docs: ['https://developers.openai.com/api/docs/models', 'https://developers.openai.com/api/docs/models/gpt-6.2-sol', 'https://developers.openai.com/api/docs/guides/rate-limits']
  })
});

const SAFE_DEFAULT_MODELS = Object.freeze({
  groq: 'openai/gpt-oss-120b',
  gemini: 'gemini-3.8-flash',
  deepseek: 'deepseek-flash',
  openai: 'gpt-6.2-sol'
});

let cachedSnapshot = null;
let cacheLoaded = false;
let refreshPromise = null;
let schedulerTimer = null;
let schedulerActive = false;
let schedulerInFlight = false;
let schedulerForceRequested = false;
let schedulerNextRunAt = null;
let schedulerKeepAlive = false;

export function isModelCatalogDue(lastChecked, now = Date.now(), intervalMs = MODEL_CATALOG_INTERVAL_MS) {
  const timestamp = Date.parse(lastChecked || '');
  return !Number.isFinite(timestamp) || now - timestamp >= intervalMs;
}

export function hasRetryableCatalogFailure(snapshot) {
  return Object.values(snapshot?.providers || {}).some(state => state?.status === 'unreachable');
}

export function getNextModelCatalogDelay(snapshot, now = Date.now(), retryMs = SCHEDULER_RETRY_MS) {
  if (hasRetryableCatalogFailure(snapshot)) return retryMs;
  if (!snapshot?.checkedAt || isModelCatalogDue(snapshot.checkedAt, now)) return SCHEDULER_CONTENTION_RETRY_MS;
  const nextAt = Date.parse(snapshot?.nextCheckAt || '');
  if (Number.isFinite(nextAt)) return Math.max(1000, nextAt - now);
  const checkedAt = Date.parse(snapshot?.checkedAt || '');
  if (Number.isFinite(checkedAt)) return Math.max(1000, checkedAt + MODEL_CATALOG_INTERVAL_MS - now);
  return 0;
}

function choosePreferred(models, preferred) {
  const available = new Set((models || []).filter(model => model.supportsChat !== false).map(model => model.id));
  return preferred.find(model => available.has(model)) || null;
}

export function buildProviderCatalogEntry(provider, listing, previousEntry = null) {
  const policy = MODEL_ACCESS_POLICY[provider];
  if (!policy) throw new Error(`Unknown AI provider: ${provider}`);
  if (listing.status !== 'ok') {
    const prev = previousEntry || {};
    const lastSuccessfulAt = prev.lastSuccessfulAt || null;
    const lastOkAge = lastSuccessfulAt ? Date.now() - Date.parse(lastSuccessfulAt) : Infinity;
    const keepLastKnown = Number.isFinite(lastOkAge) && lastOkAge <= MAX_STALE_SELECTION_MS;
    return {
      provider,
      status: listing.status,
      error: listing.error || null,
      modelCount: keepLastKnown ? (prev.models || []).length : 0,
      models: keepLastKnown ? (prev.models || []) : [],
      freeTier: policy.tier,
      freeEligibleModels: keepLastKnown ? (prev.freeEligibleModels || []) : [],
      unclassifiedChatModels: keepLastKnown ? (prev.unclassifiedChatModels || []) : [],
      recommendedFreeModel: keepLastKnown ? (prev.recommendedFreeModel || null) : null,
      recommendedPaidModel: keepLastKnown ? (prev.recommendedPaidModel || null) : null,
      lastSuccessfulAt,
      stale: keepLastKnown
    };
  }

  const models = Array.isArray(listing.models) ? listing.models : [];
  const freeEligibleModels = models
    .filter(model => model.supportsChat !== false && policy.freeModels.includes(model.id))
    .map(model => model.id);
  const policyManagedIds = new Set([...policy.freeModels, ...policy.preferredPaid]);
  const unclassifiedChatModels = models
    .filter(model => model.supportsChat !== false && !policyManagedIds.has(model.id))
    .map(model => model.id).slice(0, 50);
  return {
    provider,
    status: 'ok',
    keyFingerprint: listing.keyFingerprint || null,
    error: null,
    modelCount: models.length,
    models,
    freeTier: policy.tier,
    freeEligibleModels,
    unclassifiedChatModels,
    recommendedFreeModel: choosePreferred(models.filter(model => policy.freeModels.includes(model.id)), policy.preferredFree),
    recommendedPaidModel: choosePreferred(models, policy.preferredPaid),
    lastSuccessfulAt: listing.listedAt || new Date().toISOString(),
    stale: false
  };
}

async function loadCache({ reload = false } = {}) {
  if (cacheLoaded && !reload) return cachedSnapshot;
  try {
    const stored = JSON.parse(await fs.readFile(CATALOG_FILE, 'utf8'));
    cachedSnapshot = stored?.current || stored || null;
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn({ err: error }, 'AI model catalog database could not be read');
    if (error.code === 'ENOENT') cachedSnapshot = null;
  }
  cacheLoaded = true;
  return cachedSnapshot;
}

async function acquireCatalogLock() {
  await fs.mkdir(path.dirname(CATALOG_FILE), { recursive: true, mode: 0o700 });
  try {
    const handle = await fs.open(LOCK_FILE, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await handle.close();
    return async () => { try { await fs.unlink(LOCK_FILE); } catch {} };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try {
      const stat = await fs.stat(LOCK_FILE);
      if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        await fs.unlink(LOCK_FILE);
        return acquireCatalogLock();
      }
    } catch {}
    return null;
  }
}

async function persistCatalogSnapshot(snapshot) {
  let previous = null;
  try { previous = JSON.parse(await fs.readFile(CATALOG_FILE, 'utf8')); } catch {}
  const current = previous?.current || (previous?.checkedAt ? previous : null);
  const history = Array.isArray(previous?.history) ? previous.history : [];
  if (current?.checkedAt && current.checkedAt !== snapshot.checkedAt) {
    history.push({ checkedAt: current.checkedAt, providers: Object.fromEntries(providerNames.map(name => {
      const state = current.providers?.[name] || {};
      return [name, { status: state.status, modelCount: state.modelCount, recommendedFreeModel: state.recommendedFreeModel, recommendedPaidModel: state.recommendedPaidModel }];
    })) });
  }
  const envelope = { schemaVersion: 1, current: snapshot, history: history.slice(-30), updatedAt: new Date().toISOString() };
  const temp = `${CATALOG_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temp, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(envelope, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  await fs.rename(temp, CATALOG_FILE);
  await fs.chmod(CATALOG_FILE, 0o600);
}

export async function refreshModelCatalog({ force = false, timeoutMs = 10000 } = {}) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    let previous = await loadCache({ reload: true });
    if (!force && previous && !isModelCatalogDue(previous.checkedAt)) return previous;
    const releaseLock = await acquireCatalogLock();
    if (!releaseLock) return (await loadCache({ reload: true })) || previous;
    try {
      previous = await loadCache({ reload: true });
      if (!force && previous && !isModelCatalogDue(previous.checkedAt)) return previous;
      await reloadProviderKeyVault();
      const previousProviders = previous?.providers || {};
      const results = await Promise.all(providerNames.map(async provider => {
        try { return await listProviderModels(provider, { timeoutMs }); }
        catch (error) {
          return {
            provider,
            status: 'unreachable',
            models: [],
            error: { code: String(error?.code || 'MODEL_CATALOG_FAILED'), httpStatus: Number(error?.status) || null, message: String(error?.message || 'catalog lookup failed').slice(0, 300) }
          };
        }
      }));

      const providers = {};
      for (const listing of results) {
        providers[listing.provider] = buildProviderCatalogEntry(listing.provider, listing, previousProviders[listing.provider]);
      }
      const checkedAt = new Date().toISOString();
      const snapshot = {
        schemaVersion: 1,
        checkedAt,
        nextCheckAt: new Date(Date.parse(checkedAt) + MODEL_CATALOG_INTERVAL_MS).toISOString(),
        intervalHours: 24,
        source: 'provider-authenticated-model-list-intersected-with-versioned-official-access-policy',
        policyVersion: MODEL_POLICY_VERSION,
        policyResearchedAt: MODEL_POLICY_RESEARCHED_AT,
        sources: Object.fromEntries(providerNames.map(name => [name, MODEL_ACCESS_POLICY[name].docs])),
        providers
      };
      await persistCatalogSnapshot(snapshot);
      cachedSnapshot = snapshot;
      cacheLoaded = true;
      if (schedulerActive) scheduleModelCatalogTimer(getNextModelCatalogDelay(snapshot));
      const summary = Object.fromEntries(providerNames.map(name => [name, {
        status: providers[name].status,
        models: providers[name].modelCount,
        recommendedFreeModel: providers[name].recommendedFreeModel
      }]));
      logger.info({ checkedAt, intervalHours: 24, providers: summary }, 'AI model catalog refreshed and persisted');
      return snapshot;
    } finally { await releaseLock(); }
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function readDetachedWorkerStatus() {
  try {
    const status = JSON.parse(await fs.readFile(WORKER_STATUS_FILE, 'utf8'));
    const pid = Number(status?.pid);
    let processAlive = false;
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); processAlive = true; }
      catch (error) { processAlive = error.code === 'EPERM'; }
    }
    const heartbeatAt = Date.parse(status?.heartbeatAt || '');
    const heartbeatFresh = Number.isFinite(heartbeatAt) && Date.now() - heartbeatAt < 3 * 60_000;
    return { ...status, active: Boolean(status?.active && processAlive && heartbeatFresh) };
  } catch { return { active: false, pid: null, heartbeatAt: null, nextRunAt: null }; }
}

export async function getModelCatalogStatus() {
  const [snapshot, worker] = await Promise.all([loadCache({ reload: true }), readDetachedWorkerStatus()]);
  return {
    checkedAt: snapshot?.checkedAt || null,
    nextCheckAt: snapshot?.nextCheckAt || null,
    intervalHours: snapshot?.intervalHours || 24,
    providers: snapshot?.providers || {},
    scheduler: {
      active: schedulerActive || worker.active,
      mode: worker.active ? (schedulerActive ? 'detached-worker + in-process' : 'detached-worker') : 'in-process',
      workerActive: worker.active,
      workerPid: worker.active ? worker.pid : null,
      workerHeartbeatAt: worker.active ? worker.heartbeatAt : null,
      nextRunAt: schedulerNextRunAt || worker.nextRunAt || null,
      retryMinutes: SCHEDULER_RETRY_MS / 60_000
    }
  };
}

export function getRuntimeModelConfig(configuredModels = {}, { freeOnly = true } = {}) {
  const models = { ...SAFE_DEFAULT_MODELS, ...(configuredModels || {}) };
  const snapshot = cachedSnapshot;
  const allowedProviders = [];
  for (const provider of providerNames) {
    const policy = MODEL_ACCESS_POLICY[provider];
    const state = snapshot?.providers?.[provider];
    if (freeOnly) {
      if (!policy.freeModels.length) continue;
      if (state?.status === 'ok') {
        if (!state.recommendedFreeModel) continue;
        models[provider] = state.recommendedFreeModel;
      } else if (state?.recommendedFreeModel) {
        models[provider] = state.recommendedFreeModel;
      } else {
        models[provider] = SAFE_DEFAULT_MODELS[provider];
      }
      allowedProviders.push(provider);
      continue;
    }
    if (state?.status === 'ok' && state.recommendedPaidModel) models[provider] = state.recommendedPaidModel;
    allowedProviders.push(provider);
  }
  return { models, allowedProviders };
}

/**
 * Autonomous model catalogue scheduler used by the main bot and detached worker.
 * npm start starts the main scheduler and ensures a singleton detached worker.
 * The worker survives terminal closure and main-bot shutdown while the VPS is on.
 * A missing/overdue snapshot is refreshed immediately, then the persisted 24h
 * deadline is used. Transient provider outages retry hourly; lock contention
 * with the sibling process retries after two minutes. After VPS downtime, the
 * next npm start recreates the worker and catches up from the saved deadline.
 */
function scheduleModelCatalogTimer(delayMs) {
  if (!schedulerActive) return;
  if (schedulerTimer) clearTimeout(schedulerTimer);
  const delay = Math.max(1000, Number(delayMs) || 1000);
  schedulerNextRunAt = new Date(Date.now() + delay).toISOString();
  schedulerTimer = setTimeout(() => {
    schedulerTimer = null;
    void runScheduledCatalogRefresh('timer');
  }, delay);
  if (!schedulerKeepAlive) schedulerTimer.unref?.();
}

async function runScheduledCatalogRefresh(reason, { force = false } = {}) {
  if (!schedulerActive) return;
  if (schedulerInFlight) {
    if (force) schedulerForceRequested = true;
    return;
  }
  schedulerInFlight = true;
  let forceThisCycle = force;
  try {
    do {
      schedulerForceRequested = false;
      await loadCache({ reload: true });
      const previous = cachedSnapshot;
      const retryingProviderOutage = hasRetryableCatalogFailure(previous);
      const snapshot = await refreshModelCatalog({ force: forceThisCycle || retryingProviderOutage });
      if (!schedulerActive) return;
      if (schedulerForceRequested) {
        forceThisCycle = true;
        continue;
      }
      const delay = getNextModelCatalogDelay(snapshot);
      scheduleModelCatalogTimer(delay);
      logger.info({
        reason,
        checkedAt: snapshot?.checkedAt || null,
        nextRunAt: schedulerNextRunAt,
        retryingProviderOutage,
        intervalHours: snapshot?.intervalHours || 24
      }, 'Autonomous AI model catalogue scheduler planned its next run');
      break;
    } while (schedulerActive);
  } catch (error) {
    logger.warn({ err: error, reason }, 'Autonomous AI model catalogue refresh failed; retry scheduled');
    scheduleModelCatalogTimer(SCHEDULER_RETRY_MS);
  } finally {
    schedulerInFlight = false;
    schedulerForceRequested = false;
  }
}

export async function startModelCatalogScheduler({ refreshAtStartup = true, keepAlive = false, awaitInitialRefresh = false } = {}) {
  await loadCache();
  if (schedulerActive) {
    return { active: true, checkedAt: cachedSnapshot?.checkedAt || null, nextRunAt: schedulerNextRunAt, mode: 'in-process' };
  }
  schedulerActive = true;
  schedulerKeepAlive = Boolean(keepAlive);
  if (refreshAtStartup) {
    if (awaitInitialRefresh) await runScheduledCatalogRefresh('startup');
    else {
      // Non-blocking: WhatsApp startup must not wait for provider metadata APIs.
      void runScheduledCatalogRefresh('startup');
    }
  } else {
    scheduleModelCatalogTimer(getNextModelCatalogDelay(cachedSnapshot));
  }
  return {
    active: true,
    checkedAt: cachedSnapshot?.checkedAt || null,
    nextRunAt: schedulerNextRunAt,
    intervalHours: 24,
    mode: 'in-process'
  };
}

/** Trigger an immediate metadata-only refresh after owner key changes. */
export function triggerModelCatalogRefresh(reason = 'credentials-changed') {
  if (!schedulerActive) return refreshModelCatalog({ force: true });
  return runScheduledCatalogRefresh(reason, { force: true });
}

export function stopModelCatalogScheduler() {
  schedulerActive = false;
  if (schedulerTimer) clearTimeout(schedulerTimer);
  schedulerTimer = null;
  schedulerNextRunAt = null;
  schedulerKeepAlive = false;
}

