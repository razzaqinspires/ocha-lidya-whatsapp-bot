import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { watchFiles } from './file-watcher.js';
import { logger } from './logger.js';
import { createAutomaticCommitMessage, parsePorcelainZ } from './git-utils.js';
import { scanSecrets } from './publication-policy.js';
import {
  AC_BRANCH,
  AC_REMOTE,
  AC_REPOSITORY,
  AC_ROOT,
  isAcRuntimeIgnored,
  normalizeAcRemote,
} from './ac-git-policy.js';

function run(command, args, { cwd = AC_ROOT, env = process.env, allowFailure = false, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      const error = new Error(`${command} ${args.join(' ')} timeout after ${timeoutMs}ms`);
      error.code = 'ETIMEDOUT';
      finish(error);
    }, timeoutMs);
    timer.unref?.();
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    child.stdout.setEncoding('utf8').on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', chunk => {
      stderr += chunk;
    });
    child.once('error', finish);
    child.once('close', code => {
      const result = { code: code ?? 1, stdout, stderr };
      if (allowFailure || code === 0) finish(null, result);
      else finish(Object.assign(new Error(stderr.trim() || `${command} ${args.join(' ')} exited ${code}`), result));
    });
  });
}

function isTextPath(filePath) {
  return /\.(?:py|pyi|md|txt|toml|json|ya?ml|ini|cfg|conf|sh|ps1|bat|sql|gitignore)$/i.test(filePath);
}

async function isIgnoredByGit(root, relativePath) {
  const result = await run('git', ['check-ignore', '--no-index', '-q', '--', relativePath], {
    cwd: root,
    allowFailure: true,
  });
  return result.code === 0;
}

async function assertRegularFile(root, relativePath) {
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error(`Path AC keluar dari repository: ${relativePath}`);
  try {
    const info = await fs.lstat(absolute);
    if (info.isSymbolicLink()) throw new Error(`Symlink ditolak pada repository AC: ${relativePath}`);
    if (!info.isFile()) throw new Error(`Hanya file biasa yang dapat dipublikasikan: ${relativePath}`);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  return true;
}

async function getChangedPaths(root) {
  const result = await run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root });
  return parsePorcelainZ(result.stdout);
}

async function getStagedPaths(root) {
  const result = await run('git', ['diff', '--cached', '--name-only', '-z'], { cwd: root });
  return result.stdout.split('\0').filter(Boolean);
}

async function assertStagedSafe(root) {
  const staged = await getStagedPaths(root);
  for (const relativePath of staged) {
    if (isAcRuntimeIgnored(relativePath)) throw new Error(`Commit AC diblokir oleh aturan runtime: ${relativePath}`);
    if (await isIgnoredByGit(root, relativePath))
      throw new Error(`Commit AC diblokir oleh .gitignore: ${relativePath}`);
    const exists = await assertRegularFile(root, relativePath);
    if (!exists) continue;
    if (isTextPath(relativePath)) {
      const content = await fs.readFile(path.join(root, relativePath), 'utf8');
      const findings = scanSecrets(content);
      if (findings.length)
        throw new Error(
          `Publikasi AC diblokir: pola secret terdeteksi pada ${relativePath}:${findings.map(item => item.line).join(',')}. Nilai tidak dicetak.`,
        );
    }
  }
}

async function assertAcRepository(root) {
  const top = await run('git', ['rev-parse', '--show-toplevel'], { cwd: root });
  if (path.resolve(top.stdout.trim()) !== path.resolve(root))
    throw new Error('Root Git nested tidak sama dengan .private/artificial-consciousness-component.');
  const branch = await run('git', ['branch', '--show-current'], { cwd: root });
  if (branch.stdout.trim() !== AC_BRANCH)
    throw new Error(
      `Repository AC wajib memakai branch ${AC_BRANCH}; branch aktif: ${branch.stdout.trim() || '(detached HEAD)'}`,
    );
  const remote = await run('git', ['remote', 'get-url', 'origin'], { cwd: root });
  if (normalizeAcRemote(remote.stdout) !== normalizeAcRemote(AC_REMOTE))
    throw new Error(`Remote origin repository AC harus ${AC_REMOTE}; remote aktif tidak cocok.`);
}

async function prepareAskPass(token) {
  const file = path.join(os.tmpdir(), `ocha-ac-git-askpass-${process.pid}-${Date.now()}.sh`);
  const content = [
    '#!/bin/sh',
    'case "$1" in',
    '  *Username*) printf "%s\\n" "x-access-token" ;;',
    '  *Password*) printf "%s\\n" "$GITHUB_PAT" ;;',
    '  *) exit 1 ;;',
    'esac',
    '',
  ].join('\n');
  await fs.writeFile(file, content, { mode: 0o700, flag: 'wx' });
  return { file, env: { ...process.env, GITHUB_PAT: token, GIT_ASKPASS: file, GIT_TERMINAL_PROMPT: '0' } };
}

async function stageEligibleChanges(root) {
  const changedPaths = await getChangedPaths(root);
  const eligible = [];
  for (const relativePath of changedPaths) {
    if (isAcRuntimeIgnored(relativePath) || (await isIgnoredByGit(root, relativePath))) continue;
    await assertRegularFile(root, relativePath);
    if (
      await fs
        .lstat(path.join(root, relativePath))
        .catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error)))
    ) {
      if (isTextPath(relativePath)) {
        const content = await fs.readFile(path.join(root, relativePath), 'utf8');
        const findings = scanSecrets(content);
        if (findings.length)
          throw new Error(
            `Publikasi AC diblokir: pola secret terdeteksi pada ${relativePath}:${findings.map(item => item.line).join(',')}. Nilai tidak dicetak.`,
          );
      }
    }
    eligible.push(relativePath);
  }

  for (const relativePath of eligible) {
    await run('git', ['add', '-A', '--', relativePath], { cwd: root });
  }
  await assertStagedSafe(root);
  const staged = await getStagedPaths(root);
  if (!staged.length) return { staged: 0 };
  await run('git', ['commit', '-m', createAutomaticCommitMessage()], { cwd: root });
  return { staged: staged.length };
}

async function reconcileRemote(root, authEnv) {
  const remoteHead = await run('git', ['-c', 'credential.helper=', 'ls-remote', '--heads', 'origin', AC_BRANCH], {
    cwd: root,
    env: authEnv,
    allowFailure: true,
  });
  if (remoteHead.code !== 0) throw new Error(remoteHead.stderr.trim() || 'Tidak dapat membaca remote repository AC.');
  if (!remoteHead.stdout.trim()) return;
  await run('git', ['-c', 'credential.helper=', 'fetch', 'origin', AC_BRANCH], { cwd: root, env: authEnv });
  const remoteIsAncestor = await run('git', ['merge-base', '--is-ancestor', `origin/${AC_BRANCH}`, 'HEAD'], {
    cwd: root,
    allowFailure: true,
  });
  if (remoteIsAncestor.code === 0) return;
  const localIsAncestor = await run('git', ['merge-base', '--is-ancestor', 'HEAD', `origin/${AC_BRANCH}`], {
    cwd: root,
    allowFailure: true,
  });
  if (localIsAncestor.code === 0)
    throw new Error(
      `origin/${AC_BRANCH} lebih maju dari working tree AC. Hentikan bot, lalu sinkronkan dengan git pull --rebase origin ${AC_BRANCH}.`,
    );
  throw new Error(
    `Branch lokal AC dan origin/${AC_BRANCH} bercabang. Push diblokir; selesaikan merge/rebase manual. Force-push tidak pernah digunakan.`,
  );
}

async function syncOnce(root) {
  await assertAcRepository(root);
  await assertStagedSafe(root);
  const result = await stageEligibleChanges(root);
  const head = await run('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, allowFailure: true });
  if (head.code !== 0) return { ok: false, reason: 'initial_commit_required', staged: result.staged };
  const token = process.env.GITHUB_PAT;
  if (!token) return { ok: false, reason: 'GITHUB_PAT_missing', staged: result.staged };
  const askpass = await prepareAskPass(token);
  try {
    await reconcileRemote(root, askpass.env);
    await run('git', ['-c', 'credential.helper=', 'push', 'origin', `HEAD:refs/heads/${AC_BRANCH}`], {
      cwd: root,
      env: askpass.env,
    });
    const current = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: root });
    logger.info(
      { branch: AC_BRANCH, repository: AC_REPOSITORY, files: result.staged, commit: current.stdout.trim() },
      'AC component auto-push selesai',
    );
    return {
      ok: true,
      staged: result.staged,
      commit: current.stdout.trim(),
      repository: AC_REPOSITORY,
      branch: AC_BRANCH,
    };
  } finally {
    await fs.rm(askpass.file, { force: true }).catch(() => {});
  }
}

function unavailableHandle(reason, enabled) {
  return {
    enabled,
    ready: false,
    async setEnabled(value) {
      this.enabled = Boolean(value);
      return this.getStatus();
    },
    async pushNow() {
      return { ok: false, reason };
    },
    async flush() {
      return { ok: false, reason };
    },
    async getStatus() {
      return {
        target: 'ac',
        enabled: this.enabled,
        ready: false,
        reason,
        repository: AC_REPOSITORY,
        branch: AC_BRANCH,
        tokenAvailable: Boolean(process.env.GITHUB_PAT),
      };
    },
    pause() {},
    resume() {},
    async close() {},
  };
}

export async function startAcAutoGitSync({ root = AC_ROOT, enabled = true, watch = true } = {}) {
  const resolvedRoot = path.resolve(root);
  if (resolvedRoot !== path.resolve(AC_ROOT))
    throw new Error('AC Auto Git Sync hanya boleh berjalan pada .private/artificial-consciousness-component.');
  try {
    await fs.access(resolvedRoot);
  } catch {
    logger.warn({ root: resolvedRoot }, 'AC Auto Git Sync belum aktif: source component belum tersedia.');
    return unavailableHandle('component_directory_missing', enabled);
  }

  try {
    await assertAcRepository(resolvedRoot);
  } catch (error) {
    logger.warn(
      { reason: error.message, root: resolvedRoot },
      'AC Auto Git Sync menunggu nested clone yang valid. Jalankan npm run ac:git:setup, lalu restart Ocha.',
    );
    return unavailableHandle('nested_git_repository_not_ready', enabled);
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
    timer.unref?.();
  };

  const runSync = async (reason, { force = false } = {}) => {
    if (stopped || (!active && !force) || (suspended && !force)) return { ok: false, reason: 'disabled_or_paused' };
    if (syncing) {
      queued = true;
      return { ok: false, reason: 'sync_already_running' };
    }
    syncing = true;
    try {
      logger.debug({ reason, repository: AC_REPOSITORY }, 'Memeriksa perubahan AC untuk auto-push');
      lastResult = await syncOnce(resolvedRoot);
      if (!lastResult.ok && lastResult.reason)
        logger.warn({ reason: lastResult.reason }, 'AC auto-push belum dapat menyelesaikan publikasi');
      return lastResult;
    } catch (error) {
      lastResult = { ok: false, reason: error.message };
      logger.error({ err: error }, 'AC Auto Git Sync gagal; perubahan lokal dipertahankan');
      return lastResult;
    } finally {
      syncing = false;
      if (queued && !stopped && !suspended && active) {
        queued = false;
        schedule('queued AC filesystem change');
      }
    }
  };

  let watcher = null;
  if (watch) {
    watcher = watchFiles(resolvedRoot, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 700, pollInterval: 100 },
      ignored: candidate => {
        const relative = path.relative(resolvedRoot, candidate);
        return relative && isAcRuntimeIgnored(relative);
      },
      ignorePermissionErrors: true,
    });

    watcher.on('all', async (event, absolutePath) => {
      const relative = path.relative(resolvedRoot, absolutePath).replaceAll(path.sep, '/');
      if (!relative || isAcRuntimeIgnored(relative)) return;
      try {
        if (await isIgnoredByGit(resolvedRoot, relative)) return;
      } catch (error) {
        logger.warn({ err: error, file: relative }, 'Aturan .gitignore AC belum dapat diperiksa; sinkronisasi ditunda');
        return;
      }
      logger.debug({ file: relative, event }, 'Perubahan source AC terdeteksi');
      schedule(`${event}: ${relative}`);
    });

    watcher.on('ready', () => {
      logger.info(
        { root: resolvedRoot, repository: AC_REPOSITORY, branch: AC_BRANCH, enabled: active },
        'AC component watcher siap',
      );
      schedule('AC startup reconciliation');
    });
    watcher.on('error', error =>
      logger.error({ code: error?.code, message: error?.message }, 'AC component filesystem watcher gagal'),
    );
  }

  return {
    enabled: active,
    ready: true,
    async setEnabled(value) {
      active = Boolean(value);
      this.enabled = active;
      if (!active) clearTimeout(timer);
      else if (watcher) schedule('AC auto-push enabled');
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
        cwd: resolvedRoot,
        allowFailure: true,
      });
      const pending = status.code === 0 ? status.stdout.split('\0').filter(Boolean).length : null;
      return {
        target: 'ac',
        enabled: active,
        ready: true,
        repository: AC_REPOSITORY,
        branch: AC_BRANCH,
        tokenAvailable: Boolean(process.env.GITHUB_PAT),
        pendingChanges: pending,
        lastResult,
      };
    },
    pause(reason = 'source update batch') {
      suspended = true;
      queued = true;
      clearTimeout(timer);
      logger.debug({ reason }, 'AC Auto Git Sync paused during source update batch');
    },
    resume(reason = 'source update batch settled', { sync = true } = {}) {
      if (stopped) return;
      suspended = false;
      if (!sync) {
        queued = false;
        return;
      }
      if (queued) {
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
