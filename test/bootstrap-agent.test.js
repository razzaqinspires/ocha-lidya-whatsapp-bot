import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'bootstrap', 'ensure-host.sh');
const npmPreflight = path.join(root, 'scripts', 'bootstrap', 'npm-deps.js');

test('Nexora host bootstrap shell script passes bash syntax validation', () => {
  const result = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('Nexora host bootstrap dry-run lists Docker images and Cloudflare without modifying host', () => {
  assert.equal(fs.existsSync(script), true);
  const result = spawnSync('bash', [script, 'auto', 'python:3.12-alpine', 'node:22-alpine', 'cloudflared'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NEXORA_BOOTSTRAP_DRY_RUN: '1' },
    timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /DRY RUN/);
  assert.match(output, /runtime=auto/);
  assert.match(output, /python:3\.12-alpine/);
  assert.match(output, /node:22-alpine/);
  assert.match(output, /cloudflared/);
  assert.match(output, /bukan konfirmasi bahwa dependensi sudah terpasang/);
});

test('bootstrap agent is wired before Code Lab startup in the main entrypoint', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'index.js'), 'utf8');
  const bootstrap = source.indexOf('await runNexoraBootstrap(getConfig().codeLab)');
  const codeLab = source.indexOf('await startCodeLab()');
  assert.notEqual(bootstrap, -1);
  const adapter = fs.readFileSync(path.join(root, 'src', 'runtime', 'bootstrap-agent.js'), 'utf8');
  assert.match(adapter, /configuredRuntime = String\(codeLabConfig\.containerRuntime \|\| 'auto'\)/);
  assert.match(adapter, /\['auto', 'docker', 'podman'\]\.includes\(configuredRuntime\)/);
  assert.notEqual(codeLab, -1);
  assert.ok(bootstrap < codeLab, 'host dependency check must run before Code Lab initialization');
});

test('npm prestart dependency checker supports a non-mutating dry-run', () => {
  const result = spawnSync(process.execPath, [npmPreflight], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NEXORA_BOOTSTRAP_DRY_RUN: '1' },
    timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NEXORA NPM PREFLIGHT/);
});

test('npm lifecycle invokes dependency preflight before the main start command', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const expectedPreflight = 'node scripts/bootstrap/npm-deps.js && node scripts/sync-env-example.js --strict';
  assert.equal(packageJson.scripts.prestart, expectedPreflight);
  assert.equal(packageJson.scripts.predev, expectedPreflight);
  assert.equal(packageJson.scripts.pretest, expectedPreflight);
  assert.equal(packageJson.scripts.start, 'node src/index.js');
  assert.equal(packageJson.scripts.dev, 'node src/index.js');
});

test('auto bootstrap selects a working Podman fallback without invoking sudo', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocha-bootstrap-auto-fallback-'));
  try {
    const fakeBin = path.join(temp, 'bin');
    fs.mkdirSync(fakeBin, { recursive: true });
    const writeExecutable = (name, body) => {
      const file = path.join(fakeBin, name);
      fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
      fs.chmodSync(file, 0o700);
    };
    const sudoMarker = path.join(temp, 'sudo-called');
    writeExecutable('docker', 'echo "fake docker daemon unavailable" >&2; exit 1');
    writeExecutable('podman', 'case "$1" in info|pull) exit 0 ;; image) exit 0 ;; *) exit 0 ;; esac');
    writeExecutable('cloudflared', 'echo "cloudflared version test"; exit 0');
    writeExecutable('sudo', `touch ${JSON.stringify(sudoMarker)}; exit 99`);
    const result = spawnSync('bash', [script, 'auto', 'python:3.12-alpine', 'node:22-alpine', 'cloudflared'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH || ''}` },
      timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /\[NEXORA_RUNTIME_SELECTED\] podman/);
    assert.match(output, /Runtime aktif tervalidasi: podman/);
    assert.equal(fs.existsSync(sudoMarker), false, 'sudo must not be invoked when runtime fallback works');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('host preflight checks and provisions Git, Python, Go, and Bash when package installation is permitted', () => {
  const shell = fs.readFileSync(script, 'utf8');
  const adapter = fs.readFileSync(path.join(root, 'src', 'runtime', 'bootstrap-agent.js'), 'utf8');
  assert.match(shell, /ensure_cli_tools\(\)/);
  assert.match(shell, /golang-go|golang/);
  assert.match(shell, /NEXORA_CLI_TOOLS/);
  assert.match(adapter, /ensureBashAvailable\(\)/);
  assert.match(adapter, /apt-get.*install.*bash|install.*bash/s);
});

test('Docker bootstrap validates a saved PID before reading its proc cmdline', () => {
  const shell = fs.readFileSync(script, 'utf8');
  const validateAt = shell.indexOf('[[ "$old_pid" =~ ^[0-9]+$ ]]');
  const procAt = shell.indexOf('"/proc/${old_pid}/cmdline"');
  assert.ok(validateAt >= 0 && procAt > validateAt, 'PID validation and liveness check must precede /proc access');
});

test('Code Lab handoff transfers healthy tunnel ownership and adopts only protocol-v2 watchdogs', () => {
  const codeLab = fs.readFileSync(path.join(root, 'src', 'runtime', 'code-lab.js'), 'utf8');
  assert.match(codeLab, /const WATCHDOG_PROTOCOL_VERSION = 2/);
  assert.match(codeLab, /protocolVersion: WATCHDOG_PROTOCOL_VERSION/);
  assert.match(codeLab, /ownerPid: replacementPid/);
  assert.match(codeLab, /Existing healthy TryCloudflare tunnel adopted; no replacement process started/);
  assert.match(codeLab, /watchdogPreserved/);
});

test('bootstrap implementation changes force one host preflight during controlled handoff', () => {
  const index = fs.readFileSync(path.join(root, 'src', 'index.js'), 'utf8');
  const adapter = fs.readFileSync(path.join(root, 'src', 'runtime', 'bootstrap-agent.js'), 'utf8');
  assert.match(index, /relative\.startsWith\('scripts\/bootstrap\/'\)/);
  assert.match(index, /OCHA_HOST_BOOTSTRAP_FORCE: hostBootstrapChanged \? '1' : '0'/);
  assert.match(adapter, /forceFromBootstrapUpdate/);
  assert.match(adapter, /!forceFromBootstrapUpdate && cache\?\.fingerprint/);
});
