import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { logger } from '../core/logger.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = path.resolve(ROOT, 'data');
const STATUS_FILE = path.join(DATA_DIR, 'ai-model-catalog-worker.json');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'ai-model-catalog-worker.log');
const WORKER_SCRIPT = fileURLToPath(new URL('./model-catalog-worker.js', import.meta.url));

function isWorkerAlive(status) {
  const pid = Number(status?.pid);
  if (!status?.active || !Number.isInteger(pid) || pid <= 0) return false;
  const heartbeat = Date.parse(status?.heartbeatAt || '');
  if (!Number.isFinite(heartbeat) || Date.now() - heartbeat > 3 * 60_000) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

export function ensureModelCatalogWorkerStarted() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  let status = null;
  try { status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch {}
  if (isWorkerAlive(status)) {
    return { active: true, started: false, pid: Number(status.pid), heartbeatAt: status.heartbeatAt };
  }

  fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(LOG_FILE, 'a', 0o600);
  fs.chmodSync(LOG_FILE, 0o600);
  try {
    const child = spawn(process.execPath, [WORKER_SCRIPT], {
      cwd: ROOT,
      env: process.env,
      detached: true,
      stdio: ['ignore', descriptor, descriptor],
      windowsHide: true
    });
    child.once('error', error => logger.error({ err: error }, 'Unable to spawn detached AI model catalog worker'));
    child.unref();
    return { active: true, started: true, pid: child.pid || null, logFile: LOG_FILE };
  } finally {
    fs.closeSync(descriptor);
  }
}
