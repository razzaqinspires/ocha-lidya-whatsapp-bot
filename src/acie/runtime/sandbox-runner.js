import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getACIEPaths } from '../core/paths.js';
import { isWithin, readJson } from '../core/fs-safe.js';
import { findContribution, verifyContribution } from '../core/contribution-vault.js';
import { getRuntimeCommand, normalizeAdapterInput, normalizeAdapterOutput, validateAdapterDescriptor } from '../adapters/universal-adapter.js';

const MAX_STDOUT = 1024 * 1024;
const MAX_STDERR = 64 * 1024;
const DEFAULT_TIMEOUT = 20_000;

function pushBounded(current, chunk, max) {
  const next = Buffer.concat([current, Buffer.from(chunk)]);
  return next.length > max ? next.subarray(next.length - max) : next;
}

export function buildSandboxArgs({ sourceDirectory, image, command, memory = '256m', cpus = '1', pids = 64, timeout = DEFAULT_TIMEOUT } = {}) {
  if (!path.isAbsolute(String(sourceDirectory || '')) || String(sourceDirectory).includes(',')) throw new Error('Sandbox source mount must be an absolute path without commas.');
  if (!String(image || '').includes('@sha256:')) throw new Error('Sandbox image must be pinned by sha256 digest.');
  if (!/^\d+(?:m|g)$/.test(memory) || !/^\d+(?:\.\d+)?$/.test(String(cpus)) || !Number.isInteger(pids) || pids < 16 || pids > 256) throw new Error('Invalid sandbox resource limits.');
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120_000) throw new Error('Sandbox timeout must be between 1s and 120s.');
  return [
    'run', '--rm', '--init', '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--pids-limit', String(pids), '--memory', memory,
    '--cpus', String(cpus), '--user', '65534:65534', '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m',
    '--mount', `type=bind,src=${sourceDirectory},dst=/acie/source,readonly`,
    '--env', 'HOME=/tmp', '--env', 'TMPDIR=/tmp', '--env', 'GOCACHE=/tmp/go-cache',
    '--env', 'GOMODCACHE=/tmp/go-mod-cache', '--env', 'PYTHONDONTWRITEBYTECODE=1',
    '--workdir', '/acie/source', image, command.executable, ...command.args
  ];
}

export function runSandboxProcess({ engine = 'docker', args, input, timeoutMs = DEFAULT_TIMEOUT, maxStdoutBytes = MAX_STDOUT, maxStderrBytes = MAX_STDERR, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(engine, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8' } });
    let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0); let settled = false; let timedOut = false; let stdoutOverflow = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
    child.stdout?.on('data', chunk => { if (stdout.length + Buffer.byteLength(chunk) > maxStdoutBytes) stdoutOverflow = true; stdout = pushBounded(stdout, chunk, maxStdoutBytes); });
    child.stderr?.on('data', chunk => { stderr = pushBounded(stderr, chunk, maxStderrBytes); });
    child.once('error', error => finish(Object.assign(new Error(`Sandbox engine unavailable: ${error.code || error.name}`), { code: error.code || 'SANDBOX_ENGINE_UNAVAILABLE' })));
    child.once('close', (code, signal) => {
      if (timedOut) return finish(Object.assign(new Error('Sandbox execution timed out.'), { code: 'SANDBOX_TIMEOUT' }));
      if (code !== 0) return finish(Object.assign(new Error(`Sandbox process exited (${code ?? signal ?? 'unknown'}). Diagnostic output was withheld from the response.`), { code: 'SANDBOX_RUNTIME_FAILURE' }));
      if (stdoutOverflow) return finish(Object.assign(new Error('Sandbox stdout exceeded the configured output limit.'), { code: 'INVALID_OUTPUT' }));
      finish(null, { stdout: stdout.toString('utf8'), stderrBytes: stderr.length, exitCode: code });
    });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    timer.unref?.();
    child.stdin?.end(input);
  });
}

export async function executeProviderInSandbox(provider, input, { root = process.cwd(), spawnImpl = spawn, validationMode = false } = {}) {
  const paths = getACIEPaths(root);
  const config = await readJson(paths.config, {});
  const sandbox = config.sandbox || {};
  if (sandbox.configured !== true || !['docker', 'podman'].includes(sandbox.engine)) throw Object.assign(new Error('Production sandbox is not configured.'), { code: 'SANDBOX_UNAVAILABLE' });
  const image = sandbox.images?.[provider.language];
  if (!image || !/@sha256:[a-f0-9]{64}$/i.test(image)) throw Object.assign(new Error(`Digest-pinned runtime image missing for ${provider.language}.`), { code: 'SANDBOX_IMAGE_UNAVAILABLE' });
  const contribution = await findContribution(provider.contributionId, { root });
  if (!contribution?.versionRoot) throw Object.assign(new Error('Original contribution version not found.'), { code: 'CONTRIBUTION_NOT_FOUND' });
  const sourceDirectory = path.join(contribution.versionRoot, 'original');
  const realVault = await fs.realpath(paths.vault);
  const realSource = await fs.realpath(sourceDirectory);
  if (!isWithin(realVault, realSource) || !isWithin(paths.vault, sourceDirectory)) throw Object.assign(new Error('Contribution source path escaped the vault.'), { code: 'SANDBOX_PATH_DENIED' });
  const integrity = await verifyContribution(provider.contributionId, { root });
  if (integrity.status !== 'verified') throw Object.assign(new Error('Contribution integrity verification failed.'), { code: 'INTEGRITY_FAILURE' });
  const adapterPath = path.join(paths.adapters, `${provider.providerId}.adapter.json`);
  const adapter = await readJson(adapterPath, null);
  const adapterCheck = validateAdapterDescriptor(adapter, provider);
  if (!adapterCheck.valid || adapter?.validation?.adapterReviewed !== true || (!validationMode && adapter?.validation?.protocolTested !== true)) throw Object.assign(new Error(`Adapter is not approved: ${adapterCheck.errors.join(',') || 'review-required'}`), { code: 'ADAPTER_NOT_APPROVED' });
  const command = getRuntimeCommand(provider.language, adapter.entryPoint);
  const args = buildSandboxArgs({ sourceDirectory, image, command, memory: sandbox.resources?.memory || '256m', cpus: String(sandbox.resources?.cpus || 1), pids: sandbox.resources?.pids || 64, timeout: sandbox.timeoutMs || DEFAULT_TIMEOUT });
  const result = await runSandboxProcess({ engine: sandbox.enginePath, args, input: normalizeAdapterInput(input), timeoutMs: sandbox.timeoutMs || DEFAULT_TIMEOUT, spawnImpl });
  return normalizeAdapterOutput(result.stdout);
}
