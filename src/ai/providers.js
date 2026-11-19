import { logger } from '../core/logger.js';

const PROVIDERS = {
  groq: { env: 'GROQ_API_KEY', baseURL: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-120b' },
  openai: { env: 'OPENAI_API_KEY', baseURL: 'https://api.openai.com/v1/chat/completions', model: 'gpt-6-luna' },
  qwen: { env: 'QWEN_API_KEY', baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen3.8-flash' },
  deepseek: { env: 'DEEPSEEK_API_KEY', baseURL: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash' },
  gemini: { env: 'GEMINI_API_KEY', baseURL: 'https://generativelanguage.googleapis.com/v1beta/models', model: 'gemini-3.6-flash' }
};
const keyCursor = new Map();
const circuit = new Map();
const transientStatus = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function getKeys(name) {
  return (process.env[PROVIDERS[name].env] || '').split(/[;,\n]/).map(value => value.trim()).filter(Boolean);
}
function nextKey(name) {
  const keys = getKeys(name);
  if (!keys.length) return null;
  const index = keyCursor.get(name) || 0;
  keyCursor.set(name, (index + 1) % keys.length);
  return keys[index % keys.length];
}
export function getProviderInventory(config = {}) {
  return Object.entries(PROVIDERS).map(([name, spec]) => ({ name, model: config.models?.[name] || spec.model, configured: getKeys(name).length > 0, keys: getKeys(name).length, circuitOpen: (circuit.get(name)?.openUntil || 0) > Date.now() }));
}
function providerError(name, status, message, retryAfter) {
  const error = new Error(`${name} HTTP ${status}: ${message}`);
  error.provider = name; error.status = status; error.retryable = transientStatus.has(status); error.keyRejected = status === 401 || status === 403; error.retryAfter = retryAfter;
  return error;
}
async function postJSON(url, headers, body, timeoutMs, provider) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw: raw.slice(0, 1000) }; }
    if (!response.ok) throw providerError(provider, response.status, String(data.error?.message || data.message || data.raw || response.statusText).slice(0, 600), response.headers.get('retry-after'));
    return data;
  } catch (error) {
    if (error.name === 'AbortError' || controller.signal.aborted) Object.assign(error, { provider, retryable: true, code: 'ETIMEDOUT' });
    if (error instanceof TypeError) Object.assign(error, { provider, retryable: true });
    throw error;
  } finally { clearTimeout(timer); }
}
async function requestOpenAICompatible(name, model, messages, options) {
  const spec = PROVIDERS[name]; const key = nextKey(name);
  if (!key) throw Object.assign(new Error(`API key ${spec.env} belum diatur`), { provider: name, retryable: false, code: 'NO_API_KEY' });
  const data = await postJSON(spec.baseURL, { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, {
    model, messages, temperature: options.temperature ?? 0.7, max_tokens: options.maxOutputTokens ?? 1200, stream: false
  }, options.timeoutMs, name);
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw Object.assign(new Error(`${name} mengembalikan jawaban kosong`), { provider: name, retryable: true });
  return { text: text.trim(), usage: data.usage || null, model: data.model || model, provider: name };
}
async function requestGemini(model, messages, options) {
  const key = nextKey('gemini');
  if (!key) throw Object.assign(new Error('API key GEMINI_API_KEY belum diatur'), { provider: 'gemini', retryable: false, code: 'NO_API_KEY' });
  const system = messages.find(message => message.role === 'system')?.content || '';
  const contents = messages.filter(message => message.role !== 'system').map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(message.content) }] }));
  const url = `${PROVIDERS.gemini.baseURL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const data = await postJSON(url, { 'content-type': 'application/json' }, {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents,
    generationConfig: { temperature: options.temperature ?? 0.7, maxOutputTokens: options.maxOutputTokens ?? 1200 }
  }, options.timeoutMs, 'gemini');
  const text = (data.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('').trim();
  if (!text) throw Object.assign(new Error(data.promptFeedback?.blockReason || 'Gemini mengembalikan jawaban kosong'), { provider: 'gemini', retryable: true });
  return { text, usage: data.usageMetadata || null, model, provider: 'gemini' };
}
export async function generateWithProvider(name, messages, options = {}) {
  if (!PROVIDERS[name]) throw new Error(`Provider tidak dikenal: ${name}`);
  const state = circuit.get(name) || { failures: 0, openUntil: 0 };
  if (state.openUntil > Date.now()) throw Object.assign(new Error(`Circuit breaker ${name} aktif sementara`), { provider: name, retryable: true, code: 'CIRCUIT_OPEN' });
  const model = options.models?.[name] || PROVIDERS[name].model;
  try {
    const result = name === 'gemini' ? await requestGemini(model, messages, options) : await requestOpenAICompatible(name, model, messages, options);
    circuit.set(name, { failures: 0, openUntil: 0 }); return result;
  } catch (error) {
    const failures = state.failures + 1;
    circuit.set(name, { failures, openUntil: failures >= 3 && error.retryable ? Date.now() + 60_000 : 0 });
    logger.warn({ provider: name, status: error.status, retryable: error.retryable, failures, error: error.message }, 'AI provider attempt failed');
    throw error;
  }
}
export const providerNames = Object.freeze(Object.keys(PROVIDERS));
