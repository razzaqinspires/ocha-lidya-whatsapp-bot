import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const NODE_MODULES = path.join(ROOT, 'node_modules');
const MIN_NODE = [20, 18, 0];

function log(message) {
  process.stdout.write(`[NEXORA NPM PREFLIGHT] ${message}\n`);
}

function nodeVersionAtLeast(actual, minimum) {
  const parts = String(actual).split('.').map(value => Number.parseInt(value, 10) || 0);
  for (let index = 0; index < minimum.length; index += 1) {
    if ((parts[index] || 0) > minimum[index]) return true;
    if ((parts[index] || 0) < minimum[index]) return false;
  }
  return true;
}

function npmInvocation(args, options = {}) {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const commandArgs = npmExecPath ? [npmExecPath, ...args] : args;
  return spawnSync(command, commandArgs, { cwd: ROOT, encoding: 'utf8', ...options });
}

function missingDependencies(packageJson) {
  return Object.keys(packageJson.dependencies || {}).filter(name =>
    !fs.existsSync(path.join(NODE_MODULES, name, 'package.json'))
  );
}

function dependencyTreeIsHealthy() {
  const result = npmInvocation(['ls', '--depth=0', '--json'], { timeout: 60_000 });
  return result.status === 0;
}

if (!nodeVersionAtLeast(process.versions.node, MIN_NODE)) {
  process.stderr.write(`Node.js >= ${MIN_NODE.join('.')} diperlukan; versi saat ini ${process.versions.node}.\n`);
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
let missing = missingDependencies(packageJson);
const treeHealthy = missing.length === 0 && dependencyTreeIsHealthy();
if (treeHealthy) {
  log(`Semua ${Object.keys(packageJson.dependencies || {}).length} dependency utama tersedia dan lolos pemeriksaan npm; tidak menjalankan npm install.`);
  process.exit(0);
}

log(missing.length ? `Dependency belum lengkap: ${missing.join(', ')}` : 'Pohon dependency npm tidak valid atau versinya tidak sesuai; akan menjalankan npm install.');
if (process.env.NEXORA_BOOTSTRAP_DRY_RUN === '1') {
  log('DRY RUN: npm install --no-audit --no-fund akan dijalankan; tidak ada perubahan dilakukan.');
  process.exit(0);
}

log('Memasang atau menyelaraskan dependency project. Proses ini hanya berjalan jika dependency hilang atau pohonnya tidak valid.');
const installArgs = ['install', '--no-audit', '--no-fund'];
const installResult = npmInvocation(installArgs, {
  stdio: 'inherit',
  env: { ...process.env, NPM_CONFIG_FUND: 'false', NPM_CONFIG_AUDIT: 'false' },
  timeout: 20 * 60_000,
  windowsHide: true
});
const result = installResult;
if (result.error) {
  process.stderr.write(`npm install gagal: ${result.error.message}\n`);
  process.exit(1);
}
if (result.status !== 0) {
  process.stderr.write(`npm install berhenti dengan exit code ${result.status ?? 'null'}.\n`);
  process.exit(result.status || 1);
}
missing = missingDependencies(packageJson);
if (missing.length || !dependencyTreeIsHealthy()) {
  process.stderr.write(`Dependency masih belum lengkap/valid setelah npm install: ${missing.join(', ') || 'npm ls reported an invalid tree'}\n`);
  process.exit(1);
}
log('Semua dependency project berhasil disiapkan dan tervalidasi.');
