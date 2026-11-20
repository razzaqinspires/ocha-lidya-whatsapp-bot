import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
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
  const result = spawnSync('bash', [script, 'docker', 'python:3.12-alpine', 'node:22-alpine', 'cloudflared'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NEXORA_BOOTSTRAP_DRY_RUN: '1' },
    timeout: 15_000
  });
  assert.equal(result.status, 0, result.stderr);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /DRY RUN/);
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
  assert.notEqual(codeLab, -1);
  assert.ok(bootstrap < codeLab, 'host dependency check must run before Code Lab initialization');
});

test('npm prestart dependency checker supports a non-mutating dry-run', () => {
  const result = spawnSync(process.execPath, [npmPreflight], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NEXORA_BOOTSTRAP_DRY_RUN: '1' },
    timeout: 15_000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NEXORA NPM PREFLIGHT/);
});

test('npm lifecycle invokes dependency preflight before the main start command', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.prestart, 'node scripts/bootstrap/npm-deps.js');
  assert.equal(packageJson.scripts.start, 'node src/index.js');
});
