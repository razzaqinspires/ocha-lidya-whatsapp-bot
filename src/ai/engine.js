import crypto from 'node:crypto';
import { appendRecord, getRecords } from '../core/database.js';
import { getConfig } from '../core/config.js';
import { logger } from '../core/logger.js';
import { generateWithProvider, getProviderInventory } from './providers.js';

const SYSTEM_PROMPT = `Kamu adalah Ocha Lidya, asisten percakapan WhatsApp yang cerdas, jelas, adaptif, dan sopan. Jawab dalam bahasa yang digunakan lawan bicara; utamakan bahasa Indonesia yang natural. Pahami konteks percakapan, jangan mengarang fakta, akui ketidakpastian, dan jangan mengklaim telah melakukan tindakan eksternal yang belum dilakukan. Jawaban WhatsApp harus terstruktur secukupnya, tidak bertele-tele, dan tidak memakai Markdown tabel kecuali benar-benar diperlukan.`;
const DEFAULTS = Object.freeze({
  enabled: true,
  providerOrder: ['gemini', 'groq', 'qwen', 'deepseek', 'openai'],
  models: { gemini: 'gemini-3.6-flash', groq: 'openai/gpt-oss-120b', qwen: 'qwen3.8-flash', deepseek: 'deepseek-flash', openai: 'gpt-6-luna' },
  timeoutMs: 35_000, maxOutputTokens: 1200, temperature: 0.7, historyMessages: 16,
  maxInputChars: 10_000, retryPerProvider: 1
});

function aiConfig() { return { ...DEFAULTS, ...(getConfig().ai || {}), models: { ...DEFAULTS.models, ...(getConfig().ai?.models || {}) } }; }
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


async function persistTurnsOnce(job, response) {
  const existing = await getRecords({ type: 'ai.turn', predicate: row => row.payload?.jobId === job.id });
  if (!existing.some(row => row.payload.role === 'user')) {
    await appendRecord('ai.turn', { key: job.key, chat: job.chat, sender: job.sender, role: 'user', content: job.userText, jobId: job.id });
  }
  if (!existing.some(row => row.payload.role === 'assistant')) {
    await appendRecord('ai.turn', { key: job.key, chat: job.chat, sender: job.sender, role: 'assistant', content: response.text, provider: response.provider, model: response.model, jobId: job.id });
  }
}

async function loadHistory(chat, sender, limit) {
  const rows = await getRecords({ type: 'ai.turn' });
  return rows.filter(row => row.payload?.key === conversationKey(chat, sender))
    .slice(-limit).map(row => ({ role: row.payload.role, content: row.payload.content }));
}
const jobCache = new Map();
async function checkpoint(jobId, status, payload = {}) {
  if (payload.job) jobCache.set(jobId, payload.job);
  const job = payload.job || jobCache.get(jobId);
  await appendRecord('ai.job.checkpoint', { jobId, status, ...(job ? { job } : {}), ...payload }, { source: 'ai-engine' });
  if (status === 'delivered' || status === 'failed') jobCache.delete(jobId);
}
function retryDelay(error) {
  const seconds = Number(error.retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 5000);
  return 350;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function executeWithFallback(job, { onComplete } = {}) {
  jobCache.set(job.id, job);
  const config = aiConfig();
  const inventory = getProviderInventory(config);
  const available = new Set(inventory.filter(provider => provider.configured).map(provider => provider.name));
  const order = (config.providerOrder || DEFAULTS.providerOrder).filter(name => available.has(name));
  if (!order.length) throw new Error('Belum ada API key AI yang dikonfigurasi. Isi minimal GEMINI_API_KEY atau GROQ_API_KEY di .env.');

  const errors = [];
  for (const provider of order) {
    const maxAttempts = Math.max(1, Number(config.retryPerProvider) + 1);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await checkpoint(job.id, 'attempting', { provider, attempt, updatedAt: new Date().toISOString() });
      try {
        const result = await generateWithProvider(provider, job.messages, {
          models: config.models, timeoutMs: config.timeoutMs,
          maxOutputTokens: config.maxOutputTokens, temperature: config.temperature
        });
        await checkpoint(job.id, 'generated', { provider, model: result.model, usage: result.usage, response: result.text });
        await onComplete?.(result);
        await checkpoint(job.id, 'ready_to_deliver', { provider, model: result.model, response: result.text });
        return result;
      } catch (error) {
        errors.push({ provider, attempt, message: error.message, status: error.status, code: error.code });
        await checkpoint(job.id, 'provider_failed', { provider, attempt, error: error.message, retryable: Boolean(error.retryable) });
        if (!(error.retryable || error.keyRejected) || attempt >= maxAttempts) break;
        await sleep(retryDelay(error));
      }
    }
  }
  await checkpoint(job.id, 'failed', { errors, failedAt: new Date().toISOString() });
  const summary = errors.map(error => `${error.provider}: ${error.message}`).join(' | ');
  throw new Error(`Semua provider AI gagal. ${summary}`);
}

export async function answerMessage(sock, message) {
  const config = aiConfig();
  if (!config.enabled) return message.reply('Layanan AI sedang dinonaktifkan.');
  const userText = stripBotMention(message.body).slice(0, config.maxInputChars);
  if (!userText) return message.reply('Ada yang ingin kamu tanyakan?');

  const key = conversationKey(message.chat, message.sender);
  const history = await loadHistory(message.chat, message.sender, config.historyMessages);
  const quotedContext = message.isGroup && message.quoted?.text
    ? `\n\nPesan yang dibalas: ${String(message.quoted.text).slice(0, 3000)}` : '';
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: `${userText}${quotedContext}` }
  ];
  const id = crypto.randomUUID();
  const job = { id, chat: message.chat, sender: message.sender, key, messages, userText, createdAt: new Date().toISOString() };
  await checkpoint(id, 'queued', { job, createdAt: job.createdAt });

  try {
    const result = await executeWithFallback(job, {
      onComplete: async response => persistTurnsOnce(job, response)
    });
    await message.reply(result.text);
    await checkpoint(id, 'delivered', { deliveredAt: new Date().toISOString(), provider: result.provider, model: result.model });
    logger.info({ jobId: id, provider: result.provider, model: result.model, chat: message.chat }, 'AI response delivered');
    return result;
  } catch (error) {
    logger.error({ err: error, jobId: id, chat: message.chat }, 'AI request exhausted all providers');
    return message.reply('Layanan AI sedang mengalami gangguan pada semua provider. Status percobaan sudah disimpan. Kirim ulang pesan ini untuk membuat percobaan baru setelah provider pulih.');
  }
}

/** Resume unfinished jobs after a process restart. Delivery is at-least-once if a crash occurs during WhatsApp send. */
export async function resumePendingAI(sock) {
  const rows = await getRecords({ type: 'ai.job.checkpoint' });
  const latest = new Map();
  for (const row of rows) latest.set(row.payload.jobId, row.payload);
  const pending = [...latest.values()].filter(state => ['queued', 'attempting', 'provider_failed', 'generated', 'ready_to_deliver'].includes(state.status) && state.job?.messages);
  for (const state of pending) {
    const job = state.job;
    try {
      const result = state.response && ['generated', 'ready_to_deliver'].includes(state.status)
        ? { text: state.response, provider: state.provider, model: state.model }
        : await executeWithFallback(job);
      await persistTurnsOnce(job, result);
      await sock.sendMessage(job.chat, { text: `Pemulihan jawaban tertunda:\n\n${result.text}` });
      await checkpoint(job.id, 'delivered', { provider: result.provider, model: result.model, resumed: true, completedAt: new Date().toISOString() });
    } catch (error) {
      logger.error({ err: error, jobId: job.id }, 'AI checkpoint recovery failed');
    }
  }
  if (pending.length) logger.info({ count: pending.length }, 'AI pending checkpoints processed');
}

export function getAIStatus() { return { ...aiConfig(), providers: getProviderInventory(aiConfig()) }; }
