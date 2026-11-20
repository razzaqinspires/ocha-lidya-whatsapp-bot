import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../core/logger.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts', 'bootstrap', 'ensure-host.sh');
const BOOTSTRAP_TIMEOUT_MS = 20 * 60_000;

export async function runNexoraBootstrap(codeLabConfig = {}) {
  if (codeLabConfig.enabled === false) return { skipped: true, reason: 'Code Lab disabled' };
  if (process.platform !== 'linux') {
    logger.warn({ platform: process.platform }, 'Nexora host bootstrap supports Linux only; skipping automatic package installation');
    return { skipped: true, reason: 'unsupported platform' };
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
  logger.info({ runtime, pythonImage: args[2], nodeImage: args[3] }, 'Nexora dependency manager starting host preflight');
  await new Promise((resolve, reject) => {
    const child = spawn('bash', args, {
      cwd: ROOT,
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
      stdio: 'inherit',
      windowsHide: true
    });
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error(`Nexora dependency bootstrap exceeded ${BOOTSTRAP_TIMEOUT_MS} ms`));
    }, BOOTSTRAP_TIMEOUT_MS);
    timer.unref?.();
    child.once('error', error => finish(new Error(`Cannot start Nexora bootstrap script: ${error.message}`)));
    child.once('close', (code, signal) => {
      if (code === 0) finish();
      else finish(new Error(`Nexora bootstrap exited with code ${code ?? 'null'} (${signal || 'no signal'})`));
    });
  });
  logger.info('Nexora host preflight finished; Code Lab will verify runtime readiness independently');
  return { skipped: false, runtime };
}

export const bootstrapScriptPath = SCRIPT;
