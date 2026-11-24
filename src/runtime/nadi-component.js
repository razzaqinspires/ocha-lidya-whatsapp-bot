import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

const MAX_ARCHIVE_BYTES = 24 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 96 * 1024 * 1024;
const MAX_ENTRIES = 1600;
const DOWNLOAD_TIMEOUT_MS = 45_000;
let installPromise = null;

function cleanRef(value) {
  const ref = String(value || 'main').trim();
  if (!ref || ref.length > 160 || ref.startsWith('-') || /[\\\0]/.test(ref) || ref.split('/').some(part => part === '..' || part === '.')) {
    throw new Error('OCHA_NADI_REF tidak valid');
  }
  return ref;
}

export function parseGitHubRepository(input) {
  let parsed;
  try { parsed = new URL(String(input || '')); }
  catch { throw new Error('OCHA_NADI_REPO_URL harus berupa URL repositori GitHub yang valid'); }
  if (parsed.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(parsed.hostname.toLowerCase())) {
    throw new Error('NADI hanya dapat diunduh dari URL HTTPS github.com');
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length !== 2) throw new Error('Gunakan URL repositori GitHub, misalnya https://github.com/owner/artificial-consciousness-component');
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('Owner atau nama repositori GitHub tidak valid');
  }
  return { owner, repo, canonicalUrl: `https://github.com/${owner}/${repo}` };
}

function isValidComponent(root) {
  return Promise.all([
    fs.access(path.join(root, 'ac', '__main__.py')),
    fs.access(path.join(root, 'ac', 'server.py')),
    fs.access(path.join(root, 'ac', 'kernel.py')),
    fs.access(path.join(root, 'pyproject.toml'))
  ]).then(() => true).catch(() => false);
}

async function readPackageVersion(root) {
  const content = await fs.readFile(path.join(root, 'pyproject.toml'), 'utf8');
  const name = content.match(/^name\s*=\s*["']([^"']+)["']/m)?.[1];
  const version = content.match(/^version\s*=\s*["']([^"']+)["']/m)?.[1];
  if (name !== 'ac-kernel-nadi' || !version) throw new Error('Arsip GitHub bukan paket AC-Kernel NADI yang valid');
  return version;
}

async function zipEntries(buffer, destination) {
  const imported = await import('yauzl');
  const yauzl = imported.default || imported;
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (openError, zipFile) => {
      if (openError) return reject(openError);
      let count = 0;
      let extracted = 0;
      let archiveRoot = null;
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        if (error) {
          try { zipFile.close(); } catch {}
          reject(error);
        } else resolve({ entries: count, bytes: extracted });
      };
      zipFile.once('error', finish);
      zipFile.once('end', () => finish());
      zipFile.on('entry', entry => {
        (async () => {
          count += 1;
          if (count > MAX_ENTRIES) throw new Error('Arsip NADI melebihi batas jumlah file');
          const rawName = String(entry.fileName || '').replace(/\\/g, '/');
          if (!rawName || rawName.startsWith('/') || /^[A-Za-z]:/.test(rawName)) throw new Error('Arsip NADI berisi path yang tidak aman');
          const segments = rawName.split('/').filter(Boolean);
          if (!segments.length || segments.some(segment => segment === '.' || segment === '..')) throw new Error('Arsip NADI berisi path traversal');
          if (!archiveRoot) archiveRoot = segments[0];
          if (segments[0] !== archiveRoot) throw new Error('Arsip NADI memiliki lebih dari satu root directory');
          const relative = segments.slice(1).join('/');
          if (!relative) { zipFile.readEntry(); return; }
          const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
          const fileType = mode & 0o170000;
          if (fileType === 0o120000) throw new Error('Arsip NADI tidak boleh berisi symbolic link');
          if (fileType && fileType !== 0o100000 && fileType !== 0o040000) throw new Error('Arsip NADI berisi tipe file khusus yang tidak diizinkan');
          const target = path.resolve(destination, ...relative.split('/'));
          const relativeCheck = path.relative(destination, target);
          if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) throw new Error('Arsip NADI keluar dari direktori instalasi');
          if (rawName.endsWith('/')) {
            await fs.mkdir(target, { recursive: true });
            zipFile.readEntry();
            return;
          }
          const size = Number(entry.uncompressedSize || 0);
          if (!Number.isSafeInteger(size) || size < 0) throw new Error('Ukuran file dalam arsip tidak valid');
          extracted += size;
          if (extracted > MAX_EXTRACTED_BYTES) throw new Error('Arsip NADI melebihi batas ukuran hasil ekstraksi');
          await fs.mkdir(path.dirname(target), { recursive: true });
          await new Promise((resolveStream, rejectStream) => {
            zipFile.openReadStream(entry, (streamError, stream) => {
              if (streamError) return rejectStream(streamError);
              pipeline(stream, createWriteStream(target, { flags: 'wx', mode: 0o600 }))
                .then(resolveStream, rejectStream);
            });
          });
          zipFile.readEntry();
        })().catch(finish);
      });
      zipFile.readEntry();
    });
  });
}

async function readResponseBounded(response, maxBytes) {
  if (!response.body) throw new Error('GitHub tidak mengirim body arsip');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('Arsip NADI terlalu besar untuk diunduh');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function downloadAndInstall({ repoUrl, ref, root, logger }) {
  const repository = parseGitHubRepository(repoUrl);
  const safeRef = ref.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 100) || 'main';
  const releasesRoot = path.join(root, 'releases');
  const target = path.join(releasesRoot, safeRef);
  await fs.mkdir(releasesRoot, { recursive: true });
  if (process.env.OCHA_NADI_UPDATE !== '1' && await isValidComponent(target)) {
    const version = await readPackageVersion(target);
    const expected = String(process.env.OCHA_NADI_SHA256 || '').trim().toLowerCase();
    if (expected) {
      let metadata = {};
      try { metadata = JSON.parse(await fs.readFile(path.join(target, 'OCHA_COMPONENT_SOURCE.json'), 'utf8')); } catch {}
      if (metadata.archiveSha256 !== expected) throw new Error('Cache NADI tidak cocok dengan OCHA_NADI_SHA256; gunakan ref baru atau OCHA_NADI_UPDATE=1');
    }
    return { root: target, version, source: 'github-cache', repository: repository.canonicalUrl, ref };
  }

  const archiveUrl = `https://api.github.com/repos/${repository.owner}/${repository.repo}/zipball/${encodeURIComponent(ref)}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Ocha-Lidya-Bot-NADI-Component-Loader'
  };
  if (process.env.GITHUB_PAT) headers.Authorization = `Bearer ${process.env.GITHUB_PAT}`;
  const response = await fetch(archiveUrl, { headers, redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Unduhan NADI dari GitHub gagal (${response.status})`);
  const finalHost = new URL(response.url).hostname.toLowerCase();
  if (!['api.github.com', 'codeload.github.com'].includes(finalHost)) throw new Error('GitHub mengalihkan unduhan ke host yang tidak diizinkan');
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_ARCHIVE_BYTES) throw new Error('Arsip NADI terlalu besar untuk diunduh');
  const archive = await readResponseBounded(response, MAX_ARCHIVE_BYTES);
  if (!archive.length) throw new Error('Arsip NADI kosong');
  const archiveHash = crypto.createHash('sha256').update(archive).digest('hex');
  const expectedHash = String(process.env.OCHA_NADI_SHA256 || '').trim().toLowerCase();
  if (expectedHash && (!/^[a-f0-9]{64}$/.test(expectedHash) || archiveHash !== expectedHash)) {
    throw new Error('Checksum SHA-256 arsip NADI tidak cocok; instalasi dibatalkan');
  }

  const temporary = path.join(releasesRoot, `.install-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  await fs.mkdir(temporary, { recursive: true });
  try {
    const stats = await zipEntries(archive, temporary);
    if (!await isValidComponent(temporary)) throw new Error('Arsip GitHub tidak memiliki struktur paket NADI yang diharapkan');
    const version = await readPackageVersion(temporary);
    await fs.writeFile(path.join(temporary, 'OCHA_COMPONENT_SOURCE.json'), JSON.stringify({
      component: 'AC-Kernel NADI', version, repository: repository.canonicalUrl,
      ref, archiveSha256: archiveHash, downloadedAt: new Date().toISOString(),
      extractedEntries: stats.entries, extractedBytes: stats.bytes
    }, null, 2), { mode: 0o600 });

    const backup = `${target}.previous-${Date.now()}`;
    let hadTarget = false;
    try { await fs.rename(target, backup); hadTarget = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try {
      await fs.rename(temporary, target);
      if (hadTarget) await fs.rm(backup, { recursive: true, force: true });
    } catch (error) {
      if (hadTarget) await fs.rename(backup, target).catch(() => {});
      throw error;
    }
    logger?.info?.({ version, ref, repository: repository.canonicalUrl, sha256: archiveHash }, 'NADI component downloaded and installed outside the Ocha source tree');
    return { root: target, version, source: 'github', repository: repository.canonicalUrl, ref, archiveSha256: archiveHash };
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function resolveNadiComponent({ logger = console } = {}) {
  if (installPromise) return installPromise;
  installPromise = (async () => {
    const direct = String(process.env.OCHA_NADI_SOURCE_DIR || '').trim();
    if (direct) {
      const root = path.resolve(direct);
      if (!await isValidComponent(root)) throw new Error(`OCHA_NADI_SOURCE_DIR tidak berisi source NADI valid: ${root}`);
      return { root, version: await readPackageVersion(root), source: 'external-directory' };
    }

    const repoUrl = String(process.env.OCHA_NADI_REPO_URL || '').trim();
    const ref = cleanRef(process.env.OCHA_NADI_REF || 'main');
    const componentHome = path.resolve(process.env.OCHA_NADI_HOME || path.join(os.homedir(), '.ocha', 'components', 'nadi'));
    if (!repoUrl) {
      throw Object.assign(new Error('NADI source belum dikonfigurasi. Isi OCHA_NADI_REPO_URL setelah repositori GitHub NADI tersedia.'), { code: 'NADI_NOT_CONFIGURED' });
    }
    const safeRef = ref.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 100) || 'main';
    const cached = path.join(componentHome, 'releases', safeRef);
    if (process.env.OCHA_NADI_UPDATE !== '1' && await isValidComponent(cached)) {
      const expected = String(process.env.OCHA_NADI_SHA256 || '').trim().toLowerCase();
      if (expected) {
        let metadata = {};
        try { metadata = JSON.parse(await fs.readFile(path.join(cached, 'OCHA_COMPONENT_SOURCE.json'), 'utf8')); } catch {}
        if (metadata.archiveSha256 !== expected) throw new Error('Cache NADI tidak cocok dengan OCHA_NADI_SHA256; gunakan ref baru atau OCHA_NADI_UPDATE=1');
      }
      return { root: cached, version: await readPackageVersion(cached), source: 'github-cache', repository: parseGitHubRepository(repoUrl).canonicalUrl, ref };
    }
    const installed = await downloadAndInstall({ repoUrl, ref, root: componentHome, logger });
    if (process.env.OCHA_NADI_UPDATE === '1') process.env.OCHA_NADI_UPDATE = '0';
    return installed;
  })();
  try { return await installPromise; }
  finally { installPromise = null; }
}
