import crypto from 'node:crypto';
import { appendRecord, getRecords } from '../core/database.js';
import { getConfig } from '../core/config.js';
import { logger } from '../core/logger.js';
import { generateWithProvider, getProviderInventory, initializeProviderKeys, getAIMaintenance, setAIMaintenance, providerNames } from './providers.js';

const SYSTEM_PROMPT = `Kamu adalah Ocha Lidya, asisten WhatsApp yang tanggap, natural, dan akurat. Identitas model publik adalah Nexora-2.0-Flash. Jangan pernah menyebut nama provider, vendor, model internal, endpoint, atau detail kunci API. Jika ditanya model apa yang digunakan, jawab persis: Saya menggunakan Nexora-2.0-Flash. Jangan mengklaim model tersebut sebagai nama vendor eksternal. Jawab dalam bahasa pengguna. Dahulukan jawaban langsung, hindari pembukaan berulang, dan sesuaikan panjang jawaban dengan pertanyaan. Jangan mengarang fakta, jangan mengklaim melakukan tindakan eksternal yang belum dilakukan, dan gunakan konteks percakapan yang tersedia.`;
const DEFAULTS = Object.freeze({
  enabled: true,
  providerOrder: ['groq', 'gemini', 'deepseek', 'openai'],
  models: { gemini: 'gemini-3.8-flash', groq: 'openai/gpt-oss-20b', deepseek: 'deepseek-flash', openai: 'gpt-6-luna' },
  timeoutMs: 7000, totalBudgetMs: 45000,
  maxOutputTokens: 320, temperature: 0.6, historyMessages: 6,
  maxInputChars: 6000, coalesceMs: 350
});

function aiConfig() {
  const config = getConfig().ai || {};
  return { ...DEFAULTS, ...config, models: { ...DEFAULTS.models, ...(config.models || {}) } };
}
function canonicalJid(value, sock) {
  if (!value || typeof value !== 'string') return '';
  try { return sock.decodeJid?.(value) || value; } catch { return value; }
}
function botJids(sock) {
  const user = sock.user || {};
  return new Set([user.id, user.lid, user.phoneNumber, user.jid].filter(Boolean).map(value => canonicalJid(value, sock)));
}
function mentionIsBot(sock, mentioned = []) {
  const own = botJids(sock);
  return mentioned.some(jid => own.has(canonicalJid(jid, sock)));
}
function isReplyToBot(sock, message) {
  if (!message.quoted) return false;
  if (message.quoted.fromMe === true) return true;
  const own = botJids(sock);
  return own.has(canonicalJid(message.quoted.sender, sock));
}

export function isAITrigger(sock, message, { prefixed = false, hasKnownCommand = false } = {}) {
  if (!message?.body?.trim() || prefixed || hasKnownCommand || message.fromMe) return false;
  if (!message.isGroup) return true;
  return mentionIsBot(sock, message.mentionedJid) || isReplyToBot(sock, message);
}

function stripBotMention(text) {
  return String(text || '').replace(/@[0-9]{5,20}/g, '').replace(/[ \t]{2,}/g, ' ').trim();
}
function conversationKey(chat, sender) { return `${chat}::${sender}`; }

// Conversation history is warmed once and then served from a bounded in-memory cache.
// The old implementation rescanned the complete event journal for every message.
const historyCache = new Map();
const persistedRoles = new Set();
let historyWarmPromise;
const MAX_CACHED_CONVERSATIONS = 2500;
const MAX_CACHED_TURNS = 40;

function cacheTurn(key, turn) {
  let turns = historyCache.get(key);
  if (!turns) turns = [];
  turns.push(turn);
  if (turns.length > MAX_CACHED_TURNS) turns.splice(0, turns.length - MAX_CACHED_TURNS);
  historyCache.delete(key);
  historyCache.set(key, turns);
  while (historyCache.size > MAX_CACHED_CONVERSATIONS) historyCache.delete(historyCache.keys().next().value);
}

export async function initializeAIHistoryCache() {
  if (historyWarmPromise) return historyWarmPromise;
  historyWarmPromise = (async () => {
    const rows = await getRecords({ type: 'ai.turn' });
    for (const row of rows) {
      const payload = row.payload || {};
      if (!payload.key || !payload.role || typeof payload.content !== 'string') continue;
      cacheTurn(payload.key, { role: payload.role, content: payload.content });
      if (payload.jobId) persistedRoles.add(`${payload.jobId}:${payload.role}`);
    }
    logger.info({ turns: rows.length, conversations: historyCache.size }, 'AI history cache warmed');
    return { turns: rows.length, conversations: historyCache.size };
  })().catch(error => {
    historyWarmPromise = undefined;
    throw error;
  });
  return historyWarmPromise;
}

async function persistTurn(job, role, content, response = {}) {
  const marker = `${job.id}:${role}`;
  if (persistedRoles.has(marker)) return;
  await appendRecord('ai.turn', {
    key: job.key, chat: job.chat, sender: job.sender, role, content,
    ...(response.provider ? { provider: response.provider } : {}),
    ...(response.model ? { model: response.model } : {}),
    jobId: job.id
  });
  persistedRoles.add(marker);
  cacheTurn(job.key, { role, content });
}

async function checkpoint(jobId, status, payload = {}) {
  await appendRecord('ai.job.checkpoint', { jobId, status, ...payload }, { source: 'ai-engine' });
}
async function executeWithFallback(job) {
  await initializeProviderKeys();
  const config = aiConfig();
  const inventory = getProviderInventory(config);
  const available = new Set(inventory.filter(provider => provider.configured).map(provider => provider.name));
  const preferred = (config.providerOrder || DEFAULTS.providerOrder).filter(name => providerNames.includes(name));
  const completeOrder = [...preferred, ...providerNames.filter(name => !preferred.includes(name))];
  const order = completeOrder.filter(name => available.has(name));
  if (!order.length) throw Object.assign(new Error('Tidak ada API key AI yang dikonfigurasi.'), { code: 'ALL_PROVIDERS_EXHAUSTED', providerErrors: [{ provider: 'all', code: 'NO_API_KEYS', message: 'No provider credentials configured' }] });

  const startedAt = Date.now();
  const errors = [];
  for (const provider of order) {
    // Exhaust every eligible key/provider. totalBudgetMs is advisory only; it never truncates the fallback chain.
    const providerTimeout = config.timeoutMs;
    try {
      const result = await generateWithProvider(provider, job.messages, {
        models: config.models,
        timeoutMs: providerTimeout,
        maxOutputTokens: config.maxOutputTokens,
        temperature: config.temperature,
        publicModel: 'Nexora-2.0-Flash'
      });
      if (getAIMaintenance().active) await setAIMaintenance(false);
      return { ...result, model: 'Nexora-2.0-Flash', latencyMs: Date.now() - startedAt };
    } catch (error) {
      errors.push({ provider, message: error.message, status: error.status, code: error.code });
      logger.warn({ jobId: job.id, provider, status: error.status, retryable: error.retryable, code: error.code }, 'AI provider exhausted; continuing to next provider');
    }
  }
  throw Object.assign(new Error(`Semua provider AI gagal dalam ${Date.now() - startedAt}ms. ${errors.map(error => `${error.provider}: ${error.message}`).join(' | ')}`), { providerErrors: errors, code: 'ALL_PROVIDERS_EXHAUSTED' });
}

const conversationQueues = new Map();
function enqueueConversation(key, operation) {
  const previous = conversationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  conversationQueues.set(key, current);
  return current.finally(() => {
    if (conversationQueues.get(key) === current) conversationQueues.delete(key);
  });
}

async function setComposing(sock, chat, state) {
  try { await sock.sendPresenceUpdate(state, chat); } catch {}
}

async function notifyOwnerMaintenance(sock, error) {
  const config = getConfig();
  const owner = String(config.bot?.owner || '').replace(/\D/g, '');
  if (!owner) return;
  const status = getProviderInventory(aiConfig());
  const summary = status.map(provider => {
    const details = provider.keyDetails.map(key => `  • ${key.masked} [${key.fingerprint}] ${key.status}; hit ${key.hits}; ok ${key.successes}; fail ${key.failures}; ${key.reason || '—'}${key.retryAt ? `; retry ${new Date(key.retryAt).toISOString()}` : ''}`).join('\n');
    return `${provider.name}: total key ${provider.keys}, usable ${provider.usableKeys}, hits ${provider.totalHits}, success ${provider.totalSuccesses}, fail ${provider.totalFailures}, tokens ${provider.totalTokens}\n${details || '  (tidak ada key)'}`;
  }).join('\n\n');
  const totals = status.reduce((acc, item) => ({ keys: acc.keys + item.keys, hits: acc.hits + item.totalHits, successes: acc.successes + item.totalSuccesses, failures: acc.failures + item.totalFailures, tokens: acc.tokens + item.totalTokens }), { keys: 0, hits: 0, successes: 0, failures: 0, tokens: 0 });
  const report = `OCHA LIDYA — AI MAINTENANCE\nSeluruh key/provider yang dikonfigurasi telah dicoba dan tidak ada jalur yang dapat dipakai. Chat AI ditutup sementara; pesan pengguna tidak dibalas.\nWaktu: ${new Date().toISOString()}\nPenyebab: ${String(error?.message || 'all keys unavailable').slice(0, 1200)}\nTotal seluruh provider: ${totals.keys} key · ${totals.hits} hit · ${totals.successes} sukses · ${totals.failures} gagal · ${totals.tokens} token terlapor\n\nRINGKASAN KEY\n${summary}\n\nCatatan: status 401/403/429 diklasifikasikan dari respons provider; 400 tidak dianggap bukti key invalid. Key yang cooldown akan diuji ulang saat retryAt tercapai.`;
  const chunks = [];
  let chunk = '';
  for (const line of report.split('\n')) {
    if (chunk.length + line.length + 1 > 3500 && chunk) { chunks.push(chunk); chunk = ''; }
    chunk += `${chunk ? '\n' : ''}${line}`;
  }
  if (chunk) chunks.push(chunk);
  try {
    for (const part of chunks) await sock.sendMessage(`${owner}@s.whatsapp.net`, { text: part });
    return true;
  } catch (sendError) {
    logger.error({ err: sendError }, 'Unable to send AI maintenance report to owner');
    return false;
  }
}

async function answerMessageUnlocked(sock, message) {
  const config = aiConfig();
  if (!config.enabled) return message.reply('Layanan AI sedang dinonaktifkan.');
  const userText = stripBotMention(message.body).slice(0, config.maxInputChars);
  if (!userText) return message.reply('Ada yang ingin kamu tanyakan?');
  if (!getAIMaintenance().active && /((model|llm).{0,40}(apa|what|which))|(\bapa\b.{0,30}\bmodel\b)|(kamu.{0,40}(menggunakan|pakai).{0,30}(model|ai))|(model.{0,30}(yang|dipakai|digunakan))/i.test(userText)) {
    const identity = 'Saya menggunakan Nexora-2.0-Flash.';
    await message.reply(identity);
    return { provider: 'nexora', model: 'Nexora-2.0-Flash', text: identity };
  }

  await initializeAIHistoryCache();
  const key = conversationKey(message.chat, message.sender);
  const history = (historyCache.get(key) || []).slice(-config.historyMessages);
  const quotedContext = message.isGroup && message.quoted?.text
    ? `\n\nPesan yang dibalas: ${String(message.quoted.text).slice(0, 2000)}` : '';
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: `${userText}${quotedContext}` }
  ];
  const id = crypto.randomUUID();
  const job = { id, chat: message.chat, sender: message.sender, key, messages, userText, createdAt: new Date().toISOString() };
  await checkpoint(id, 'queued', { job, createdAt: job.createdAt });
  await persistTurn(job, 'user', userText);

  await setComposing(sock, message.chat, 'composing');
  try {
    const result = await executeWithFallback(job);
    await persistTurn(job, 'assistant', result.text, result);
    await checkpoint(id, 'generated', { provider: result.provider, model: result.model, response: result.text, latencyMs: result.latencyMs });
    await setComposing(sock, message.chat, 'paused');
    await message.reply(result.text);
    await checkpoint(id, 'delivered', { deliveredAt: new Date().toISOString(), provider: result.provider, model: result.model, latencyMs: result.latencyMs });
    logger.info({ jobId: id, provider: result.provider, model: result.model, latencyMs: result.latencyMs, chat: message.chat }, 'AI response delivered');
    return result;
  } catch (error) {
    await setComposing(sock, message.chat, 'paused');
    logger.error({ err: error, jobId: id, chat: message.chat }, 'AI request exhausted all providers');
    await checkpoint(id, 'failed', { failedAt: new Date().toISOString(), error: error.message });
    if (error.code === 'ALL_PROVIDERS_EXHAUSTED' || error.providerErrors) {
      const state = await setAIMaintenance(true, { reason: 'all provider keys unavailable' });
      if (!state.notifiedAt) {
        const notified = await notifyOwnerMaintenance(sock, error);
        if (notified) await setAIMaintenance(true, { reason: 'all provider keys unavailable', notifiedAt: new Date().toISOString() });
      }
      return null; // Silent maintenance: do not send any reply to the user.
    }
    return null;
  }
}

const pendingTurns = new Map();

/** Coalesce adjacent short messages from the same sender for one quick answer. */
export function answerMessage(sock, message) {
  const key = conversationKey(message.chat, message.sender);
  const waitMs = Math.max(0, Math.min(2000, Number(aiConfig().coalesceMs ?? 350)));
  return new Promise((resolve, reject) => {
    let pending = pendingTurns.get(key);
    if (!pending) {
      pending = { messages: [], resolvers: [], timer: null, sock };
      pendingTurns.set(key, pending);
    }
    pending.messages.push(message);
    pending.resolvers.push({ resolve, reject });
    clearTimeout(pending.timer);
    pending.timer = setTimeout(async () => {
      if (pendingTurns.get(key) !== pending) return;
      pendingTurns.delete(key);
      const latest = pending.messages.at(-1);
      const combinedBody = pending.messages
        .map(item => String(item.body || '').trim())
        .filter(Boolean)
        .join('\n')
        .slice(0, aiConfig().maxInputChars);
      const merged = { ...latest, body: combinedBody };
      try {
        const result = await enqueueConversation(key, () => answerMessageUnlocked(sock, merged));
        for (const item of pending.resolvers) item.resolve(result);
      } catch (error) {
        for (const item of pending.resolvers) item.reject(error);
      }
    }, waitMs);
  });
}

/** Resume only generated/queued work with bounded provider attempts. */
export async function resumePendingAI(sock) {
  await initializeAIHistoryCache();
  const rows = await getRecords({ type: 'ai.job.checkpoint' });
  const latest = new Map();
  for (const row of rows) latest.set(row.payload.jobId, row.payload);
  const pending = [...latest.values()].filter(state => ['queued', 'generated'].includes(state.status) && state.job?.messages);
  for (const state of pending) {
    const job = state.job;
    try {
      let result;
      if (state.status === 'generated' && state.response) result = { text: state.response, provider: state.provider, model: state.model };
      else result = await executeWithFallback(job);
      await persistTurn(job, 'user', job.userText);
      await persistTurn(job, 'assistant', result.text, result);
      await sock.sendMessage(job.chat, { text: `Pemulihan jawaban tertunda:\n\n${result.text}` });
      await checkpoint(job.id, 'delivered', { provider: result.provider, model: result.model, resumed: true, completedAt: new Date().toISOString() });
    } catch (error) {
      logger.error({ err: error, jobId: job.id }, 'AI checkpoint recovery failed');
      await checkpoint(job.id, 'failed', { failedAt: new Date().toISOString(), error: error.message });
    }
  }
  if (pending.length) logger.info({ count: pending.length }, 'AI pending checkpoints processed');
}

export function getAIStatus() { return { ...aiConfig(), publicModel: 'Nexora-2.0-Flash', maintenance: getAIMaintenance(), providers: getProviderInventory(aiConfig()) }; }
