import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { logger } from '../core/logger.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts', 'bootstrap', 'ensure-host.sh');
const DATA_DIR = path.join(ROOT, 'data', 'runtime');
const CACHE_FILE = path.join(DATA_DIR, 'nexora-host-preflight.json');
const BOOTSTRAP_TIMEOUT_MS = 20 * 60_000;
const HEALTHY_INTERVAL_MS = 24 * 60 * 60_000;
const DEGRADED_INTERVAL_MS = 6 * 60 * 60_000;
const BOOTSTRAP_ERROR_RETRY_MS = 60 * 60_000;
const MAX_CAPTURE_BYTES = 96 * 1024;
let retryTimer = null;
let activeRun = null;

function fingerprintFor(codeLabConfig) {
  let osRelease = '';
  try { osRelease = requireOsRelease(); } catch {}
  const fields = {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    osRelease,
    runtime: String(codeLabConfig.containerRuntime || 'auto'),
    pythonImage: String(codeLabConfig.pythonImage || 'python:3.12-alpine'),
    nodeImage: String(codeLabConfig.nodeImage || 'node:22-alpine'),
    cloudflaredBin: String(codeLabConfig.cloudflaredBin || 'cloudflared'),
    hostTools: {
      bash: commandExists('bash'),
      git: commandExists('git'),
      python3: commandExists('python3'),
      go: commandExists('go'),
      cloudflared: commandExists(String(codeLabConfig.cloudflaredBin || 'cloudflared')),
      docker: commandExists('docker'),
      podman: commandExists('podman')
    }
  };
  return { fields, hash: crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex') };
}

function requireOsRelease() {
  // Synchronous file read avoids making the fingerprint depend on transient async state.
  return osReleaseCache;
}

let osReleaseCache = '';
try { osReleaseCache = readFileSync('/etc/os-release', 'utf8').slice(0, 8192); } catch {}

async function readCache() {
  try { return JSON.parse(await fs.readFile(CACHE_FILE, 'utf8')); }
  catch { return null; }
}

async function writeCache(record) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporary = `${CACHE_FILE}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(record, null, 2), { mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, CACHE_FILE);
}

function scheduleRetry(codeLabConfig, delayMs) {
  clearTimeout(retryTimer);
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void runNexoraBootstrap(codeLabConfig, { force: true, scheduled: true }).catch(error => {
      logger.warn({ message: error.message }, 'Scheduled Nexora host preflight failed; next retry will be rescheduled');
    });
  }, delayMs);
  retryTimer.unref?.();
}

function runtimeBlocked(output) {
  return /cannot clone|permission denied|operation not permitted|cgroup.*(denied|unavailable)|namespace.*(denied|invalid)|not a shared mount/i.test(output);
}

function runSync(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout || 10 * 60_000,
    stdio: options.stdio || 'pipe',
    env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive', NPM_CONFIG_FUND: 'false', NPM_CONFIG_AUDIT: 'false' },
    windowsHide: true
  });
}

function commandExists(command) {
  const result = runSync(command, ['--version'], { timeout: 5000, stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function adminCommand() {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return [];
  const doas = runSync('doas', ['-n', 'true'], { timeout: 5000, stdio: 'ignore' });
  if (!doas.error && doas.status === 0) return ['doas', '-n'];
  const sudo = runSync('sudo', ['-n', 'true'], { timeout: 5000, stdio: 'ignore' });
  if (!sudo.error && sudo.status === 0) return ['sudo', '-n'];
  return null;
}

function ensureBashAvailable() {
  if (commandExists('bash')) return 'bash';
  if (process.platform !== 'linux') throw new Error('Bash tidak tersedia dan pemasangan otomatis hanya disiapkan untuk Linux.');
  const admin = adminCommand();
  if (!admin) throw new Error('Bash tidak tersedia dan proses tidak memiliki hak admin non-interaktif untuk memasangnya.');
  let osRelease = '';
  try { osRelease = readFileSync('/etc/os-release', 'utf8'); } catch {}
  const id = osRelease.match(/^ID=(?:"([^"]+)"|([^\n]+))/m)?.slice(1).find(Boolean)?.toLowerCase() || '';
  const has = command => commandExists(command);
  let commands;
  if (has('apt-get')) commands = [['apt-get', ['update']], ['apt-get', ['install', '-y', 'bash']]];
  else if (has('dnf')) commands = [['dnf', ['install', '-y', 'bash']]];
  else if (has('yum')) commands = [['yum', ['install', '-y', 'bash']]];
  else if (has('apk')) commands = [['apk', ['add', '--no-cache', 'bash']]];
  else throw new Error(`Tidak ada package manager Linux yang didukung untuk memasang Bash (ID=${id || 'unknown'}).`);
  for (const [command, args] of commands) {
    const result = runSync(command, [...admin, ...args], { timeout: 10 * 60_000, stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error(`Pemasangan Bash gagal: ${result.error?.message || `${command} exit ${result.status}`}`);
  }
  if (!commandExists('bash')) throw new Error('Package manager selesai tetapi executable Bash belum tersedia di PATH.');
  logger.info('Bash berhasil dipasang otomatis sebelum host bootstrap dijalankan.');
  return 'bash';
}

async function executeBootstrap(args) {
  return new Promise((resolve, reject) => {
    const shell = ensureBashAvailable();
    const child = spawn(shell, args, {
      cwd: ROOT,
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let settled = false;
    let output = '';
    const capture = (target, chunk) => {
      const text = chunk.toString();
      target.write(text);
      output = `${output}${text}`.slice(-MAX_CAPTURE_BYTES);
    };
    child.stdout.on('data', chunk => capture(process.stdout, chunk));
    child.stderr.on('data', chunk => capture(process.stderr, chunk));
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve({ ...result, output });
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      finish(new Error(`Nexora dependency bootstrap exceeded ${BOOTSTRAP_TIMEOUT_MS} ms`));
    }, BOOTSTRAP_TIMEOUT_MS);
    timer.unref?.();
    child.once('error', error => finish(new Error(`Cannot start Nexora bootstrap script: ${error.message}`)));
    child.once('close', (code, signal) => {
      if (code === 0) finish(null, { code, signal });
      else finish(new Error(`Nexora bootstrap exited with code ${code ?? 'null'} (${signal || 'no signal'})`));
    });
  });
}

export async function runNexoraBootstrap(codeLabConfig = {}, { force = false, scheduled = false } = {}) {
  if (activeRun) return activeRun;
  if (codeLabConfig.enabled === false) return { skipped: true, reason: 'Code Lab disabled' };
  if (process.platform !== 'linux') {
    logger.warn({ platform: process.platform }, 'Nexora host bootstrap supports Linux only; skipping automatic package installation');
    return { skipped: true, reason: 'unsupported platform' };
  }
  const { fields, hash } = fingerprintFor(codeLabConfig);
  const now = Date.now();
  const cache = await readCache();
  const forceFromBootstrapUpdate = process.env.OCHA_HOST_BOOTSTRAP_FORCE === '1';
  if (forceFromBootstrapUpdate) process.env.OCHA_HOST_BOOTSTRAP_FORCE = '0';

  // A normal source hot-reload is not a host reboot. Skip the preflight once,
  // unless the bootstrap implementation itself changed and must be exercised.
  if (process.env.OCHA_HANDOFF_FROM_PID && process.env.OCHA_BOOTSTRAP_HANDOFF_CONSUMED !== '1' && !forceFromBootstrapUpdate) {
    process.env.OCHA_BOOTSTRAP_HANDOFF_CONSUMED = '1';
    logger.info({ fromPid: Number(process.env.OCHA_HANDOFF_FROM_PID) }, 'Host dependency bootstrap skipped during controlled source handoff; cached host state reused');
    const nextRetryAt = Date.parse(cache?.nextRetryAt || '') || (now + DEGRADED_INTERVAL_MS);
    scheduleRetry(codeLabConfig, Math.max(60_000, nextRetryAt - now));
    return { skipped: true, reason: 'controlled handoff', cached: cache || null };
  }
  if (forceFromBootstrapUpdate) {
    process.env.OCHA_BOOTSTRAP_HANDOFF_CONSUMED = '1';
    logger.info({ fromPid: Number(process.env.OCHA_HANDOFF_FROM_PID) || null }, 'Host preflight forced because bootstrap source changed in the update batch');
  }

  const interval = cache?.preflightHealthy === true
    ? HEALTHY_INTERVAL_MS
    : DEGRADED_INTERVAL_MS;
  const age = Number.isFinite(Date.parse(cache?.checkedAt)) ? now - Date.parse(cache.checkedAt) : Infinity;
  if (!force && !forceFromBootstrapUpdate && cache?.fingerprint === hash && age >= 0 && age < interval) {
    const nextRetryAt = Date.parse(cache.checkedAt) + interval;
    logger.info({ checkedAt: cache.checkedAt, ageMs: age, nextCheckAt: new Date(nextRetryAt).toISOString(), cloudflared: cache.cloudflared || 'unknown', runtime: cache.runtimeSelected || 'unknown' }, 'Host preflight cache is valid; repeating package/runtime provisioning is not required');
    scheduleRetry(codeLabConfig, nextRetryAt - now);
    return { skipped: true, reason: 'cached host preflight', ...cache };
  }

  const configuredRuntime = String(codeLabConfig.containerRuntime || 'auto').toLowerCase();
  const runtime = ['auto', 'docker', 'podman'].includes(configuredRuntime) ? configuredRuntime : 'auto';
  const args = [
    SCRIPT,
    runtime,
    String(codeLabConfig.pythonImage || 'python:3.12-alpine'),
    String(codeLabConfig.nodeImage || 'node:22-alpine'),
    String(codeLabConfig.cloudflaredBin || 'cloudflared')
  ];
  activeRun = (async () => {
    logger.info({ runtime, pythonImage: args[2], nodeImage: args[3], scheduled }, 'Nexora host preflight started');
    const result = await executeBootstrap(args);
    const selectedRuntime = result.output.match(/\[NEXORA_RUNTIME_SELECTED\]\s+(docker|podman|none)/)?.[1] || 'unknown';
    const cloudflared = /cloudflared tersedia:/.test(result.output) || /cloudflared berhasil disiapkan/.test(result.output);
    const cliMatch = result.output.match(/\[NEXORA_CLI_TOOLS\]\s+git=(available|missing)\s+python3=(available|missing)\s+go=(available|missing)\s+bash=(available|missing)/);
    const cliTools = cliMatch ? { git: cliMatch[1], python3: cliMatch[2], go: cliMatch[3], bash: cliMatch[4] } : null;
    const restricted = selectedRuntime === 'none' && runtimeBlocked(result.output);
    const preflightHealthy = selectedRuntime !== 'none' && cloudflared && cliTools && Object.values(cliTools).every(status => status === 'available');
    const refreshedFingerprint = fingerprintFor(codeLabConfig);
    const checkedAt = new Date().toISOString();
    const retryMs = preflightHealthy ? HEALTHY_INTERVAL_MS : DEGRADED_INTERVAL_MS;
    const record = {
      schemaVersion: 2,
      fingerprint: refreshedFingerprint.hash,
      fingerprintFields: refreshedFingerprint.fields,
      checkedAt,
      cloudflared: cloudflared ? 'available' : 'unavailable-or-unknown',
      cliTools,
      runtimeSelected: selectedRuntime,
      runtimeRestricted: restricted,
      preflightHealthy: Boolean(preflightHealthy),
      nextRetryAt: new Date(Date.now() + retryMs).toISOString(),
      lastOutputTail: result.output.slice(-6000)
    };
    await writeCache(record);
    logger.info({ cloudflared: record.cloudflared, cliTools, runtime: selectedRuntime, restricted, preflightHealthy, checkedAt, nextCheckAt: record.nextRetryAt }, 'Nexora host preflight state persisted');
    return { skipped: false, runtime: selectedRuntime, cloudflared: record.cloudflared, cliTools, restricted, preflightHealthy, checkedAt };
  })();
  try {
    const result = await activeRun;
    const cacheAfter = await readCache();
    scheduleRetry(codeLabConfig, Math.max(60_000, Date.parse(cacheAfter?.nextRetryAt || '') - Date.now()));
    return result;
  } catch (error) {
    scheduleRetry(codeLabConfig, BOOTSTRAP_ERROR_RETRY_MS);
    throw error;
  } finally {
    activeRun = null;
  }
}

export function stopNexoraBootstrapScheduler() {
  clearTimeout(retryTimer);
  retryTimer = null;
}

export const bootstrapScriptPath = SCRIPT;
