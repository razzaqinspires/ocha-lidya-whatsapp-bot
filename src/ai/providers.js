import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { appendRecord, getRecords } from '../core/database.js';
import { logger } from '../core/logger.js';

const VAULT = path.resolve('data/secrets/provider-keys.json');
const PROVIDERS = {
  groq: { env: 'GROQ_API_KEY', baseURL: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-20b', protocol: 'openai-compatible' },
  gemini: { env: 'GEMINI_API_KEY', baseURL: 'https://generativelanguage.googleapis.com/v1beta/models', model: 'gemini-3.8-flash', protocol: 'gemini' },
  deepseek: { env: 'DEEPSEEK_API_KEY', baseURL: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', protocol: 'openai-compatible' },
  openai: { env: 'OPENAI_API_KEY', baseURL: 'https://api.openai.com/v1/chat/completions', model: 'gpt-6-luna', protocol: 'openai-compatible' }
};
const transientStatus = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const keyStats = new Map();
const providerMetrics = new Map();
const providerCircuit = new Map();
const keyRotationCursor = new Map();
let vault = {};
let initialized = false;
let saveQueue = Promise.resolve();
let maintenance = { active: false, since: null, notifiedAt: null, reason: null };
const fingerprint = key => crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
const mask = key => key.length < 10 ? `${key.slice(0, 2)}••••` : `${key.slice(0, 5)}••••••${key.slice(-4)}`;

function errorWithMetadata(error, metadata = {}) {
  // Never mutate provider/native errors: some runtimes expose read-only accessors
  // (notably `code` on fetch TypeError instances).
  const wrapped = new Error(String(error?.message || 'Provider request failed'), { cause: error });
  wrapped.name = String(error?.name || 'Error');
  for (const [key, value] of Object.entries(metadata)) {
    Object.defineProperty(wrapped, key, { value, enumerable: true, configurable: true, writable: true });
  }
  if (Number.isFinite(Number(error?.status))) wrapped.status = Number(error.status);
  if (error?.retryAfter) wrapped.retryAfter = error.retryAfter;
  return wrapped;
}

export const providerNames = Object.freeze(Object.keys(PROVIDERS));
export function normalizeProvider(value) { return String(value || '').trim().toLowerCase(); }
export function isProvider(value) { return Object.hasOwn(PROVIDERS, normalizeProvider(value)); }

async function persistVault() {
  saveQueue = saveQueue.then(async () => {
    await fs.mkdir(path.dirname(VAULT), { recursive: true, mode: 0o700 });
    const temp = `${VAULT}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(vault, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(temp, 0o600);
    await fs.rename(temp, VAULT);
    await fs.chmod(VAULT, 0o600);
  });
  return saveQueue;
}
export async function initializeProviderKeys() {
  if (initialized) return;
  try { vault = JSON.parse(await fs.readFile(VAULT, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') { logger.error({ err: error }, 'Provider key vault unreadable'); throw error; } }
  const keyEvents = await getRecords({ type: 'ai.key.event' });
  for (const row of keyEvents) {
    const event = row.payload || {};
    if (!event.fingerprint) continue;
    const stat = keyStats.get(event.fingerprint) || { fingerprint: event.fingerprint, hits: 0, successes: 0, failures: 0, tokens: 0, status: 'untested', lastHitAt: null, lastSuccessAt: null, lastErrorAt: null, lastHttpStatus: null, reason: null, retryAt: 0, source: 'unknown' };
    if (event.event === 'hit') { stat.hits = Math.max(stat.hits, Number(event.hit || 0)); stat.lastHitAt = row.ts; }
    if (event.event === 'success') { stat.successes++; stat.status = 'active'; stat.reason = null; stat.retryAt = 0; stat.lastSuccessAt = row.ts; stat.tokens += Number(event.tokens || 0); }
    if (event.event === 'failure') { stat.failures++; stat.status = event.status || 'error'; stat.reason = event.reason || null; stat.retryAt = Date.parse(event.retryAt || '') || 0; stat.lastErrorAt = row.ts; stat.lastHttpStatus = event.httpStatus || null; }
    keyStats.set(event.fingerprint, stat);
  }
  const records = await getRecords({ type: 'ai.maintenance' });
  const last = records.at(-1)?.payload;
  if (last?.active) maintenance = { active: true, since: last.since, notifiedAt: last.notifiedAt, reason: last.reason };
  initialized = true;
  for (const provider of providerNames) for (const item of allKeys(provider)) statsFor(item.value).source = item.source;
}
function ensureInit() { if (!initialized) throw new Error('Provider key manager belum diinisialisasi'); }
function allKeys(provider) {
  ensureInit();
  const env = (process.env[PROVIDERS[provider].env] || '').split(/[;,\n]/).map(x => x.trim()).filter(Boolean).map(value => ({ value, source: 'env' }));
  const stored = (vault[provider] || []).map(value => ({ value, source: 'vault' }));
  const seen = new Set();
  return [...env, ...stored].filter(item => { const id = fingerprint(item.value); if (seen.has(id)) return false; seen.add(id); return true; });
}
function statsFor(key) {
  const id = fingerprint(key);
  if (!keyStats.has(id)) keyStats.set(id, { fingerprint: id, hits: 0, successes: 0, failures: 0, tokens: 0, status: 'untested', lastHitAt: null, lastSuccessAt: null, lastErrorAt: null, lastHttpStatus: null, reason: null, retryAt: 0, source: 'unknown' });
  return keyStats.get(id);
}
function retryAtFromProvider(error, fallback) {
  const raw = String(error?.retryAfter || '').trim();
  if (!raw) return fallback;
  const seconds = Number(raw);
  const timestamp = Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : Date.parse(raw);
  return Number.isFinite(timestamp) && timestamp > Date.now() ? timestamp : fallback;
}
function classifyFailure(error) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || '').toLowerCase();
  if (status === 401) {
    const expired = /expired|expiration/.test(message);
    return { status: expired ? 'expired' : 'invalid', permanent: true, retryAt: Date.now() + 6 * 60 * 60_000, reason: expired ? 'provider explicitly reported an expired key' : 'unauthorized / key invalid or revoked' };
  }
  if (status === 403) {
    if (/expired|expiration/.test(message)) return { status: 'expired', permanent: true, retryAt: Date.now() + 6 * 60 * 60_000, reason: 'provider explicitly reported an expired key' };
    if (/revoked|invalid api.?key|api.?key.*invalid/.test(message)) return { status: 'invalid', permanent: true, retryAt: Date.now() + 6 * 60 * 60_000, reason: 'key revoked or rejected' };
    const quota = /quota|daily|billing|limit|exhausted|resource_exhausted/.test(message);
    return quota
      ? { status: 'daily_limit', permanent: false, retryAt: retryAtFromProvider(error, nextUtcDay()), reason: 'provider quota / daily limit' }
      : { status: 'forbidden', permanent: true, retryAt: Date.now() + 60 * 60_000, reason: 'forbidden / permission or project restriction' };
  }
  if (status === 429) {
    const daily = /quota|daily|per.day|resource_exhausted|billing|limit.*exceed/.test(message);
    return daily
      ? { status: 'daily_limit', permanent: false, retryAt: retryAtFromProvider(error, nextUtcDay()), reason: 'daily quota exhausted' }
      : { status: 'rate_limited', permanent: false, retryAt: Date.now() + 30_000, reason: 'temporary rate limit' };
  }
  if (status === 400) return { status: 'request_or_model_error', permanent: false, retryAt: Date.now() + 5 * 60_000, reason: 'bad request or model unsupported; key validity not proven' };
  if (status >= 500 || error?.retryable || error?.code === 'ETIMEDOUT') return { status: 'provider_error', permanent: false, retryAt: Date.now() + 15_000, reason: 'provider/network temporarily unavailable' };
  return { status: 'error', permanent: false, retryAt: Date.now() + 60_000, reason: 'unclassified error' };
}
function nextUtcDay() { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5); }
function isEligible(stat) { return !stat.retryAt || stat.retryAt <= Date.now(); }
function publicKeyInfo(provider, item) {
  const stat = statsFor(item.value);
  return { provider, fingerprint: stat.fingerprint, masked: mask(item.value), source: item.source, ...stat, usableNow: isEligible(stat), probeDue: isEligible(stat) && ['invalid', 'forbidden', 'daily_limit', 'rate_limited', 'provider_error'].includes(stat.status) };
}
export function getProviderInventory(config = {}) {
  return providerNames.map(name => {
    const keys = allKeys(name).map(item => publicKeyInfo(name, item));
    const metrics = providerMetrics.get(name) || {};
    const usable = keys.filter(item => item.usableNow).length;
    return {
      name, model: config.models?.[name] || PROVIDERS[name].model,
      configured: keys.length > 0, keys: keys.length, usableKeys: usable,
      invalidKeys: keys.filter(k => ['invalid', 'expired', 'forbidden'].includes(k.status)).length,
      dailyLimitedKeys: keys.filter(k => k.status === 'daily_limit' && !k.usableNow).length,
      totalHits: keys.reduce((sum, key) => sum + key.hits, 0),
      totalSuccesses: keys.reduce((sum, key) => sum + key.successes, 0),
      totalFailures: keys.reduce((sum, key) => sum + key.failures, 0),
      totalTokens: keys.reduce((sum, key) => sum + key.tokens, 0),
      keyDetails: keys,
      averageLatencyMs: metrics.averageLatencyMs ?? null, lastLatencyMs: metrics.lastLatencyMs ?? null,
      successes: metrics.successes || 0, failures: metrics.failures || 0, lastStatus: metrics.lastStatus || null,
      circuitOpen: (providerCircuit.get(name)?.openUntil || 0) > Date.now()
    };
  });
}
async function persistKeyEvent(provider, key, event, details = {}) {
  const stat = statsFor(key);
  await appendRecord('ai.key.event', { provider, fingerprint: stat.fingerprint, event, ...details }, { source: 'provider-key-manager' });
}
export async function manageApiKeys(action, provider, values = []) {
  ensureInit(); provider = normalizeProvider(provider);
  if (!isProvider(provider)) throw new Error(`Provider tidak valid. Pilihan: ${providerNames.join(', ')}`);
  const keys = Array.isArray(values) ? values : [values];
  if (action === 'add') {
    let added = 0;
    for (const raw of keys) {
      const key = String(raw || '').trim();
      if (key.length < 12 || /[\s,;]/.test(key)) continue;
      const exists = allKeys(provider).some(item => item.value === key);
      if (exists) continue;
      vault[provider] ||= []; vault[provider].push(key); statsFor(key).source = 'vault'; added++;
    }
    if (added) await persistVault();
    return { action, provider, added, total: allKeys(provider).length };
  }
  if (action === 'delete') {
    const wanted = new Set(keys.map(value => String(value || '').trim()).filter(Boolean));
    const before = (vault[provider] || []).length;
    vault[provider] = (vault[provider] || []).filter(key => !wanted.has(key) && !wanted.has(fingerprint(key)));
    const removed = before - vault[provider].length;
    if (removed) await persistVault();
    return { action, provider, removed, note: 'Kunci dari .env tidak dapat dihapus melalui command; hapus dari file .env.' };
  }
  if (action === 'list') return { action, provider, keys: allKeys(provider).map(item => publicKeyInfo(provider, item)) };
  if (action === 'get') {
    const needle = String(keys[0] || '').trim();
    const found = allKeys(provider).find(item => item.value === needle || fingerprint(item.value) === needle || mask(item.value) === needle);
    if (!found) throw new Error('Kunci tidak ditemukan. Gunakan fingerprint dari .apikey list.');
    return { action, provider, key: publicKeyInfo(provider, found) };
  }
  throw new Error('Type harus add, delete, list, atau get.');
}

function providerError(name, status, message, retryAfter) {
  const error = new Error(`${name} HTTP ${status}: ${message}`);
  error.provider = name; error.status = status; error.retryable = transientStatus.has(status); error.retryAfter = retryAfter;
  throw error;
}
async function postJSON(url, headers, body, timeoutMs, provider) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    const raw = await response.text(); let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw: raw.slice(0, 1200) }; }
    if (!response.ok) providerError(provider, response.status, String(data.error?.message || data.message || data.raw || response.statusText).slice(0, 900), response.headers.get('retry-after'));
    return data;
  } catch (error) {
    if (error.name === 'AbortError' || controller.signal.aborted) throw errorWithMetadata(error, { provider, retryable: true, code: 'ETIMEDOUT' });
    if (error instanceof TypeError) throw errorWithMetadata(error, { provider, retryable: true, code: 'NETWORK_ERROR' });
    throw error;
  } finally { clearTimeout(timer); }
}
async function requestWithKey(name, key, model, messages, options) {
  const spec = PROVIDERS[name];
  if (name === 'gemini') {
    const system = messages.find(m => m.role === 'system')?.content || '';
    const contents = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content) }] }));
    const url = `${spec.baseURL}/${encodeURIComponent(model)}:generateContent`;
    const data = await postJSON(url, { 'content-type': 'application/json', 'x-goog-api-key': key }, { systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents, generationConfig: { temperature: options.temperature ?? 0.6, maxOutputTokens: options.maxOutputTokens ?? 500 } }, options.timeoutMs, name);
    const text = (data.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('').trim();
    if (!text) throw Object.assign(new Error(data.promptFeedback?.blockReason || 'Gemini returned empty response'), { provider: name, retryable: true });
    return { text, usage: data.usageMetadata || null };
  }
  const data = await postJSON(spec.baseURL, { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, { model, messages, temperature: options.temperature ?? 0.6, max_tokens: options.maxOutputTokens ?? 500, stream: false }, options.timeoutMs, name);
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw Object.assign(new Error(`${name} returned empty response`), { provider: name, retryable: true });
  return { text: text.trim(), usage: data.usage || null };
}
export async function generateWithProvider(name, messages, options = {}) {
  if (!PROVIDERS[name]) throw new Error(`Provider tidak dikenal: ${name}`);
  const items = allKeys(name);
  if (!items.length) throw Object.assign(new Error(`No API key for ${name}`), { provider: name, code: 'NO_API_KEY' });
  const eligibleAll = items.filter(item => isEligible(statsFor(item.value)));
  const cursor = eligibleAll.length ? (keyRotationCursor.get(name) || 0) % eligibleAll.length : 0;
  const rotated = eligibleAll.length ? [...eligibleAll.slice(cursor), ...eligibleAll.slice(0, cursor)] : [];
  const attemptLimit = Number.isInteger(options.maxKeyAttempts) && options.maxKeyAttempts > 0 ? options.maxKeyAttempts : rotated.length;
  const eligible = rotated.slice(0, attemptLimit);
  if (!eligible.length) throw Object.assign(new Error(`All keys for ${name} are cooling down or exhausted`), { provider: name, code: 'ALL_KEYS_UNAVAILABLE', retryable: true });
  let lastError;
  let attemptsMade = 0;
  for (const item of eligible) {
    attemptsMade++;
    const stat = statsFor(item.value); stat.source = item.source;
    stat.hits++; stat.lastHitAt = new Date().toISOString();
    const recordEvent = (event, details) => {
      const write = persistKeyEvent(name, item.value, event, details);
      if (options.deferTelemetry) write.catch(error => logger.warn({ err: error, provider: name, event }, 'Deferred AI telemetry write failed'));
      return options.deferTelemetry ? undefined : write;
    };
    await recordEvent('hit', { hit: stat.hits });
    const started = Date.now();
    try {
      const result = await requestWithKey(name, item.value, options.models?.[name] || PROVIDERS[name].model, messages, options);
      const elapsed = Date.now() - started; stat.successes++; stat.status = 'active'; stat.reason = null; stat.retryAt = 0; stat.lastSuccessAt = new Date().toISOString();
      stat.tokens += Number(result.usage?.total_tokens || result.usage?.totalTokenCount || 0);
      const pm = providerMetrics.get(name) || { successes: 0, failures: 0, averageLatencyMs: null };
      pm.successes++; pm.lastLatencyMs = elapsed; pm.averageLatencyMs = pm.averageLatencyMs == null ? elapsed : Math.round(pm.averageLatencyMs * .75 + elapsed * .25); pm.lastStatus = 'ok'; providerMetrics.set(name, pm);
      await recordEvent('success', { latencyMs: elapsed, tokens: Number(result.usage?.total_tokens || result.usage?.totalTokenCount || 0) });
      providerCircuit.set(name, { failures: 0, openUntil: 0 });
      if (eligibleAll.length) keyRotationCursor.set(name, (cursor + attemptsMade) % eligibleAll.length);
      return { ...result, provider: name, model: options.publicModel || 'Nexora-2.0-Flash', keyFingerprint: stat.fingerprint, latencyMs: elapsed };
    } catch (error) {
      lastError = error; const classified = classifyFailure(error);
      stat.failures++; stat.status = classified.status; stat.reason = classified.reason; stat.retryAt = classified.retryAt; stat.lastErrorAt = new Date().toISOString(); stat.lastHttpStatus = error.status || null;
      const pm = providerMetrics.get(name) || { successes: 0, failures: 0, averageLatencyMs: null };
      pm.failures++; pm.lastLatencyMs = Date.now() - started; pm.lastStatus = classified.status; providerMetrics.set(name, pm);
      await recordEvent('failure', { status: classified.status, httpStatus: error.status || null, reason: classified.reason, retryAt: new Date(classified.retryAt).toISOString() });
      logger.warn({ provider: name, fingerprint: stat.fingerprint, status: classified.status, httpStatus: error.status, reason: classified.reason }, 'API key failed; rotating to another key for the same provider only');
      // A bad model/request is not evidence that the key is invalid; avoid burning all keys on identical malformed payloads.
      if (classified.status === 'request_or_model_error') break;
    }
  }
  if (eligibleAll.length && attemptsMade) keyRotationCursor.set(name, (cursor + attemptsMade) % eligibleAll.length);
  const finalError = new Error(String(lastError?.message || `${name}: no usable API key`), { cause: lastError });
  finalError.provider = name;
  finalError.code = String(lastError?.code || 'PROVIDER_KEYS_EXHAUSTED');
  if (Number.isFinite(Number(lastError?.status))) finalError.status = Number(lastError.status);
  finalError.retryable = Boolean(lastError?.retryable);
  throw finalError;
}
export async function getKeyManagerStatus() {
  const records = await getRecords({ type: 'ai.key.event' });
  return { providers: getProviderInventory(), maintenance, recentEvents: records.slice(-30).map(r => ({ ts: r.ts, ...r.payload })) };
}
export async function setAIMaintenance(active, details = {}) {
  maintenance = active ? { active: true, since: maintenance.since || new Date().toISOString(), notifiedAt: details.notifiedAt || maintenance.notifiedAt, reason: details.reason || 'all provider keys unavailable' } : { active: false, since: null, notifiedAt: null, reason: null };
  await appendRecord('ai.maintenance', { ...maintenance }, { source: 'provider-key-manager' });
  return maintenance;
}
export function getAIMaintenance() { return { ...maintenance }; }
