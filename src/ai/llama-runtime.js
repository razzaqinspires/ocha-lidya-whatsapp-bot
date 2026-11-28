import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { getRuntimeSettings } from '../core/runtime-settings.js';
import { logger } from '../core/logger.js';

const execFileAsync = promisify(execFile);
let serverProcess = null;
let startupPromise = null;
let notifier = null;
let ownerNotified = false;
let status = {
  enabled: true,
  installed: false,
  serverRunning: false,
  modelAvailable: false,
  model: null,
  baseUrl: null,
  lastError: null,
  startedAt: null,
};

function config() {
  return getRuntimeSettings().llama;
}
function binary() {
  const local = path.resolve('data/llama/runtime/bin', process.platform === 'win32' ? 'ollama.exe' : 'ollama');
  return fs.existsSync(local) ? local : String(config().binary || 'ollama');
}
function baseUrl() {
  const value = String(config().baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const parsed = new URL(value);
  if (
    parsed.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname.toLowerCase()) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Ocha Llama API wajib menggunakan HTTP loopback tanpa kredensial/query.');
  }
  return value;
}
function modelName() {
  return String(config().model || 'llama3.2:3b');
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run(command, args, timeoutMs = 120_000) {
  const result = await execFileAsync(command, args, {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, OLLAMA_HOST: baseUrl(), OLLAMA_MODELS: path.resolve('data/llama/models') },
  });
  return { stdout: result.stdout || '', stderr: result.stderr || '' };
}

export async function checkLlamaInstallation() {
  if (config().enabled === false) return { ...status, enabled: false };
  try {
    const result = await run(binary(), ['--version'], 15_000);
    status = {
      ...status,
      installed: true,
      lastError: null,
      version: `${result.stdout} ${result.stderr}`.trim().slice(0, 100),
    };
  } catch (error) {
    status = { ...status, installed: false, lastError: String(error.message || error).slice(0, 240) };
  }
  return { ...status };
}

export function setLlamaOwnerNotifier(callback) {
  notifier = typeof callback === 'function' ? callback : null;
}

async function notifyOwner(message) {
  if (ownerNotified || !config().notifyOwner || !notifier) return;
  ownerNotified = true;
  try {
    await notifier(message);
  } catch (error) {
    ownerNotified = false;
    logger.warn({ message: String(error?.message || error).slice(0, 180) }, 'Llama owner notification failed');
  }
}

async function waitForServer(timeoutMs) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl()}/api/tags`, { signal: AbortSignal.timeout(2500) });
      if (response.ok) return await response.json();
      lastError = new Error(`Ollama HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`Ollama server tidak siap: ${lastError?.message || 'timeout'}`);
}

function startDetachedServer() {
  if (serverProcess && serverProcess.exitCode === null) return;
  const child = spawn(binary(), ['serve'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, OLLAMA_HOST: baseUrl(), OLLAMA_MODELS: path.resolve('data/llama/models') },
  });
  child.once('error', error => {
    status = { ...status, serverRunning: false, lastError: String(error.message || error).slice(0, 240) };
  });
  child.once('exit', (code, signal) => {
    if (serverProcess === child) serverProcess = null;
    status = { ...status, serverRunning: false, lastError: `Ollama exited (${code ?? signal ?? 'unknown'})` };
  });
  child.unref();
  serverProcess = child;
  status = { ...status, serverRunning: true, startedAt: new Date().toISOString(), baseUrl: baseUrl() };
}

async function pullModelIfMissing(tags) {
  const wanted = modelName();
  const models = Array.isArray(tags?.models) ? tags.models : [];
  if (models.some(item => item.name === wanted || item.model === wanted)) return false;
  logger.info({ model: wanted }, 'Pulling configured local Llama model after final provider exhaustion');
  await run(binary(), ['pull', wanted], Number(config().pullTimeoutMs) || 30 * 60_000);
  return true;
}

async function ensureRuntime() {
  if (config().enabled === false)
    throw Object.assign(new Error('Ocha Llama fallback dinonaktifkan melalui config/runtime.json'), {
      code: 'LLAMA_DISABLED',
    });
  const installed = await checkLlamaInstallation();
  if (!installed.installed)
    throw Object.assign(
      new Error('Ollama belum terpasang. Jalankan npm start kembali setelah bootstrap runtime berhasil.'),
      { code: 'LLAMA_RUNTIME_MISSING' },
    );
  let tags;
  try {
    tags = await waitForServer(1500);
  } catch {
    startDetachedServer();
    tags = await waitForServer(Number(config().startupTimeoutMs) || 90_000);
  }
  status = { ...status, installed: true, serverRunning: true, baseUrl: baseUrl(), model: modelName(), lastError: null };
  const pulled = await pullModelIfMissing(tags);
  if (pulled) tags = await waitForServer(10_000);
  const models = Array.isArray(tags?.models) ? tags.models : [];
  const available = models.some(item => item.name === modelName() || item.model === modelName());
  if (!available)
    throw Object.assign(new Error(`Model ${modelName()} belum tersedia setelah pull.`), {
      code: 'LLAMA_MODEL_MISSING',
    });
  status = { ...status, modelAvailable: true, model: modelName(), lastError: null };
  await notifyOwner(
    [
      '*OCHA LLAMA AI DIAKTIFKAN*',
      'Seluruh provider utama dan ChatNivo telah gagal atau tidak tersedia.',
      `Runtime lokal: Ollama ${installed.version || 'installed'}`,
      `Model: ${modelName()}`,
      `API: ${baseUrl()}`,
      'Model server berjalan sebagai proses background terpisah. Ocha menggunakan model ini sebagai fallback terakhir.',
    ].join('\n'),
  );
}

export async function generateWithLlama(messages, options = {}) {
  if (!startupPromise) {
    startupPromise = ensureRuntime().finally(() => {
      startupPromise = null;
    });
  }
  await startupPromise;
  const timeoutMs = Math.max(5_000, Number(options.timeoutMs) || Number(config().timeoutMs) || 120_000);
  const response = await fetch(`${baseUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: modelName(),
      stream: false,
      messages: (Array.isArray(messages) ? messages : []).map(item => ({
        role: ['system', 'assistant'].includes(item.role) ? item.role : 'user',
        content: String(item.content ?? ''),
      })),
      options: {
        temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.7,
        num_predict: Math.max(64, Math.min(4096, Number(options.maxOutputTokens) || 1024)),
        num_ctx: Math.max(2048, Math.min(32768, Number(config().contextTokens) || 8192)),
      },
      keep_alive: String(config().keepAlive || '5m'),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(String(payload.error || `Ollama HTTP ${response.status}`).slice(0, 300)), {
      code: 'LLAMA_COMPLETION_FAILED',
      status: response.status,
      retryable: response.status >= 500,
    });
  const content = String(payload.message?.content || '').trim();
  if (!content)
    throw Object.assign(new Error('Llama mengembalikan completion kosong.'), {
      code: 'LLAMA_EMPTY_COMPLETION',
      retryable: true,
    });
  status = { ...status, modelAvailable: true, lastError: null };
  return {
    content,
    provider: 'llama-local',
    model: modelName(),
    usage: {
      prompt_tokens: Number(payload.prompt_eval_count) || 0,
      completion_tokens: Number(payload.eval_count) || 0,
      total_tokens: (Number(payload.prompt_eval_count) || 0) + (Number(payload.eval_count) || 0),
    },
    latencyMs: Number(payload.total_duration) ? Math.round(payload.total_duration / 1e6) : null,
  };
}

export function getLlamaRuntimeStatus() {
  return {
    ...status,
    enabled: config().enabled !== false,
    model: modelName(),
    baseUrl: baseUrl(),
    serverManagedByOcha: Boolean(serverProcess),
  };
}
