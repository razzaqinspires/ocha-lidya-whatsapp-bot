import crypto from 'node:crypto';
import { appendRecord, getRecords } from '../core/database.js';
import { getConfig } from '../core/config.js';
import { logger } from '../core/logger.js';
import { generateWithProvider, getProviderInventory, initializeProviderKeys, getAIMaintenance, setAIMaintenance, providerNames } from './providers.js';
import { AIReplyChainStore, AI_REPLY_CHAIN_LIMITS } from './reply-chain.js';

const SYSTEM_PROMPT = `Kamu adalah Ocha Lidya, asisten WhatsApp yang tanggap, natural, dan akurat. Identitas model publik adalah Nexora-2.0-Flash. Jangan pernah menyebut nama provider, vendor, model internal, endpoint, atau detail kunci API. Jika ditanya model apa yang digunakan, jawab persis: Saya menggunakan Nexora-2.0-Flash. Jangan mengklaim model tersebut sebagai nama vendor eksternal. Jawab dalam bahasa pengguna. Dahulukan jawaban langsung, hindari pembukaan berulang, dan sesuaikan panjang jawaban dengan pertanyaan. Jangan mengarang fakta, jangan mengklaim melakukan tindakan eksternal yang belum dilakukan, dan gunakan konteks percakapan yang tersedia.`;
const DEFAULTS = Object.freeze({
  enabled: true,
  providerOrder: ['groq', 'gemini', 'deepseek', 'openai'],
  models: { gemini: 'gemini-3.8-flash', groq: 'openai/gpt-oss-20b', deepseek: 'deepseek-flash', openai: 'gpt-6-luna' },
  timeoutMs: 3500, totalBudgetMs: 14000,
  maxOutputTokens: 220, temperature: 0.55, historyMessages: 4,
  maxInputChars: 3500, coalesceMs: 80, maxKeyAttempts: 1
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
export function isAIQuotedReply(message) {
  const quotedId = message?.quoted?.key?.id;
  if (!quotedId || !message?.chat) return false;
  return Boolean(aiReplyChain.resolve(message.chat, quotedId).anchor);
}

export function isAITrigger(sock, message, { prefixed = false, hasKnownCommand = false } = {}) {
  if (!message?.body?.trim() || prefixed || hasKnownCommand || message.fromMe) return false;
  // Private chats remain conversational by default. In groups, only an explicit
  // bot mention or a reply to a persisted AI answer can enter the AI lane. The
  // AI anchor cache is warmed before the socket starts accepting messages.
  if (!message.isGroup) return true;
  return mentionIsBot(sock, message.mentionedJid) || isAIQuotedReply(message);
}

function stripBotMention(text) {
  return String(text || '').replace(/@[0-9]{5,20}/g, '').replace(/[ \t]{2,}/g, ' ').trim();
}
function conversationKey(chat, sender) { return `${chat}::${sender}`; }

// Conversation history is warmed once and then served from a bounded in-memory cache.
// The old implementation rescanned the complete event journal for every message.
const historyCache = new Map();
const persistedRoles = new Set();
const aiReplyChain = new AIReplyChainStore();
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
    const [rows, anchorRows] = await Promise.all([
      getRecords({ type: 'ai.turn' }),
      getRecords({ type: 'ai.reply.anchor' })
    ]);
    for (const row of rows) {
      const payload = row.payload || {};
      if (!payload.key || !payload.role || typeof payload.content !== 'string') continue;
      cacheTurn(payload.key, { role: payload.role, content: payload.content });
      if (payload.jobId) {
        persistedRoles.add(`${payload.jobId}:${payload.role}`);
        aiReplyChain.addTurn(payload.jobId, payload.role, payload.content);
      }
    }
    for (const row of anchorRows) aiReplyChain.addAnchor(row.payload || {});
    logger.info({ turns: rows.length, conversations: historyCache.size, replyAnchors: anchorRows.length }, 'AI history and quote-chain caches warmed');
    return { turns: rows.length, conversations: historyCache.size, replyAnchors: anchorRows.length };
  })().catch(error => {
    historyWarmPromise = undefined;
    throw error;
  });
  return historyWarmPromise;
}

async function persistTurn(job, role, content, response = {}, { defer = false } = {}) {
  const marker = `${job.id}:${role}`;
  if (persistedRoles.has(marker)) return;
  // Update hot caches before disk I/O so the next quoted reply can resolve immediately.
  persistedRoles.add(marker);
  cacheTurn(job.key, { role, content });
  aiReplyChain.addTurn(job.id, role, content);
  const write = appendRecord('ai.turn', {
    key: job.key, chat: job.chat, sender: job.sender, role, content,
    ...(response.provider ? { provider: response.provider } : {}),
    ...(response.model ? { model: response.model } : {}),
    jobId: job.id
  });
  if (defer) {
    write.catch(error => { persistedRoles.delete(marker); logger.warn({ err: error, jobId: job.id, role }, 'Deferred AI turn persistence failed'); });
    return;
  }
  await write;
}

async function checkpoint(jobId, status, payload = {}, { defer = false } = {}) {
  const write = appendRecord('ai.job.checkpoint', { jobId, status, ...payload }, { source: 'ai-engine' });
  if (defer) {
    write.catch(error => logger.warn({ err: error, jobId, status }, 'Deferred AI checkpoint persistence failed'));
    return;
  }
  await write;
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
  const deadline = startedAt + Math.max(3500, Number(config.totalBudgetMs) || 14000);
  for (const provider of order) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const providerTimeout = Math.max(1000, Math.min(Number(config.timeoutMs) || 3500, remainingMs));
    try {
      const result = await generateWithProvider(provider, job.messages, {
        models: config.models,
        timeoutMs: providerTimeout,
        maxOutputTokens: config.maxOutputTokens,
        temperature: config.temperature,
        deferTelemetry: true,
        maxKeyAttempts: Math.max(1, Number(config.maxKeyAttempts) || 1),
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

async function persistAIReplyAnchor(anchor) {
  await appendRecord('ai.reply.anchor', anchor, { source: 'ai-engine' });
  aiReplyChain.addAnchor(anchor);
  return anchor;
}

export function resolveAIReplyContext(chat, quotedMessageId) {
  return aiReplyChain.resolve(chat, quotedMessageId);
}

async function answerMessageUnlocked(sock, message) {
  const responseStartedAt = Date.now();
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
  const quotedMessageId = message.quoted?.key?.id || '';
  const parentContext = quotedMessageId ? aiReplyChain.resolve(message.chat, quotedMessageId) : { anchor: null, turns: [], depth: 0, threadId: null };
  const priorTurns = parentContext.turns.length
    ? parentContext.turns.map(({ role, content }) => ({ role, content }))
    : history;
  const quotedContext = message.quoted?.text
    ? `\n\nKutipan yang sedang ditanggapi pengguna:\n${String(message.quoted.text).slice(0, 2500)}` : '';
  const messages = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\nJika ada kutipan, jawab berdasarkan konteks kutipan dan rantai percakapan yang disediakan. Jangan menganggap pesan lain di chat sebagai bagian dari rantai ini.` },
    ...priorTurns,
    { role: 'user', content: `${userText}${quotedContext}` }
  ];
  const id = crypto.randomUUID();
  const canContinueParent = Boolean(parentContext.anchor && parentContext.anchor.depth < AI_REPLY_CHAIN_LIMITS.maxDepth - 1);
  const job = {
    id, chat: message.chat, sender: message.sender, key, messages, userText,
    parentJobId: canContinueParent ? parentContext.anchor.jobId : null,
    threadId: canContinueParent ? parentContext.threadId : id,
    depth: canContinueParent ? parentContext.anchor.depth + 1 : 0,
    createdAt: new Date().toISOString()
  };
  // Disk writes are queued in the background; they must not delay the first provider request.
  void checkpoint(id, 'queued', { job, createdAt: job.createdAt }, { defer: true });
  await persistTurn(job, 'user', userText, {}, { defer: true });

  void setComposing(sock, message.chat, 'composing');
  try {
    const result = await executeWithFallback(job);
    await persistTurn(job, 'assistant', result.text, result, { defer: true });
    void checkpoint(id, 'generated', { provider: result.provider, model: result.model, response: result.text, latencyMs: result.latencyMs }, { defer: true });
    void setComposing(sock, message.chat, 'paused');
    const sentMessage = await message.reply(result.text);
    const sentMessageId = sentMessage?.key?.id;
    if (sentMessageId) {
      try {
        const anchor = {
          chat: message.chat,
          messageId: sentMessageId,
          sender: message.sender,
          jobId: id,
          parentJobId: job.parentJobId,
          threadId: job.threadId,
          depth: job.depth,
          createdAt: new Date().toISOString()
        };
        // Register in memory before asynchronous durable persistence to avoid a reply race.
        aiReplyChain.addAnchor(anchor);
        void appendRecord('ai.reply.anchor', anchor, { source: 'ai-engine' }).catch(anchorError => {
          logger.warn({ err: anchorError, jobId: id, messageId: sentMessageId }, 'AI reply anchor persistence failed');
        });
      } catch (anchorError) {
        logger.warn({ err: anchorError, jobId: id, messageId: sentMessageId }, 'AI reply anchor was sent but could not be persisted');
      }
    } else {
      logger.warn({ jobId: id }, 'AI answer was sent without a message ID; quoted chain anchor unavailable for this turn');
    }
    void checkpoint(id, 'delivered', { deliveredAt: new Date().toISOString(), provider: result.provider, model: result.model, latencyMs: result.latencyMs, replyMessageId: sentMessageId || null }, { defer: true });
    logger.info({ jobId: id, provider: result.provider, model: result.model, providerLatencyMs: result.latencyMs, totalLatencyMs: Date.now() - responseStartedAt, chat: message.chat }, 'AI response delivered');
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
  const waitMs = Math.max(0, Math.min(1000, Number(aiConfig().coalesceMs ?? 120)));
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
      const recoveredMessage = await sock.sendMessage(job.chat, { text: `Pemulihan jawaban tertunda:\n\n${result.text}` });
      const recoveredMessageId = recoveredMessage?.key?.id;
      if (recoveredMessageId) {
        try {
          await persistAIReplyAnchor({
            chat: job.chat,
            messageId: recoveredMessageId,
            sender: job.sender,
            jobId: job.id,
            parentJobId: job.parentJobId || null,
            threadId: job.threadId || job.id,
            depth: Number(job.depth) || 0,
            createdAt: new Date().toISOString()
          });
        } catch (anchorError) {
          logger.warn({ err: anchorError, jobId: job.id, messageId: recoveredMessageId }, 'Recovered AI answer sent but its reply anchor could not be persisted');
        }
      }
      await checkpoint(job.id, 'delivered', { provider: result.provider, model: result.model, resumed: true, replyMessageId: recoveredMessageId || null, completedAt: new Date().toISOString() });
    } catch (error) {
      logger.error({ err: error, jobId: job.id }, 'AI checkpoint recovery failed');
      await checkpoint(job.id, 'failed', { failedAt: new Date().toISOString(), error: error.message });
    }
  }
  if (pending.length) logger.info({ count: pending.length }, 'AI pending checkpoints processed');
}

export function getAIStatus() { return { ...aiConfig(), publicModel: 'Nexora-2.0-Flash', maintenance: getAIMaintenance(), providers: getProviderInventory(aiConfig()) }; }
