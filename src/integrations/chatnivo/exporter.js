import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { getRuntimeSettings } from '../../core/runtime-settings.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CONTRIBUTION_ROOT = path.join(PROJECT_ROOT, '.private', 'contributions', 'chatnivo-personal-exporter-v1');
const EXPORTER_PATH = path.join(CONTRIBUTION_ROOT, 'original', 'chatnivo-personal-exporter', 'chatnivo-exporter.mjs');
const MAX_CAPTURE_BYTES = 64 * 1024;
const EXPORT_TIMEOUT_MS = 30 * 60 * 1000;
let activeJob = null;

function resolveBaseUrl(value) {
  const parsed = new URL(String(value || ''));
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('ChatNivo URL harus HTTPS dan tidak boleh berisi kredensial, query, atau fragment.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

async function ensurePrivateDirectory(directory) {
  const relative = path.relative(PROJECT_ROOT, directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Direktori ekspor ChatNivo harus berada di dalam workspace Ocha.');
  }
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Direktori ekspor ChatNivo bukan direktori fisik yang aman.');
  }
  await fs.chmod(directory, 0o700);
}

export async function getChatNivoExporterStatus() {
  const settings = getRuntimeSettings().chatnivo;
  const [exporterExists] = await Promise.all([
    fs
      .access(EXPORTER_PATH)
      .then(() => true)
      .catch(() => false),
  ]);
  const missingCredentials = [
    !String(process.env.CHATNIVO_EMAIL || '').trim() ? 'CHATNIVO_EMAIL' : null,
    !String(process.env.CHATNIVO_PASSWORD || '') ? 'CHATNIVO_PASSWORD' : null,
  ].filter(Boolean);
  return {
    configured: missingCredentials.length === 0,
    missingCredentials,
    exporterAvailable: exporterExists,
    baseUrl: resolveBaseUrl(settings.baseUrl),
    active: Boolean(activeJob),
    aiInferenceSupported: false,
  };
}

export async function startChatNivoExport() {
  if (activeJob) {
    const error = new Error('Ekspor ChatNivo masih berjalan. Tunggu proses yang aktif selesai.');
    error.code = 'CHATNIVO_EXPORT_BUSY';
    throw error;
  }

  const email = String(process.env.CHATNIVO_EMAIL || '').trim();
  const password = String(process.env.CHATNIVO_PASSWORD || '');
  if (!email || !password) {
    const error = new Error('CHATNIVO_EMAIL dan CHATNIVO_PASSWORD belum diisi pada .env.');
    error.code = 'CHATNIVO_CREDENTIALS_MISSING';
    throw error;
  }

  await fs.access(EXPORTER_PATH);
  const settings = getRuntimeSettings().chatnivo;
  const baseUrl = resolveBaseUrl(settings.baseUrl);
  const outputDirectory = path.resolve(PROJECT_ROOT, settings.exportDirectory);
  await ensurePrivateDirectory(outputDirectory);

  const child = spawn(process.execPath, [EXPORTER_PATH], {
    cwd: path.dirname(EXPORTER_PATH),
    env: {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
      TMPDIR: process.env.TMPDIR || '',
      CHATNIVO_URL: baseUrl,
      CHATNIVO_EMAIL: email,
      CHATNIVO_PASSWORD: password,
      OUTPUT_DIR: outputDirectory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';
  let settled = false;
  let timer;

  const done = new Promise((resolve, reject) => {
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (activeJob?.child === child) activeJob = null;
      if (error) reject(error);
      else resolve(result);
    };

    const capture = (current, chunk) => {
      const next = current + chunk.toString('utf8');
      return next.length > MAX_CAPTURE_BYTES ? next.slice(-MAX_CAPTURE_BYTES) : next;
    };
    child.stdout.setEncoding('utf8').on('data', chunk => {
      stdout = capture(stdout, chunk);
    });
    child.stderr.setEncoding('utf8').on('data', chunk => {
      stderr = capture(stderr, chunk);
    });
    child.once('error', error => {
      const wrapped = new Error(`ChatNivo exporter tidak dapat dijalankan: ${error.message}`);
      wrapped.code = 'CHATNIVO_EXPORT_SPAWN_FAILED';
      finish(wrapped);
    });
    child.once('close', code => {
      if (code !== 0) {
        const status = Number(stderr.match(/HTTP\s+(\d{3})/)?.[1]) || null;
        const error = new Error(
          status
            ? `ChatNivo menolak atau gagal memproses permintaan (HTTP ${status}).`
            : `ChatNivo exporter berhenti dengan exit code ${code ?? 'unknown'}.`,
        );
        error.code = 'CHATNIVO_EXPORT_FAILED';
        error.status = status;
        finish(error);
        return;
      }
      const count = Number(stdout.match(/Chats:\s*(\d+)/i)?.[1]);
      finish(null, { chatCount: Number.isFinite(count) ? count : null, outputDirectory });
    });

    timer = setTimeout(() => {
      child.kill('SIGTERM');
      const error = new Error('Ekspor ChatNivo melewati batas 30 menit dan dihentikan.');
      error.code = 'CHATNIVO_EXPORT_TIMEOUT';
      finish(error);
    }, EXPORT_TIMEOUT_MS);
    timer.unref?.();
  });

  activeJob = { child, startedAt: new Date().toISOString(), done };
  return { started: true, done };
}
