import os from 'node:os';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getACIEPaths } from '../core/paths.js';
import { runSandboxProcess } from './sandbox-runner.js';

let sandboxProbe = { available: false, checkedAt: null, engine: null, reason: 'not-probed' };

function readSandboxConfig(root = process.cwd()) {
  try { return JSON.parse(fs.readFileSync(getACIEPaths(root).config, 'utf8')).sandbox || {}; }
  catch { return {}; }
}

export function inspectRuntimeHost({ root = process.cwd() } = {}) {
  const config = readSandboxConfig(root);
  const enginePath = config.enginePath;
  const configured = config.configured === true && ['docker', 'podman'].includes(config.engine) && typeof enginePath === 'string' && path.isAbsolute(enginePath) && fs.existsSync(enginePath);
  const images = config.images || {};
  const digestPinnedImages = Object.values(images).filter(value => typeof value === 'string' && /@sha256:[a-f0-9]{64}$/i.test(value)).length;
  return {
    node: process.version, platform: process.platform, architecture: process.arch, osRelease: os.release(),
    supportedRuntimeFamilies: ['node', 'python3', 'go', 'php', 'jvm', 'rust', 'bash'],
    sandbox: {
      available: Boolean(configured && sandboxProbe.available && sandboxProbe.engine === config.engine),
      configured, engine: configured ? config.engine : null, enginePath: configured ? enginePath : null,
      digestPinnedImages, lastProbeAt: sandboxProbe.checkedAt, probeReason: sandboxProbe.reason,
      mode: configured ? 'container-isolation-pending-probe' : 'not-configured',
      executionEnabled: Boolean(configured && sandboxProbe.available && sandboxProbe.engine === config.engine)
    },
    policy: 'Contributed source runs only in a digest-pinned, network-isolated container with read-only source and no inherited bot credentials.'
  };
}

export async function probeSandboxRuntime({ root = process.cwd(), spawnImpl = spawn } = {}) {
  const config = readSandboxConfig(root);
  if (config.configured !== true || !['docker', 'podman'].includes(config.engine) || !path.isAbsolute(String(config.enginePath || '')) || !fs.existsSync(config.enginePath)) {
    sandboxProbe = { available: false, checkedAt: new Date().toISOString(), engine: config.engine || null, reason: 'engine-not-configured-or-not-found' };
    return inspectRuntimeHost({ root });
  }
  try {
    await runSandboxProcess({ engine: config.enginePath, args: ['info', '--format', '{{.ServerVersion}}'], input: '', timeoutMs: 10_000, maxStdoutBytes: 4096, maxStderrBytes: 4096, spawnImpl });
    const images = Object.entries(config.images || {});
    if (!images.length || images.some(([, image]) => !/@sha256:[a-f0-9]{64}$/i.test(String(image)))) throw new Error('Runtime images must all be pinned by SHA-256 digest.');
    for (const [, image] of images) await runSandboxProcess({ engine: config.enginePath, args: ['image', 'inspect', image, '--format', '{{.Id}}'], input: '', timeoutMs: 10_000, maxStdoutBytes: 4096, maxStderrBytes: 4096, spawnImpl });
    sandboxProbe = { available: true, checkedAt: new Date().toISOString(), engine: config.engine, reason: null };
  } catch (error) {
    sandboxProbe = { available: false, checkedAt: new Date().toISOString(), engine: config.engine, reason: String(error?.code || error?.name || 'probe-failed').slice(0, 80) };
  }
  return inspectRuntimeHost({ root });
}

export function assertSandboxExecutionAllowed(provider, options = {}) {
  const runtime = inspectRuntimeHost(options);
  if (!provider?.sandbox?.approved || !provider?.executionAuthorized) throw new Error('Execution denied: isolated sandbox approval and owner authorization are required.');
  if (!runtime.sandbox.available) throw new Error('Execution denied: no production sandbox runner is configured or successfully probed.');
  return true;
}
