import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { watchFiles } from './file-watcher.js';
import dotenv from 'dotenv';
import { logger } from './logger.js';
import { createAutomaticCommitMessage, parseGitIgnore, parsePorcelainZ } from './git-utils.js';
import { isRuntimeWatchIgnored } from './watch-policy.js';
import {
  auditPublicationPaths,
  findPrivateTrackedPaths,
  findProtectedStagedPaths,
  hasPrivateSourceFingerprint,
  isPrivatePublicationPath,
  scanSecrets,
} from './publication-policy.js';
import { getRuntimeSettings } from './runtime-settings.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPOSITORY = 'razzaqinspires/ocha-lidya-whatsapp-bot';
const BRANCH = 'main';
const QUIET_WINDOW_MS = 2200;
const PRETTIER_COMMAND = getRuntimeSettings().tooling.prettierBin || 'npx';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || PROJECT_ROOT,
      env: options.env || process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', chunk => {
      stderr += chunk;
    });
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
  return String(remote || '')
    .trim()
    .replace(/\.git$/i, '')
    .replace(/\/$/, '');
}

function isHardIgnored(relativePath) {
  return isRuntimeWatchIgnored(relativePath);
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

async function getStagedDeletionPaths() {
  const result = await run('git', ['diff', '--cached', '--diff-filter=D', '--name-only', '-z']);
  return result.stdout.split('\0').filter(Boolean);
}

async function assertSafeStaging() {
  const staged = await getStagedPaths();
  const deletions = new Set(await getStagedDeletionPaths());
  const blocked = [];
  for (const filePath of staged) {
    // Explicit removal from the Ocha index is the safe migration path for
    // previously tracked private files; never block those staged deletions.
    if (deletions.has(filePath)) continue;
    if (isHardIgnored(filePath) || (await isIgnoredByGit(filePath))) blocked.push(filePath);
  }
  if (blocked.length) {
    throw new Error(
      `Commit diblokir: ada file ter-stage yang dikecualikan .gitignore/aturan keamanan: ${blocked.join(', ')}`,
    );
  }
}

async function assertRepository() {
  const root = await run('git', ['rev-parse', '--show-toplevel']);
  if (path.resolve(root.stdout.trim()) !== PROJECT_ROOT) {
    throw new Error('Direktori kerja Git tidak sama dengan root proyek Ocha Lidya.');
  }
  const branch = await run('git', ['branch', '--show-current']);
  if (branch.stdout.trim() !== BRANCH) {
    throw new Error(
      `Auto-push hanya berjalan di branch ${BRANCH}; branch aktif: ${branch.stdout.trim() || '(detached HEAD)'}`,
    );
  }
  const remote = await run('git', ['remote', 'get-url', 'origin']);
  if (normalizeGitHubRemote(remote.stdout) !== `https://github.com/${REPOSITORY}`) {
    throw new Error(
      `Remote origin harus menggunakan HTTPS dan mengarah ke https://github.com/${REPOSITORY}. Remote saat ini: ${remote.stdout.trim()}`,
    );
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
    '',
  ].join('\n');
  await fs.writeFile(file, script, { mode: 0o700 });
  await fs.chmod(file, 0o700);
  return {
    file,
    env: { ...process.env, GITHUB_PAT: token, GIT_ASKPASS: file, GIT_TERMINAL_PROMPT: '0' },
  };
}

async function readTrackedOrWorkingFile(filePath) {
  try {
    return await fs.readFile(path.join(PROJECT_ROOT, filePath), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function isScannableTextPath(filePath) {
  return /\.(?:[cm]?[jt]sx?|json|md|ya?ml|css|scss|html|xml|toml|ini|cfg|conf|sh|py|go|php|java|rs|sql)$/i.test(
    filePath,
  );
}

async function assertNoPrivateSourceBytes(filePaths) {
  const failures = [];
  for (const filePath of filePaths) {
    const content = await readTrackedOrWorkingFile(filePath);
    if (content === null) continue;
    if (hasPrivateSourceFingerprint(Buffer.from(content, 'utf8'))) failures.push(filePath);
  }
  if (failures.length) {
    throw new Error(
      `Publikasi dibatalkan: byte identik dengan source privat terdeteksi pada ${failures.join(', ')}. Nilai source tidak dicetak.`,
    );
  }
}

async function assertNoSecrets(filePaths) {
  const failures = [];
  for (const filePath of filePaths) {
    if (isPrivatePublicationPath(filePath) || !isScannableTextPath(filePath)) continue;
    const content = await readTrackedOrWorkingFile(filePath);
    if (content === null) continue; // deletion is safe; no content to publish
    for (const finding of scanSecrets(content)) {
      failures.push(`${filePath}:${finding.line} [${finding.rule}]`);
    }
  }
  if (failures.length) {
    throw new Error(
      `Publikasi dibatalkan: kemungkinan credential terdeteksi. Nilai rahasia tidak dicetak. Periksa ${failures.join(', ')}`,
    );
  }
}

async function formatEligibleFiles(filePaths) {
  const formatTargets = [];
  for (const filePath of filePaths) {
    if (!/\.(?:[cm]?js|jsx|ts|tsx|json|md|yml|yaml|css|scss|html)$/i.test(filePath)) continue;
    try {
      await fs.access(path.join(PROJECT_ROOT, filePath));
      formatTargets.push(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!formatTargets.length) return;
  const prettierCheck = await run(PRETTIER_COMMAND, ['--no-install', 'prettier', '--version'], { allowFailure: true });
  if (prettierCheck.code !== 0) {
    throw new Error(
      'Prettier belum tersedia. Instal dengan `npm install --save-dev prettier`, lalu ulangi sinkronisasi. Auto-push fail-closed; file tidak di-stage.',
    );
  }
  // Format only eligible public files. Protected files never reach this command.
  await run(PRETTIER_COMMAND, ['--no-install', 'prettier', '--write', '--ignore-unknown', ...formatTargets]);
}

async function assertNoProtectedStagedFiles() {
  // Fail closed if any private path is already tracked by the Ocha repository.
  // .gitignore does not untrack files that entered the index in the past.
  const trackedPrivate = await run('git', ['ls-files', '-z', '--', '.private']);
  const privateEntries = findPrivateTrackedPaths(trackedPrivate.stdout.split('\0').filter(Boolean));
  if (privateEntries.length) {
    throw new Error(
      `Auto-push Ocha diblokir: ${privateEntries.length} path di .private masih tercatat dalam Git index. Hapus dari index dengan git rm -r --cached -- .private, review diff, lalu commit perubahan penghapusan. Source lokal tidak dihapus.`,
    );
  }
  const staged = await getStagedPaths();
  const deletions = await getStagedDeletionPaths();
  const protectedPaths = findProtectedStagedPaths(staged, deletions);
  if (protectedPaths.length) {
    throw new Error(
      `Commit diblokir: file privat/aturan khusus ter-stage untuk ditambahkan atau diubah. Hanya penghapusan dari index yang diizinkan: ${protectedPaths.join(', ')}`,
    );
  }
  const stagedFiles = staged.filter(filePath => !deletions.includes(filePath));
  await assertNoPrivateSourceBytes(stagedFiles);
  await assertNoSecrets(stagedFiles);
}

async function stageEligibleChanges() {
  const changedPaths = await getChangedPaths();
  const audit = auditPublicationPaths(changedPaths);
  const eligible = [];
  const ignored = [...audit.privatePaths];
  for (const filePath of audit.eligiblePaths) {
    if (isHardIgnored(filePath) || (await isIgnoredByGit(filePath))) ignored.push(filePath);
    else eligible.push(filePath);
  }
  if (ignored.length) logger.info({ count: ignored.length }, 'File privat/runtime dikecualikan dari publikasi');

  await assertNoPrivateSourceBytes(eligible);
  await assertNoSecrets(eligible);
  await formatEligibleFiles(eligible);
  // Re-scan after formatting because formatters can rewrite source text.
  await assertNoPrivateSourceBytes(eligible);
  await assertNoSecrets(eligible);

  for (const filePath of eligible) {
    await run('git', ['add', '-A', '--', filePath]);
  }
  await assertSafeStaging();
  await assertNoProtectedStagedFiles();

  const staged = await getStagedPaths();
  if (!staged.length) return { staged: 0, ignored: ignored.length };
  await run('git', ['commit', '-m', createAutomaticCommitMessage()]);
  logger.info({ files: staged.length }, 'Perubahan berhasil dibuat menjadi commit otomatis');
  return { staged: staged.length, ignored: ignored.length };
}

async function reconcileRemote(authEnv) {
  const remoteHead = await run('git', ['-c', 'credential.helper=', 'ls-remote', '--heads', 'origin', BRANCH], {
    allowFailure: true,
    env: authEnv,
  });
  if (remoteHead.code !== 0) throw new Error(remoteHead.stderr.trim() || 'Tidak dapat membaca branch remote.');
  if (!remoteHead.stdout.trim()) return; // New, empty remote branch: push will create it.

  await run('git', ['-c', 'credential.helper=', 'fetch', 'origin', BRANCH], { env: authEnv });
  const remoteIsAncestor = await run('git', ['merge-base', '--is-ancestor', `origin/${BRANCH}`, 'HEAD'], {
    allowFailure: true,
  });
  if (remoteIsAncestor.code === 0) return;
  const localIsAncestor = await run('git', ['merge-base', '--is-ancestor', 'HEAD', `origin/${BRANCH}`], {
    allowFailure: true,
  });
  if (localIsAncestor.code === 0) {
    throw new Error(
      `origin/${BRANCH} lebih maju dari HEAD lokal. Auto Git Sync hanya boleh mendorong perubahan lokal; rebase otomatis dinonaktifkan karena dapat mengganti src/*.js ketika bot sedang berjalan dan memicu controlled process restart. Hentikan bot, lalu lakukan git pull --rebase origin ${BRANCH} secara manual.`,
    );
  }
  throw new Error(
    'Branch lokal dan origin/main bercabang. Auto-push dihentikan agar tidak menimpa riwayat GitHub. Selesaikan merge/rebase secara manual.',
  );
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
  await assertNoProtectedStagedFiles();
  const result = await stageEligibleChanges();
  const head = await run('git', ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
  if (head.code !== 0) {
    logger.warn('Belum ada commit awal. Jalankan npm run git:setup lalu buat commit awal sebelum auto-push.');
    return;
  }

  const token = process.env.GITHUB_PAT;
  if (!token) {
    logger.warn('Auto-push menunggu GITHUB_PAT di .env. Perubahan tetap lokal sampai token tersedia.');
    return { ok: false, reason: 'GITHUB_PAT_missing', staged: result.staged };
  }

  const askpass = await prepareAskPass(token);
  try {
    await reconcileRemote(askpass.env);
    await run('git', ['-c', 'credential.helper=', 'push', 'origin', `HEAD:refs/heads/${BRANCH}`], { env: askpass.env });
    logger.info({ branch: BRANCH, repository: REPOSITORY, files: result.staged }, 'Auto Git push selesai');
    return { ok: true, branch: BRANCH, repository: REPOSITORY, files: result.staged };
  } finally {
    await fs.rm(askpass.file, { force: true }).catch(() => {});
  }
}

export async function startAutoGitSync({ root = PROJECT_ROOT, enabled = true, watch = true } = {}) {
  if (path.resolve(root) !== PROJECT_ROOT)
    throw new Error('Auto Git Sync hanya boleh dijalankan dari root proyek Ocha Lidya.');

  // ZIP/source deployments do not contain .git. Disable sync cleanly rather
  // than launching a watcher that repeatedly logs fatal git errors.
  try {
    await assertRepository();
  } catch (error) {
    logger.warn(
      { reason: error.message, root: PROJECT_ROOT },
      'Auto Git Sync nonaktif: folder ini belum siap sebagai clone Git yang valid. Jalankan npm run git:setup setelah konfigurasi Git tersedia.',
    );
    return {
      enabled: Boolean(enabled),
      ready: false,
      async setEnabled(value) {
        this.enabled = Boolean(value);
        return this.getStatus();
      },
      async pushNow() {
        return { ok: false, reason: 'ocha_repository_not_ready' };
      },
      async flush() {
        return { ok: false, reason: 'ocha_repository_not_ready' };
      },
      async getStatus() {
        return {
          target: 'ocha',
          enabled: this.enabled,
          ready: false,
          repository: REPOSITORY,
          branch: BRANCH,
          tokenAvailable: Boolean(process.env.GITHUB_PAT),
          pendingChanges: null,
          reason: 'ocha_repository_not_ready',
        };
      },
      pause() {},
      resume() {},
      async close() {},
    };
  }
  let timer;
  let syncing = false;
  let queued = false;
  let stopped = false;
  let suspended = false;
  let active = Boolean(enabled);
  let lastResult = null;

  const schedule = reason => {
    if (stopped || suspended || !active) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void runSync(reason);
    }, QUIET_WINDOW_MS);
  };

  const runSync = async (reason, { force = false } = {}) => {
    if (stopped || (!active && !force) || (suspended && !force)) return { ok: false, reason: 'disabled_or_paused' };
    if (syncing) {
      queued = true;
      return { ok: false, reason: 'sync_already_running' };
    }
    syncing = true;
    try {
      logger.debug({ reason }, 'Memeriksa perubahan proyek untuk auto-push');
      const result = await syncOnce();
      lastResult = { ok: true, ...result };
      return lastResult;
    } catch (error) {
      lastResult = { ok: false, reason: error.message };
      logger.error({ err: error }, 'Auto Git Sync gagal; perubahan lokal tidak dihapus');
      return lastResult;
    } finally {
      syncing = false;
      if (queued && !stopped && !suspended && active) {
        queued = false;
        schedule('queued filesystem change');
      }
    }
  };

  let watcherFailureHandled = false;
  let watcher = null;
  if (watch) {
    watcher = watchFiles(PROJECT_ROOT, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 700, pollInterval: 100 },
      ignored: candidate => {
        const relative = path.relative(PROJECT_ROOT, candidate);
        return relative && isHardIgnored(relative);
      },
      ignorePermissionErrors: true,
    });

    watcher.on('all', async (event, absolutePath) => {
      const relative = path.relative(PROJECT_ROOT, absolutePath);
      if (!relative || isHardIgnored(relative) || isPrivatePublicationPath(relative)) return;

      // .env is deliberately ignored by Git, but changing it may add/update the PAT.
      if (relative === '.env') {
        if (event === 'unlink') {
          delete process.env.GITHUB_PAT;
          logger.warn('.env dihapus; auto-push dihentikan sampai token disediakan kembali');
        } else {
          dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: true });
          logger.info('.env diperbarui; token tidak pernah dicetak ke log');
        }
        if (watch) schedule('.env secret refresh');
        return;
      }

      if (!active) return;

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
      logger.info(
        { root: PROJECT_ROOT, repository: REPOSITORY, branch: BRANCH, enabled: active },
        'Pemantauan repository Ocha siap',
      );
      schedule('startup reconciliation');
    });
    watcher.on('error', error => {
      if (watcherFailureHandled) return;
      watcherFailureHandled = true;
      if (error?.code === 'ENOSPC') {
        logger.error(
          { code: error.code, syscall: error.syscall, path: error.path },
          'Filesystem watcher kehabisan kuota; Auto Git Sync watcher dihentikan agar tidak membebani runtime. Kecualikan direktori sesi/runtime dan naikkan fs.inotify.max_user_watches bila memang diperlukan.',
        );
        void watcher?.close().catch(() => {});
        return;
      }
      logger.error({ code: error?.code, message: error?.message }, 'Filesystem watcher gagal');
    });
  }

  return {
    enabled: active,
    ready: true,
    watcher,
    async setEnabled(value) {
      active = Boolean(value);
      this.enabled = active;
      if (!active) clearTimeout(timer);
      else if (watcher) schedule('Ocha auto-push enabled');
      return this.getStatus();
    },
    async pushNow() {
      clearTimeout(timer);
      return runSync('manual owner request', { force: true });
    },
    async flush() {
      clearTimeout(timer);
      if (!active) return { ok: false, reason: 'disabled' };
      return runSync('controlled source update flush', { force: true });
    },
    async getStatus() {
      const status = await run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
        allowFailure: true,
      });
      const pending = status.code === 0 ? status.stdout.split('\0').filter(Boolean).length : null;
      return {
        target: 'ocha',
        enabled: active,
        ready: true,
        repository: REPOSITORY,
        branch: BRANCH,
        tokenAvailable: Boolean(process.env.GITHUB_PAT),
        pendingChanges: pending,
        lastResult,
      };
    },
    pause(reason = 'source update batch') {
      suspended = true;
      queued = true;
      clearTimeout(timer);
      logger.debug({ reason }, 'Auto Git Sync paused while a source update batch is being written');
    },
    resume(reason = 'source update batch settled', { sync = true } = {}) {
      if (stopped) return;
      suspended = false;
      if (!sync) {
        queued = false;
        logger.warn({ reason }, 'Auto Git Sync resume skipped because source batch validation was rejected');
        return;
      }
      if (queued && active) {
        queued = false;
        schedule(reason);
      }
    },
    async close() {
      stopped = true;
      clearTimeout(timer);
      await watcher?.close();
    },
  };
}
