import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AC_BRANCH,
  AC_REMOTE,
  AC_ROOT,
  AC_REPOSITORY,
  isAcRuntimeIgnored,
  isExpectedNestedAcGitRoot,
  normalizeAcRemote,
} from '../src/core/ac-git-policy.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUTOMATION_DIR = path.join(PROJECT_ROOT, '.private', 'automation');

function run(command, args, { cwd = PROJECT_ROOT, env = process.env, allowFailure = false, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(Object.assign(new Error(`${command} timeout`), { code: 'ETIMEDOUT' }));
    }, timeoutMs);
    timer.unref?.();
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(result);
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

async function makeAskPass(token) {
  const file = path.join(os.tmpdir(), `ocha-ac-setup-askpass-${process.pid}-${Date.now()}.sh`);
  const script = [
    '#!/bin/sh',
    'case "$1" in',
    '  *Username*) printf "%s\\n" "x-access-token" ;;',
    '  *Password*) printf "%s\\n" "$AC_GITHUB_PAT" ;;',
    '  *) exit 1 ;;',
    'esac',
    '',
  ].join('\n');
  await fs.writeFile(file, script, { mode: 0o700, flag: 'wx' });
  return { file, env: { ...process.env, AC_GITHUB_PAT: token, GIT_ASKPASS: file, GIT_TERMINAL_PROMPT: '0' } };
}

function shouldCopy(relative) {
  return !isAcRuntimeIgnored(relative);
}

async function walkFiles(directory, relative = '', output = []) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const rel = relative ? path.join(relative, entry.name) : entry.name;
    if (!shouldCopy(rel)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink ditolak pada snapshot AC: ${rel}`);
    if (entry.isDirectory()) await walkFiles(full, rel, output);
    else if (entry.isFile()) output.push(rel);
  }
  return output;
}

async function copySnapshot(snapshotRoot, destinationRoot) {
  const files = await walkFiles(snapshotRoot);
  for (const relative of files) {
    const source = path.join(snapshotRoot, relative);
    const destination = path.join(destinationRoot, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
  return files.length;
}

async function readVersion(directory) {
  try {
    const release = JSON.parse(await fs.readFile(path.join(directory, 'OCHA_COMPONENT_RELEASE.json'), 'utf8'));
    return String(release.version || '');
  } catch {
    return '';
  }
}

function compareVersions(left, right) {
  const parse = value =>
    String(value)
      .replace(/^v/, '')
      .split('.')
      .map(part => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return 1;
    if ((a[index] || 0) < (b[index] || 0)) return -1;
  }
  return 0;
}

async function fileDigest(file) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');
}

async function treesEqual(leftRoot, rightRoot) {
  const leftFiles = (await walkFiles(leftRoot)).sort();
  const rightFiles = (await walkFiles(rightRoot)).sort();
  if (leftFiles.length !== rightFiles.length || leftFiles.some((file, index) => file !== rightFiles[index]))
    return false;
  for (const relative of leftFiles) {
    if ((await fileDigest(path.join(leftRoot, relative))) !== (await fileDigest(path.join(rightRoot, relative))))
      return false;
  }
  return true;
}

async function verifyExistingRepository() {
  const top = await run('git', ['rev-parse', '--show-toplevel'], { cwd: AC_ROOT, allowFailure: true });
  if (top.code !== 0) return false;
  if (!isExpectedNestedAcGitRoot(top.stdout.trim())) return false;
  const branch = await run('git', ['branch', '--show-current'], { cwd: AC_ROOT });
  if (branch.stdout.trim() !== AC_BRANCH)
    throw new Error(`Branch AC harus ${AC_BRANCH}; aktif: ${branch.stdout.trim() || '(detached)'}`);
  const remote = await run('git', ['remote', 'get-url', 'origin'], { cwd: AC_ROOT });
  if (normalizeAcRemote(remote.stdout) !== normalizeAcRemote(AC_REMOTE))
    throw new Error('Remote origin AC tidak cocok dengan repository yang diizinkan.');
  console.log(`Nested AC repository sudah benar: ${AC_REPOSITORY} (${AC_BRANCH}).`);
  return true;
}

async function main() {
  try {
    await fs.access(AC_ROOT);
  } catch {
    throw new Error(
      `Folder snapshot AC tidak ditemukan: ${AC_ROOT}. Ekstrak paket AC ke .private/artificial-consciousness-component terlebih dahulu.`,
    );
  }

  if (await verifyExistingRepository()) return;
  const token = process.env.AC_GITHUB_PAT;
  if (!token)
    throw new Error(
      'AC_GITHUB_PAT belum tersedia. Isi token terpisah untuk repository artificial-consciousness-component di .env, lalu ulangi npm run ac:git:setup.',
    );

  await fs.mkdir(AUTOMATION_DIR, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stagingRoot = path.join(AUTOMATION_DIR, `ac-clone-${process.pid}-${stamp}`);
  const backupRoot = path.join(AUTOMATION_DIR, `ac-snapshot-backup-${stamp}`);
  const askpass = await makeAskPass(token);
  let snapshotBackedUp = false;
  try {
    const remoteBranch = await run('git', ['-c', 'credential.helper=', 'ls-remote', '--heads', AC_REMOTE, AC_BRANCH], {
      cwd: PROJECT_ROOT,
      env: askpass.env,
      allowFailure: true,
    });
    if (remoteBranch.code !== 0)
      throw new Error(
        'Akses repository AC gagal. Periksa nama repository, AC_GITHUB_PAT, dan izin Contents read/write. Snapshot lokal tidak diubah.',
      );
    const allRemoteBranches = await run('git', ['-c', 'credential.helper=', 'ls-remote', '--heads', AC_REMOTE], {
      cwd: PROJECT_ROOT,
      env: askpass.env,
      allowFailure: true,
    });
    if (allRemoteBranches.code !== 0)
      throw new Error('Tidak dapat menginventarisasi branch repository AC. Snapshot lokal tidak diubah.');
    if (!remoteBranch.stdout.trim() && allRemoteBranches.stdout.trim()) {
      throw new Error(
        `Repository AC memiliki branch remote, tetapi bukan ${AC_BRANCH}. Setup dibatalkan agar tidak membuat sejarah branch paralel.`,
      );
    }

    if (remoteBranch.stdout.trim()) {
      await run(
        'git',
        ['-c', 'credential.helper=', 'clone', '--branch', AC_BRANCH, '--single-branch', AC_REMOTE, stagingRoot],
        { cwd: PROJECT_ROOT, env: askpass.env },
      );
      const remoteVersion = await readVersion(stagingRoot);
      const localVersion = await readVersion(AC_ROOT);
      if (!remoteVersion || !localVersion)
        throw new Error(
          'Versi release AC tidak dapat dibandingkan. Clone dan snapshot dipertahankan; setup dibatalkan untuk mencegah overwrite yang tidak terverifikasi.',
        );
      const relation = compareVersions(remoteVersion, localVersion);
      if (relation > 0)
        throw new Error(
          `Remote AC v${remoteVersion} lebih baru daripada snapshot lokal v${localVersion}. Tidak ada file yang ditimpa. Sinkronkan snapshot terlebih dahulu.`,
        );
      if (relation === 0 && !(await treesEqual(AC_ROOT, stagingRoot))) {
        throw new Error(
          `Remote dan snapshot sama-sama v${localVersion}, tetapi kontennya berbeda. Setup dibatalkan agar source remote tidak tertimpa tanpa version bump/review.`,
        );
      }
    } else {
      await run('git', ['init', '-b', AC_BRANCH, stagingRoot], { cwd: PROJECT_ROOT });
      await run('git', ['remote', 'add', 'origin', AC_REMOTE], { cwd: stagingRoot });
    }

    await fs.cp(AC_ROOT, backupRoot, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: source => !source.split(path.sep).includes('.git'),
    });
    snapshotBackedUp = true;
    const copied = await copySnapshot(AC_ROOT, stagingRoot);
    const status = await run('git', ['status', '--short'], { cwd: stagingRoot });

    // Keep the original snapshot intact until the fully cloned worktree is ready.
    const retiredSnapshot = `${AC_ROOT}.pre-git-${stamp}`;
    await fs.rename(AC_ROOT, retiredSnapshot);
    try {
      await fs.rename(stagingRoot, AC_ROOT);
    } catch (error) {
      await fs.rename(retiredSnapshot, AC_ROOT).catch(() => {});
      throw error;
    }
    await fs.rm(retiredSnapshot, { recursive: true, force: true }).catch(() => {});

    console.log(`Nested repository AC siap pada ${path.relative(PROJECT_ROOT, AC_ROOT)}.`);
    console.log(`Repository: ${AC_REPOSITORY} · branch ${AC_BRANCH} · file snapshot diterapkan: ${copied}`);
    console.log(`Snapshot awal dipertahankan di: ${path.relative(PROJECT_ROOT, backupRoot)}`);
    console.log(
      status.stdout.trim()
        ? `Perubahan yang menunggu audit/commit:\n${status.stdout.trim()}`
        : 'Snapshot identik dengan remote; tidak ada perubahan yang perlu dipush.',
    );
    console.log(
      'Jalankan ulang `npm start`. Auto-push AC akan berjalan hanya jika target AC aktif dan AC_GITHUB_PAT tersedia.',
    );
  } finally {
    await fs.rm(askpass.file, { force: true }).catch(() => {});
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    if (!snapshotBackedUp) await fs.rm(backupRoot, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(error => {
  console.error(`[AC Git Setup] ${error.message}`);
  process.exitCode = 1;
});
