import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getRuntimeConfigPath, getRuntimeSettings } from '../../core/runtime-settings.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function credentials() {
  const email = String(process.env.CHATNIVO_EMAIL || '').trim();
  const password = String(process.env.CHATNIVO_PASSWORD || '');
  if (!email || !password) {
    const error = new Error(
      'Kredensial ChatNivo belum dikonfigurasi. Isi CHATNIVO_EMAIL dan CHATNIVO_PASSWORD pada .env.',
    );
    error.code = 'CHATNIVO_CREDENTIALS_MISSING';
    error.status = null;
    error.retryable = false;
    throw error;
  }
  return { email, password };
}

function baseUrl(value = getRuntimeSettings().chatnivo.baseUrl) {
  const parsed = new URL(String(value || ''));
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('ChatNivo base URL harus HTTPS dan tidak boleh memiliki kredensial, query, atau fragment.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function endpoint(root, route) {
  return `${root}${route.startsWith('/') ? route : `/${route}`}`;
}

async function requestJson(url, { method = 'GET', token, body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = Math.max(1000, Math.min(180_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const headers = { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const error = new Error(`ChatNivo HTTP ${response.status} pada ${new URL(url).pathname}.`);
      error.name = 'ChatNivoRequestError';
      error.code =
        response.status === 401 || response.status === 403
          ? 'CHATNIVO_AUTH_REJECTED'
          : response.status === 429
            ? 'CHATNIVO_RATE_LIMITED'
            : response.status >= 500
              ? 'CHATNIVO_SERVICE_ERROR'
              : 'CHATNIVO_REQUEST_REJECTED';
      error.status = response.status;
      error.retryAfter = response.headers?.get?.('retry-after') || null;
      error.retryable = RETRYABLE_STATUSES.has(response.status);
      throw error;
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      const timeoutError = new Error('Permintaan ke ChatNivo melewati batas waktu.');
      timeoutError.name = 'ChatNivoTimeoutError';
      timeoutError.code = 'CHATNIVO_TIMEOUT';
      timeoutError.status = null;
      timeoutError.retryable = true;
      throw timeoutError;
    }
    if (error instanceof TypeError && !error.code) {
      const networkError = new Error('ChatNivo tidak dapat dijangkau melalui jaringan.');
      networkError.code = 'CHATNIVO_NETWORK_ERROR';
      networkError.status = null;
      networkError.retryable = true;
      throw networkError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function signIn({ timeoutMs, url }) {
  const { email, password } = credentials();
  const data = await requestJson(endpoint(url, '/api/v1/auths/signin'), {
    method: 'POST',
    body: { email, password },
    timeoutMs,
  });
  if (data?.next_step) {
    const error = new Error(
      'ChatNivo meminta verifikasi tambahan. Selesaikan melalui situs resmi sebelum memakai fallback.',
    );
    error.code = 'CHATNIVO_ADDITIONAL_AUTH_REQUIRED';
    error.retryable = false;
    throw error;
  }
  if (!data || typeof data.token !== 'string' || !data.token) {
    const error = new Error('Login ChatNivo tidak mengembalikan session token yang valid.');
    error.code = 'CHATNIVO_LOGIN_RESPONSE_INVALID';
    error.retryable = false;
    throw error;
  }
  return data.token;
}

function normalizeModelRows(data) {
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : [];
  const models = rows
    .map(item => {
      const id = String(item?.id || item?.model_id || item?.name || '').trim();
      if (!id || id.length > 240) return null;
      return {
        id,
        name: String(item?.name || item?.info?.name || item?.info?.meta?.name || id).slice(0, 180),
        ownedBy: String(item?.owned_by || item?.info?.owned_by || '').slice(0, 100) || null,
      };
    })
    .filter(Boolean);
  return [...new Map(models.map(item => [item.id, item])).values()];
}

export async function listChatNivoModels({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = baseUrl();
  const token = await signIn({ timeoutMs, url });
  const data = await requestJson(endpoint(url, '/api/v1/models'), { token, timeoutMs });
  return normalizeModelRows(data);
}

function extractContent(value) {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value
    .map(part => (typeof part === 'string' ? part : String(part?.text || '')))
    .join('')
    .trim();
}

export async function generateWithChatNivo(
  messages,
  {
    modelId = getRuntimeSettings().chatnivo.modelId,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    temperature = 0.55,
    maxOutputTokens = 2048,
  } = {},
) {
  const url = baseUrl();
  const token = await signIn({ timeoutMs, url });
  let selectedModel = String(modelId || '').trim();
  if (!selectedModel) {
    const catalog = normalizeModelRows(await requestJson(endpoint(url, '/api/v1/models'), { token, timeoutMs }));
    if (catalog.length !== 1) {
      const error = new Error(
        catalog.length
          ? 'Model ChatNivo belum dipilih. Gunakan .chatnivo models lalu .chatnivo model <id>.'
          : 'ChatNivo tidak mengembalikan model yang dapat dipilih.',
      );
      error.code = 'CHATNIVO_MODEL_SELECTION_REQUIRED';
      error.retryable = false;
      throw error;
    }
    selectedModel = catalog[0].id;
  }

  const data = await requestJson(endpoint(url, '/api/chat/completions'), {
    method: 'POST',
    token,
    timeoutMs,
    body: {
      model: selectedModel,
      messages: Array.isArray(messages) ? messages : [],
      temperature: Math.max(0, Math.min(1, Number(temperature) || 0.55)),
      max_tokens: Math.max(64, Math.min(8192, Number(maxOutputTokens) || 2048)),
      stream: false,
    },
  });
  const choice = data?.choices?.[0];
  const text = extractContent(choice?.message?.content ?? choice?.text);
  if (!text) {
    const error = new Error('ChatNivo mengembalikan respons kosong atau format completion tidak dikenali.');
    error.code = 'CHATNIVO_EMPTY_COMPLETION';
    error.retryable = true;
    throw error;
  }
  return {
    text,
    provider: 'chatnivo',
    model: selectedModel,
    usage: data?.usage || null,
    finishReason: String(choice?.finish_reason || ''),
    latencyMs: null,
  };
}

export async function updateChatNivoRuntimeConfig(patch = {}) {
  const configPath = getRuntimeConfigPath();
  const configDir = path.dirname(configPath);
  const current = JSON.parse(await fs.readFile(configPath, 'utf8'));
  current.chatnivo ||= {};
  if (Object.hasOwn(patch, 'modelId')) current.chatnivo.modelId = String(patch.modelId || '').trim();
  if (Object.hasOwn(patch, 'fallbackEnabled')) current.chatnivo.fallbackEnabled = patch.fallbackEnabled === true;
  const temporary = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
  const stat = await fs.stat(configPath);
  const handle = await fs.open(temporary, 'wx', stat.mode & 0o777);
  try {
    await handle.writeFile(`${JSON.stringify(current, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, configPath);
  await fs.chmod(configPath, stat.mode & 0o777);
  return current.chatnivo;
}

export function getChatNivoInferenceStatus() {
  const settings = getRuntimeSettings().chatnivo;
  const hasEmail = Boolean(String(process.env.CHATNIVO_EMAIL || '').trim());
  const hasPassword = Boolean(process.env.CHATNIVO_PASSWORD || '');
  const hasModel = Boolean(String(settings.modelId || '').trim());
  return {
    enabled: settings.fallbackEnabled !== false,
    credentialsConfigured: hasEmail && hasPassword,
    missingCredentials: [!hasEmail ? 'CHATNIVO_EMAIL' : null, !hasPassword ? 'CHATNIVO_PASSWORD' : null].filter(
      Boolean,
    ),
    modelConfigured: hasModel,
    modelId: hasModel ? String(settings.modelId).trim() : null,
    ready: settings.fallbackEnabled !== false && hasEmail && hasPassword,
    modelSelection: hasModel ? 'configured' : 'auto_if_exactly_one_remote_model',
    baseUrl: baseUrl(settings.baseUrl),
  };
}
