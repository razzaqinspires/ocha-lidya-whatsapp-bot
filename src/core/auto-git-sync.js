import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import dotenv from 'dotenv';
import { logger } from './logger.js';
import { createAutomaticCommitMessage, parseGitIgnore, parsePorcelainZ } from './git-utils.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPOSITORY = 'razzaqinspires/ocha-lidya-whatsapp-bot';
const BRANCH = 'main';
const QUIET_WINDOW_MS = 1800;
const HARD_IGNORES = new Set(['.git', 'node_modules']);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || PROJECT_ROOT,
      env: options.env || process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
    child.on('close', code => {
      const result = { code: code ?? 1, stdout, stderr };
      if (options.allowFailure || code === 0) resolve(result);
      else reject(Object.assign(new Error(stderr.trim() || `${command} ${args.join(' ')} exited ${code}`), result));
    });
  });
}

function normalizeGitHubRemote(remote) {
  return String(remote || '').trim().replace(/\.git$/i, '').replace(/\/$/, '');
}

function isHardIgnored(relativePath) {
  const parts = relativePath.split(path.sep).filter(Boolean);
  return parts.some(part => HARD_IGNORES.has(part));
}

async function isIgnoredByGit(relativePath) {
  const result = await run('git', ['check-ignore', '--no-index', '-q', '--', relativePath], { allowFailure: true });
  return result.code === 0;
}

async function getChangedPaths() {
  const result = await run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  return parsePorcelainZ(result.stdout);
}

async function getStagedPaths() {
  const result = await run('git', ['diff', '--cached', '--name-only', '-z']);
  return result.stdout.split('\0').filter(Boolean);
}

async function assertSafeStaging() {
  const staged = await getStagedPaths();
  const blocked = [];
  for (const filePath of staged) {
    if (isHardIgnored(filePath) || await isIgnoredByGit(filePath)) blocked.push(filePath);
  }
  if (blocked.length) {
    throw new Error(`Commit diblokir: ada file ter-stage yang dikecualikan .gitignore/aturan keamanan: ${blocked.join(', ')}`);
  }
}

async function assertRepository() {
  const root = await run('git', ['rev-parse', '--show-toplevel']);
  if (path.resolve(root.stdout.trim()) !== PROJECT_ROOT) {
    throw new Error('Direktori kerja Git tidak sama dengan root proyek Ocha Lidya.');
  }
  const branch = await run('git', ['branch', '--show-current']);
  if (branch.stdout.trim() !== BRANCH) {
    throw new Error(`Auto-push hanya berjalan di branch ${BRANCH}; branch aktif: ${branch.stdout.trim() || '(detached HEAD)'}`);
  }
  const remote = await run('git', ['remote', 'get-url', 'origin']);
  if (normalizeGitHubRemote(remote.stdout) !== `https://github.com/${REPOSITORY}`) {
    throw new Error(`Remote origin harus menggunakan HTTPS dan mengarah ke https://github.com/${REPOSITORY}. Remote saat ini: ${remote.stdout.trim()}`);
  }
}

async function prepareAskPass(token) {
  const file = path.join(os.tmpdir(), `ocha-git-askpass-${process.pid}.sh`);
  const script = [
    '#!/bin/sh',
    'case "$1" in',
    '  *Username*) printf "%s\\n" "x-access-token" ;;',
    '  *Password*) printf "%s\\n" "$GITHUB_PAT" ;;',
    '  *) exit 1 ;;',
    'esac',
    ''
  ].join('\n');
  await fs.writeFile(file, script, { mode: 0o700 });
  await fs.chmod(file, 0o700);
  return {
    file,
    env: { ...process.env, GITHUB_PAT: token, GIT_ASKPASS: file, GIT_TERMINAL_PROMPT: '0' }
  };
}

async function stageEligibleChanges() {
  const changedPaths = await getChangedPaths();
  const eligible = [];
  const ignored = [];
  for (const filePath of changedPaths) {
    if (isHardIgnored(filePath) || await isIgnoredByGit(filePath)) ignored.push(filePath);
    else eligible.push(filePath);
  }
  if (ignored.length) logger.debug({ count: ignored.length }, 'Perubahan yang dikecualikan .gitignore dilewati');

  for (const filePath of eligible) {
    await run('git', ['add', '-A', '--', filePath]);
  }
  await assertSafeStaging();

  const staged = await getStagedPaths();
  if (!staged.length) return { staged: 0, ignored: ignored.length };
  await run('git', ['commit', '-m', createAutomaticCommitMessage()]);
  logger.info({ files: staged.length }, 'Perubahan berhasil dibuat menjadi commit otomatis');
  return { staged: staged.length, ignored: ignored.length };
}

async function reconcileRemote(authEnv) {
  const remoteHead = await run('git', ['-c', 'credential.helper=', 'ls-remote', '--heads', 'origin', BRANCH], { allowFailure: true, env: authEnv });
  if (remoteHead.code !== 0) throw new Error(remoteHead.stderr.trim() || 'Tidak dapat membaca branch remote.');
  if (!remoteHead.stdout.trim()) return; // New, empty remote branch: push will create it.

  await run('git', ['-c', 'credential.helper=', 'fetch', 'origin', BRANCH], { env: authEnv });
  const remoteIsAncestor = await run('git', ['merge-base', '--is-ancestor', `origin/${BRANCH}`, 'HEAD'], { allowFailure: true });
  if (remoteIsAncestor.code === 0) return;
  const localIsAncestor = await run('git', ['merge-base', '--is-ancestor', 'HEAD', `origin/${BRANCH}`], { allowFailure: true });
  if (localIsAncestor.code === 0) {
    await run('git', ['rebase', `origin/${BRANCH}`]);
    return;
  }
  throw new Error('Branch lokal dan origin/main bercabang. Auto-push dihentikan agar tidak menimpa riwayat GitHub. Selesaikan merge/rebase secara manual.');
}

async function syncOnce() {
  const gitignorePath = path.join(PROJECT_ROOT, '.gitignore');
  let ignoreRules = [];
  try {
    ignoreRules = parseGitIgnore(await fs.readFile(gitignorePath, 'utf8'));
  } catch (error) {
    throw new Error(`Tidak dapat membaca .gitignore: ${error.message}`);
  }
  logger.debug({ patterns: ignoreRules.length }, '.gitignore dibaca sebelum proses staging');

  await assertRepository();
  const result = await stageEligibleChanges();
  const head = await run('git', ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
  if (head.code !== 0) {
    logger.warn('Belum ada commit awal. Jalankan npm run git:setup lalu buat commit awal sebelum auto-push.');
    return;
  }

  const token = process.env.GITHUB_PAT;
  if (!token) {
    logger.warn('Auto-push menunggu GITHUB_PAT di .env. Perubahan tetap lokal sampai token tersedia.');
    return;
  }

  const askpass = await prepareAskPass(token);
  try {
    await reconcileRemote(askpass.env);
    await run('git', ['-c', 'credential.helper=', 'push', 'origin', `HEAD:refs/heads/${BRANCH}`], { env: askpass.env });
    logger.info({ branch: BRANCH, repository: REPOSITORY, files: result.staged }, 'Auto Git push selesai');
  } finally {
    await fs.rm(askpass.file, { force: true }).catch(() => {});
  }
}

export async function startAutoGitSync({ root = PROJECT_ROOT } = {}) {
  if (path.resolve(root) !== PROJECT_ROOT) throw new Error('Auto Git Sync hanya boleh dijalankan dari root proyek Ocha Lidya.');

  // ZIP/source deployments do not contain .git. Disable sync cleanly rather
  // than launching a watcher that repeatedly logs fatal git errors.
  try {
    await assertRepository();
  } catch (error) {
    logger.warn({ reason: error.message, root: PROJECT_ROOT }, 'Auto Git Sync nonaktif: folder ini belum siap sebagai clone Git yang valid. Jalankan npm run git:setup setelah konfigurasi Git tersedia.');
    return { enabled: false, async close() {} };
  }
  let timer;
  let syncing = false;
  let queued = false;
  let stopped = false;

  const schedule = reason => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void runSync(reason);
    }, QUIET_WINDOW_MS);
  };

  const runSync = async reason => {
    if (syncing) { queued = true; return; }
    syncing = true;
    try {
      logger.debug({ reason }, 'Memeriksa perubahan proyek untuk auto-push');
      await syncOnce();
    } catch (error) {
      logger.error({ err: error }, 'Auto Git Sync gagal; perubahan lokal tidak dihapus');
    } finally {
      syncing = false;
      if (queued && !stopped) {
        queued = false;
        schedule('queued filesystem change');
      }
    }
  };

  const watcher = chokidar.watch(PROJECT_ROOT, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 700, pollInterval: 100 },
    ignored: candidate => {
      const relative = path.relative(PROJECT_ROOT, candidate);
      return relative && isHardIgnored(relative);
    },
    ignorePermissionErrors: true
  });

  watcher.on('all', async (event, absolutePath) => {
    const relative = path.relative(PROJECT_ROOT, absolutePath);
    if (!relative || isHardIgnored(relative)) return;

    // .env is deliberately ignored by Git, but changing it may add/update the PAT.
    if (relative === '.env') {
      if (event === 'unlink') {
        delete process.env.GITHUB_PAT;
        logger.warn('.env dihapus; auto-push dihentikan sampai token disediakan kembali');
      } else {
        dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: true });
        logger.info('.env diperbarui; token tidak pernah dicetak ke log');
      }
      schedule('.env secret refresh');
      return;
    }

    try {
      if (await isIgnoredByGit(relative)) {
        logger.debug({ file: relative, event }, 'File dikecualikan .gitignore; tidak akan di-stage');
        return;
      }
    } catch (error) {
      logger.warn({ err: error, file: relative }, 'Aturan .gitignore belum dapat diperiksa; sinkronisasi ditunda');
      return;
    }

    logger.debug({ file: relative, event }, 'Perubahan file terdeteksi');
    schedule(`${event}: ${relative}`);
  });

  watcher.on('ready', () => {
    logger.info({ root: PROJECT_ROOT, repository: REPOSITORY, branch: BRANCH }, 'Pemantauan seluruh file proyek aktif');
    schedule('startup reconciliation');
  });
  watcher.on('error', error => logger.error({ err: error }, 'Filesystem watcher error'));

  return {
    watcher,
    async close() {
      stopped = true;
      clearTimeout(timer);
      await watcher.close();
    }
  };
}
