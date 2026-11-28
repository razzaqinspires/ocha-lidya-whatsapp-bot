import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getRuntimeSettings } from '../../src/core/runtime-settings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const settings = getRuntimeSettings().llama || {};
const log = message => process.stdout.write(`[OCHA LLAMA PREFLIGHT] ${message}\n`);
const warn = message => process.stderr.write(`[OCHA LLAMA PREFLIGHT] ${message}\n`);
const localBinary = path.join(
  ROOT,
  'data',
  'llama',
  'runtime',
  'bin',
  process.platform === 'win32' ? 'ollama.exe' : 'ollama',
);

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', timeout: 30_000, windowsHide: true, ...options });
}
function check(binary) {
  const result = run(binary, ['--version'], { timeout: 15_000 });
  return !result.error && result.status === 0;
}
function commandExists(command) {
  const result = run(
    process.platform === 'win32' ? 'where' : 'sh',
    process.platform === 'win32' ? [command] : ['-lc', `command -v ${command}`],
  );
  return !result.error && result.status === 0;
}
function ensureLinuxDependencies() {
  const required = ['curl', 'tar', 'zstd'];
  const missing = required.filter(command => !commandExists(command));
  if (!missing.length) return true;
  const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
  const sudo = uid === 0 ? '' : commandExists('sudo') ? 'sudo' : null;
  if (sudo === null) return false;
  const manager = ['apt-get', 'dnf', 'pacman'].find(commandExists);
  if (!manager) return false;
  const prefix = sudo ? [sudo, '-n'] : [];
  const invoke = (args, timeout = 8 * 60_000) => {
    const result = run(prefix[0] || manager, prefix.length ? [manager, ...args] : args, { timeout, stdio: 'inherit' });
    return !result.error && result.status === 0;
  };
  if (manager === 'apt-get' && !invoke(['update'], 10 * 60_000)) return false;
  const args =
    manager === 'apt-get'
      ? ['install', '-y', ...missing]
      : manager === 'dnf'
        ? ['install', '-y', ...missing]
        : ['-Sy', '--noconfirm', ...missing];
  if (!invoke(args)) return false;
  return required.every(commandExists);
}

if (settings.enabled === false) {
  log('Local Llama fallback dinonaktifkan melalui config/runtime.json.');
  process.exit(0);
}

const configuredBinary = String(settings.binary || 'ollama');
const candidate = fs.existsSync(localBinary) ? localBinary : configuredBinary;
if (check(candidate)) {
  log(`${candidate} tersedia. Model server TIDAK dijalankan saat startup.`);
  process.exit(0);
}
if (settings.autoInstallRuntime !== true) {
  warn(
    `${configuredBinary} belum terpasang dan autoInstallRuntime=false; Ocha tetap dapat berjalan tanpa local fallback.`,
  );
  process.exit(0);
}
if (process.platform === 'android') {
  warn('Android/Termux tidak didukung oleh binary Ollama resmi. Jalankan Ocha pada host Linux/macOS yang kompatibel.');
  process.exit(0);
}
const dryRun = Boolean(settings.dryRun || process.env.OCHA_LLAMA_BOOTSTRAP_DRY_RUN === '1');
if (dryRun) {
  log('DRY RUN: runtime Ollama akan dipasang tanpa mengaktifkan server/service background.');
  process.exit(0);
}

if (process.platform === 'linux') {
  const arch = os.arch() === 'x64' ? 'amd64' : os.arch() === 'arm64' ? 'arm64' : null;
  if (!arch) {
    warn(`Arsitektur ${os.arch()} belum didukung oleh paket Ollama Linux resmi.`);
    process.exit(0);
  }
  if (!ensureLinuxDependencies()) {
    warn(
      'curl, tar, dan zstd diperlukan. Dependensi tidak dapat dipasang secara non-interaktif; pasang paket tersebut lalu jalankan npm start kembali.',
    );
    process.exit(0);
  }
  const runtimeRoot = path.join(ROOT, 'data', 'llama', 'runtime');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ocha-ollama-install-'));
  const archive = path.join(tempRoot, 'ollama.tar.zst');
  const tarFile = path.join(tempRoot, 'ollama.tar');
  try {
    fs.mkdirSync(runtimeRoot, { recursive: true });
    const url = `https://ollama.com/download/ollama-linux-${arch}.tar.zst`;
    log(`Mengunduh binary resmi ${arch} ke direktori privat Ocha; tidak membuat systemd service.`);
    const download = run('curl', ['--fail', '--show-error', '--location', '--retry', '2', '--output', archive, url], {
      timeout: 20 * 60_000,
      stdio: 'inherit',
    });
    if (download.error || download.status !== 0)
      throw new Error(`Download gagal: ${download.error?.message || download.status}`);
    const decompress = run('zstd', ['-d', '--force', archive, '-o', tarFile], {
      timeout: 10 * 60_000,
      stdio: 'inherit',
    });
    if (decompress.error || decompress.status !== 0)
      throw new Error(`Ekstraksi zstd gagal: ${decompress.error?.message || decompress.status}`);
    const extract = run('tar', ['-xf', tarFile, '-C', runtimeRoot], { timeout: 10 * 60_000, stdio: 'inherit' });
    if (extract.error || extract.status !== 0)
      throw new Error(`Ekstraksi Ollama gagal: ${extract.error?.message || extract.status}`);
    if (!check(localBinary)) throw new Error('Binary lokal hasil ekstraksi tidak lolos `ollama --version`.');
    log(
      `Ollama berhasil dipasang di ${path.relative(ROOT, runtimeRoot)}. Tidak ada service/systemd yang dibuat atau dijalankan.`,
    );
  } catch (error) {
    warn(`Instalasi lokal belum selesai: ${error.message}. Ocha tetap dapat start; final Llama fallback belum siap.`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  process.exit(0);
}

if (process.platform === 'darwin') {
  // OLLAMA_NO_START=1 prevents the official macOS installer from opening the app.
  const script = run('curl', ['--fail', '--show-error', '--location', 'https://ollama.com/install.sh'], {
    timeout: 60_000,
  });
  if (script.error || script.status !== 0 || !script.stdout.includes('OLLAMA_NO_START')) {
    warn('Installer resmi macOS tidak dapat diverifikasi; pemasangan otomatis dibatalkan.');
    process.exit(0);
  }
  const install = run('sh', ['-s'], {
    input: script.stdout,
    timeout: Number(settings.installTimeoutMs) || 20 * 60_000,
    env: { ...process.env, OLLAMA_NO_START: '1' },
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (install.error || install.status !== 0 || !check(configuredBinary)) {
    warn(`Instalasi macOS belum terverifikasi: ${install.error?.message || install.status}.`);
    process.exit(0);
  }
  log('Ollama terpasang; OLLAMA_NO_START mencegah app dimulai selama bootstrap.');
  process.exit(0);
}

warn(
  `Platform ${process.platform} belum memiliki installer otomatis yang dapat menjamin service tidak dijalankan. Pasang Ollama manual lalu jalankan npm start kembali.`,
);
process.exit(0);
