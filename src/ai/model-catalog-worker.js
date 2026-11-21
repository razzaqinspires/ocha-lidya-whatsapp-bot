import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { initializeProviderKeys } from './providers.js';
import { getModelCatalogStatus, startModelCatalogScheduler, stopModelCatalogScheduler } from './model-catalog.js';
import { logger } from '../core/logger.js';

const DATA_DIR = path.resolve('data');
const LOCK_FILE = path.join(DATA_DIR, 'ai-model-catalog-worker.lock');
const STATUS_FILE = path.join(DATA_DIR, 'ai-model-catalog-worker.json');
const HEARTBEAT_MS = 30_000;
const LOCK_TOKEN = crypto.randomUUID();
const STARTED_AT = new Date().toISOString();
let heartbeatTimer = null;
let lockOwned = false;
let stopping = false;

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

async function acquireWorkerLock() {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(LOCK_FILE, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, token: LOCK_TOKEN, startedAt: STARTED_AT }));
      await handle.sync();
      await handle.close();
      lockOwned = true;
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let existing = null;
      try { existing = JSON.parse(await fs.readFile(LOCK_FILE, 'utf8')); } catch {}
      if (processIsAlive(Number(existing?.pid))) return false;
      try { await fs.unlink(LOCK_FILE); } catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      }
    }
  }
  return false;
}

async function writeStatus(active, extra = {}) {
  let catalog = {};
  try { catalog = await getModelCatalogStatus(); } catch {}
  const status = {
    pid: process.pid,
    startedAt: STARTED_AT,
    heartbeatAt: new Date().toISOString(),
    active,
    mode: 'detached-node-worker',
    checkedAt: catalog.checkedAt || null,
    nextRunAt: catalog.scheduler?.nextRunAt || catalog.nextCheckAt || null,
    ...extra
  };
  const temp = `${STATUS_FILE}.${process.pid}.${LOCK_TOKEN}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temp, 'w', 0o600);
  try { await handle.writeFile(`${JSON.stringify(status, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  await fs.rename(temp, STATUS_FILE);
  await fs.chmod(STATUS_FILE, 0o600);
}

async function cleanup(signal, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  stopModelCatalogScheduler();
  if (lockOwned) {
    try { await writeStatus(false, { stoppedAt: new Date().toISOString(), stopSignal: signal || null }); } catch {}
    try {
      const current = JSON.parse(await fs.readFile(LOCK_FILE, 'utf8'));
      if (current.pid === process.pid && current.token === LOCK_TOKEN) await fs.unlink(LOCK_FILE);
    } catch {}
    lockOwned = false;
  }
  process.exit(exitCode);
}

async function main() {
  const acquired = await acquireWorkerLock();
  if (!acquired) {
    logger.info({ pid: process.pid }, 'Autonomous AI model catalog worker already active; duplicate worker exits');
    process.exit(0);
    return;
  }
  await initializeProviderKeys({ skipTelemetry: true });
  const scheduler = await startModelCatalogScheduler({ refreshAtStartup: true, keepAlive: true, awaitInitialRefresh: true });
  await writeStatus(true, { schedulerActive: scheduler.active });
  heartbeatTimer = setInterval(() => {
    void writeStatus(true).catch(error => logger.warn({ err: error }, 'AI model catalog worker heartbeat update failed'));
  }, HEARTBEAT_MS);
  logger.info({ pid: process.pid, intervalHours: 24, mode: 'detached' }, 'Independent AI model catalog worker started');
}

process.once('SIGINT', () => { void cleanup('SIGINT'); });
process.once('SIGTERM', () => { void cleanup('SIGTERM'); });
process.once('SIGHUP', () => { void cleanup('SIGHUP'); });
process.on('unhandledRejection', error => logger.error({ err: error }, 'AI model catalog worker unhandled rejection'));
process.on('uncaughtException', error => {
  logger.fatal({ err: error }, 'AI model catalog worker uncaught exception');
  void cleanup('uncaughtException', 1);
});

main().catch(error => {
  logger.error({ err: error }, 'Independent AI model catalog worker startup failed');
  void cleanup('startup-failed', 1);
});
