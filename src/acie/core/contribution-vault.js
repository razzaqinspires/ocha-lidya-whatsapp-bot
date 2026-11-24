import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { getACIEPaths } from './paths.js';
import { safeSlug, safeRelativePath, sha256File, writeJsonAtomic, readJson, ensurePrivateDir, isWithin } from './fs-safe.js';
import { analyzeContribution } from '../intelligence/static-analysis.js';
import { discoverCapabilities } from '../intelligence/capability-discovery.js';

const DEFAULT_LIMITS = Object.freeze({ files: 20_000, bytes: 1024 * 1024 * 1024, singleFileBytes: 256 * 1024 * 1024, archiveBytes: 1024 * 1024 * 1024 });

async function listRegularFiles(root, current = root, output = []) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink ditolak: ${path.relative(root, full)}`);
    if (entry.isDirectory()) await listRegularFiles(root, full, output);
    else if (entry.isFile()) output.push(full);
    else throw new Error(`Filesystem entry tidak didukung: ${path.relative(root, full)}`);
  }
  return output;
}

async function copySourceDirectory(source, destination, limits) {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) throw new Error('Source symlink tidak dapat diterima. Gunakan file/direktori reguler.');
  let files = 0;
  let bytes = 0;
  async function copyNode(from, to) {
    const current = await fs.lstat(from);
    if (current.isSymbolicLink()) throw new Error(`Symlink ditolak: ${from}`);
    if (current.isDirectory()) {
      await fs.mkdir(to, { recursive: true, mode: 0o700 });
      const entries = await fs.readdir(from, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) await copyNode(path.join(from, entry.name), path.join(to, entry.name));
      return;
    }
    if (!current.isFile()) throw new Error(`Tipe file tidak didukung: ${from}`);
    files += 1; bytes += current.size;
    if (files > limits.files || bytes > limits.bytes || current.size > limits.singleFileBytes) throw new Error('Batas ukuran/jumlah file kontribusi terlampaui.');
    await fs.mkdir(path.dirname(to), { recursive: true, mode: 0o700 });
    await fs.copyFile(from, to, 1);
    await fs.chmod(to, 0o400).catch(() => {});
  }
  if (stat.isDirectory()) await copyNode(source, destination);
  else if (stat.isFile()) {
    await fs.mkdir(destination, { recursive: true, mode: 0o700 });
    const basename = path.basename(source);
    safeRelativePath(basename);
    await copyNode(source, path.join(destination, basename));
  } else throw new Error('Source harus file reguler atau direktori.');
  return { files, bytes };
}

function validateArchiveEntry(entryName) {
  const normalized = String(entryName || '').replaceAll('\\', '/');
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) throw new Error('ZIP berisi path absolut/tidak valid.');
  const isDirectory = normalized.endsWith('/');
  const trimmed = isDirectory ? normalized.slice(0, -1) : normalized;
  if (!trimmed) return { relative: '', isDirectory: true };
  return { relative: safeRelativePath(trimmed), isDirectory };
}

async function extractZipSafely(zipPath, destination, limits) {
  const imported = await import('yauzl').catch(() => null);
  const yauzl = imported?.default || imported;
  if (!yauzl?.open) throw new Error('Ekstraksi ZIP membutuhkan dependency yauzl. Jalankan npm install terlebih dahulu.');
  await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  let files = 0;
  let bytes = 0;
  const names = new Set();
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => { if (settled) return; settled = true; error ? reject(error) : resolve(); };
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true, decodeStrings: true, validateEntrySizes: true }, (openError, zipfile) => {
      if (openError) return finish(openError);
      zipfile.on('error', finish);
      zipfile.on('end', () => finish());
      zipfile.on('entry', entry => {
        (async () => {
          const parsed = validateArchiveEntry(entry.fileName);
          if (!parsed.relative) { zipfile.readEntry(); return; }
          const key = parsed.relative.split(path.sep).join('/');
          if (names.has(key)) throw new Error(`ZIP berisi path duplikat: ${key}`);
          names.add(key);
          const unixMode = (Number(entry.externalFileAttributes || 0) >>> 16) & 0xffff;
          const fileType = unixMode & 0o170000;
          if (fileType === 0o120000) throw new Error(`ZIP symlink ditolak: ${key}`);
          const target = path.join(destination, parsed.relative);
          if (!isWithin(destination, target)) throw new Error(`ZIP path traversal ditolak: ${key}`);
          if (parsed.isDirectory || fileType === 0o040000) {
            await fs.mkdir(target, { recursive: true, mode: 0o700 });
          } else {
            if (fileType && fileType !== 0o100000) throw new Error(`ZIP entry khusus ditolak: ${key}`);
            files += 1; bytes += Number(entry.uncompressedSize || 0);
            if (files > limits.files || bytes > limits.bytes || Number(entry.uncompressedSize || 0) > limits.singleFileBytes) throw new Error('Batas ukuran/jumlah file ZIP terlampaui.');
            await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
            await new Promise((res, rej) => zipfile.openReadStream(entry, (streamError, stream) => {
              if (streamError) return rej(streamError);
              pipeline(stream, createWriteStream(target, { flags: 'wx', mode: 0o400 })).then(res, rej);
            }));
            await fs.chmod(target, 0o400).catch(() => {});
          }
          zipfile.readEntry();
        })().catch(finish);
      });
      zipfile.readEntry();
    });
  });
  return { files, bytes };
}

async function hashInventory(originalDirectory) {
  const files = await listRegularFiles(originalDirectory);
  const inventory = [];
  const directoryInventory = [];
  let totalBytes = 0;
  async function collectDirectories(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) if (entry.isDirectory()) {
      const full = path.join(current, entry.name);
      directoryInventory.push(path.relative(originalDirectory, full).split(path.sep).join('/'));
      await collectDirectories(full);
    }
  }
  await collectDirectories(originalDirectory);
  for (const file of files) {
    const stat = await fs.stat(file);
    const relative = path.relative(originalDirectory, file).split(path.sep).join('/');
    inventory.push({ path: relative, bytes: stat.size, sha256: await sha256File(file) });
    totalBytes += stat.size;
  }
  return { inventory, directoryInventory, totalBytes };
}

function sameInventory(left = [], right = []) {
  if (left.length !== right.length) return false;
  const byPath = new Map(left.map(item => [item.path, item]));
  return right.every(item => {
    const other = byPath.get(item.path);
    return other && other.bytes === item.bytes && other.sha256 === item.sha256;
  });
}

async function makeOriginalReadOnly(directory) {
  for (const file of await listRegularFiles(directory)) await fs.chmod(file, 0o400).catch(() => {});
  const directories = [directory];
  async function collect(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) if (entry.isDirectory()) {
      const full = path.join(current, entry.name); directories.push(full); await collect(full);
    }
  }
  await collect(directory);
  for (const dir of directories.reverse()) await fs.chmod(dir, 0o500).catch(() => {});
}

async function nextVersion(contributionRoot) {
  const versions = path.join(contributionRoot, 'versions');
  await fs.mkdir(versions, { recursive: true, mode: 0o700 });
  const names = await fs.readdir(versions, { withFileTypes: true });
  const numbers = names.filter(entry => entry.isDirectory()).map(entry => Number(entry.name.replace(/^v/, ''))).filter(Number.isInteger);
  return Math.max(0, ...numbers) + 1;
}

async function acquireIntakeLock(directory) {
  const file = path.join(directory, '.intake.lock');
  const handle = await fs.open(file, 'wx', 0o600).catch(error => {
    if (error.code === 'EEXIST') throw new Error('Intake lain sedang berjalan. Coba kembali setelah proses selesai.');
    throw error;
  });
  await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  return async () => { await handle.close().catch(() => {}); await fs.unlink(file).catch(() => {}); };
}

/**
 * Immutable contribution intake. The input is copied byte-for-byte into a new version.
 * No source code is imported, compiled, or executed in this pipeline.
 */
export async function intakeContribution({
  source, contributorId, contributorName = null, contributorContact = null,
  contributionName, projectId = 'ocha-lidya-bot', license = null, attribution = null,
  versionLabel = null, root = process.cwd(), limits = {},
  analyze = true
} = {}) {
  if (!source || !contributorId || !contributionName) throw new TypeError('source, contributorId, and contributionName are required.');
  const paths = getACIEPaths(root);
  const resolvedSource = path.resolve(source);
  const resolvedRoot = path.resolve(root);
  if (isWithin(resolvedRoot, resolvedSource)) throw new Error('Source kontribusi harus berada di luar repository Ocha agar repository tidak terintake secara tidak sengaja.');
  const contributor = safeSlug(contributorId, 'contributorId');
  const slug = safeSlug(contributionName, 'contributionName');
  const project = safeSlug(projectId, 'projectId');
  const runtimeConfig = await readJson(paths.config, {});
  const configured = { ...(runtimeConfig.intakeLimits || {}), ...limits };
  const effectiveLimits = Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => {
    const requested = Number(configured[key] ?? fallback);
    const safe = Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : fallback;
    return [key, Math.min(fallback, safe)];
  }));
  await ensurePrivateDir(paths.contributions);
  await Promise.all([paths.vault, paths.registry, paths.metadata, paths.dependencyLocks, paths.executionProfiles, paths.compatibility, paths.audit, paths.quarantine, paths.adapters, paths.generatedCommands, paths.runtimeWorkspaces].map(ensurePrivateDir));
  const releaseLock = await acquireIntakeLock(paths.contributions);
  try {
    const stat = await fs.lstat(resolvedSource);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Source harus berupa file reguler atau direktori, bukan symlink.');
    const contributionRoot = path.join(paths.vault, contributor, slug);
    const versionNumber = await nextVersion(contributionRoot);
    const versionId = `v${versionNumber}`;
    const versionsRoot = path.join(contributionRoot, 'versions');
    const finalVersion = path.join(versionsRoot, versionId);
    const staging = path.join(versionsRoot, `.${versionId}.${crypto.randomUUID()}.staging`);
    const originalDirectory = path.join(staging, 'original');
    await fs.mkdir(staging, { recursive: true, mode: 0o700 });
    try {
      let sourceArchive = null;
      if (stat.isFile() && path.extname(resolvedSource).toLowerCase() === '.zip') {
        if (stat.size > effectiveLimits.archiveBytes) throw new Error('Ukuran arsip ZIP melampaui batas yang diizinkan.');
        const archiveTarget = path.join(staging, 'source-archive.zip');
        await fs.copyFile(resolvedSource, archiveTarget, fs.constants.COPYFILE_EXCL);
        await fs.chmod(archiveTarget, 0o400).catch(() => {});
        const sourceHash = await sha256File(resolvedSource);
        const copiedHash = await sha256File(archiveTarget);
        if (sourceHash !== copiedHash) throw new Error('Arsip ZIP berubah ketika intake; source tidak disimpan karena pemeriksaan byte gagal.');
        sourceArchive = { path: 'source-archive.zip', bytes: stat.size, sha256: copiedHash };
        await extractZipSafely(archiveTarget, originalDirectory, effectiveLimits);
      } else {
        await copySourceDirectory(resolvedSource, originalDirectory, effectiveLimits);
      }
      const { inventory, directoryInventory, totalBytes } = await hashInventory(originalDirectory);
      if (!sourceArchive) {
        const sourceSnapshot = stat.isDirectory() ? await hashInventory(resolvedSource) : { inventory: [{ path: path.basename(resolvedSource), bytes: stat.size, sha256: await sha256File(resolvedSource) }], directoryInventory: [] };
        if (!sameInventory(inventory, sourceSnapshot.inventory) || JSON.stringify(directoryInventory) !== JSON.stringify(sourceSnapshot.directoryInventory)) {
          throw new Error('Source berubah selama proses intake; salinan tidak disahkan dan tidak akan didaftarkan.');
        }
      }
      if (!inventory.length) throw new Error('Kontribusi tidak berisi file reguler.');
      const analysis = analyze ? await analyzeContribution(originalDirectory) : null;
      const capabilities = analysis ? discoverCapabilities(analysis, '') : [];
      const contributionId = `OCHA-CONTRIB-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
      const createdAt = new Date().toISOString();
      const manifest = {
        schemaVersion: 1, contributionId, contributorId: contributor, contributorName: contributorName || null,
        contributorContact: contributorContact || null, projectId: project, name: slug, version: versionId,
        versionLabel: versionLabel || null, receivedAt: createdAt, originalDirectory: 'original',
        originalFileCount: inventory.length, originalBytes: totalBytes, originalSha256: inventory.length === 1 ? inventory[0].sha256 : null,
        inventory, originalDirectories: directoryInventory, sourceArchive, languageDiscovery: analysis ? { primaryLanguage: analysis.primaryLanguage, languages: analysis.languages, runtime: analysis.runtime, moduleSystem: analysis.moduleSystem } : null,
        dependencies: analysis?.dependencies || [], runtimeRequirements: analysis?.runtimeRequirements || [], entryPointCandidates: analysis?.entryPointCandidates || [],
        environmentVariables: analysis?.environmentVariables || [], license: license || 'PENDING_INFORMATION',
        attribution: attribution || 'PENDING_INFORMATION', capabilities,
        integrity: 'verified-at-intake', executionAuthorization: 'not-authorized', sourceExecuted: false
      };
      const provenance = {
        schemaVersion: 1, contributionId, contributorId: contributor, contributorName: contributorName || null,
        projectId: project, receivedAt: createdAt, receivedFrom: resolvedSource,
        sourceArchiveSha256: sourceArchive?.sha256 || null,
        receivedBy: `Ocha Lidya ACIE / pid:${process.pid}`,
        preservation: { method: 'byte-for-byte-copy', originalModified: false, readonlyBestEffort: true, checksumAlgorithm: 'SHA-256' },
        rights: { license: license || null, attribution: attribution || null, status: license && attribution ? 'provided-pending-review' : 'pending-information' }
      };
      await makeOriginalReadOnly(originalDirectory);
      await writeJsonAtomic(path.join(staging, 'manifest.json'), manifest);
      await writeJsonAtomic(path.join(staging, 'provenance.json'), provenance);
      if (analysis) await writeJsonAtomic(path.join(staging, 'analysis.json'), analysis);
      await fs.rename(staging, finalVersion);
      const current = { contributionId, contributorId: contributor, name: slug, projectId: project, version: versionId, updatedAt: createdAt };
      await writeJsonAtomic(path.join(contributionRoot, 'current.json'), current);
      const previousHistory = await readJson(path.join(contributionRoot, 'history.json'), { versions: [] });
      previousHistory.versions = [...(previousHistory.versions || []), { version: versionId, contributionId, receivedAt: createdAt, metadataIntegrityVersion: 2, manifestSha256: await sha256File(path.join(finalVersion, 'manifest.json')), provenanceSha256: await sha256File(path.join(finalVersion, 'provenance.json')), analysisSha256: await fs.access(path.join(finalVersion, 'analysis.json')).then(() => sha256File(path.join(finalVersion, 'analysis.json'))).catch(() => null), sourceArchiveSha256: sourceArchive?.sha256 || null }];
      await writeJsonAtomic(path.join(contributionRoot, 'history.json'), previousHistory);
      return { contributionRoot, versionRoot: finalVersion, originalDirectory: path.join(finalVersion, 'original'), manifest, provenance, analysis, capabilities };
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  } finally { await releaseLock(); }
}

export async function listContributions({ root = process.cwd() } = {}) {
  const paths = getACIEPaths(root);
  const output = [];
  async function walk(current, depth = 0) {
    if (depth > 3) return;
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const target = path.join(current, entry.name);
      const currentFile = path.join(target, 'current.json');
      const currentRecord = await readJson(currentFile, null);
      if (currentRecord) {
        const versionRoot = path.join(target, 'versions', currentRecord.version);
        const manifest = await readJson(path.join(versionRoot, 'manifest.json'), null);
        if (manifest) output.push({ ...currentRecord, fileCount: manifest.originalFileCount, language: manifest.languageDiscovery?.primaryLanguage || 'unknown', capabilityCount: manifest.capabilities?.length || 0, license: manifest.license });
      } else await walk(target, depth + 1);
    }
  }
  await walk(paths.vault);
  return output.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function listContributionVersions({ root = process.cwd() } = {}) {
  const paths = getACIEPaths(root);
  const output = [];
  let contributors = [];
  try { contributors = await fs.readdir(paths.vault, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  for (const contributorEntry of contributors.filter(item => item.isDirectory())) {
    const contributorRoot = path.join(paths.vault, contributorEntry.name);
    const contributions = await fs.readdir(contributorRoot, { withFileTypes: true }).catch(() => []);
    for (const contributionEntry of contributions.filter(item => item.isDirectory())) {
      const contributionRoot = path.join(contributorRoot, contributionEntry.name);
      const versionsRoot = path.join(contributionRoot, 'versions');
      const versions = await fs.readdir(versionsRoot, { withFileTypes: true }).catch(() => []);
      for (const versionEntry of versions.filter(item => item.isDirectory() && /^v\d+$/.test(item.name))) {
        const versionRoot = path.join(versionsRoot, versionEntry.name);
        const manifest = await readJson(path.join(versionRoot, 'manifest.json'), null);
        if (!manifest) continue;
        output.push({
          contributionId: manifest.contributionId, contributorId: manifest.contributorId,
          name: manifest.name, projectId: manifest.projectId, version: manifest.version,
          receivedAt: manifest.receivedAt, fileCount: manifest.originalFileCount,
          language: manifest.languageDiscovery?.primaryLanguage || 'unknown',
          capabilityCount: manifest.capabilities?.length || 0, license: manifest.license,
          contributionRoot, versionRoot, manifest
        });
      }
    }
  }
  return output.sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)));
}

export async function findContribution(contributionId, { root = process.cwd() } = {}) {
  const versions = await listContributionVersions({ root });
  const query = String(contributionId || '').toLowerCase();
  const found = versions.find(item => item.contributionId?.toLowerCase() === query || `${item.contributorId}/${item.name}`.toLowerCase() === query && item.version === 'current');
  if (!found) {
    const current = (await listContributions({ root })).find(item => `${item.contributorId}/${item.name}`.toLowerCase() === query);
    if (!current) return null;
    return findContribution(current.contributionId, { root });
  }
  const contributionRoot = found.contributionRoot;
  const versionRoot = found.versionRoot;
  return {
    ...found,
    provenance: await readJson(path.join(versionRoot, 'provenance.json'), null),
    analysis: await readJson(path.join(versionRoot, 'analysis.json'), null)
  };
}

export async function verifyContribution(contributionId, { root = process.cwd() } = {}) {
  const found = await findContribution(contributionId, { root });
  if (!found?.manifest) throw new Error(`Contribution not found: ${contributionId}`);
  const actual = await hashInventory(path.join(found.versionRoot, 'original'));
  const expected = found.manifest.inventory || [];
  const actualMap = new Map(actual.inventory.map(item => [item.path, item]));
  const mismatches = [];
  for (const item of expected) {
    const current = actualMap.get(item.path);
    if (!current) mismatches.push({ path: item.path, status: 'missing' });
    else if (current.sha256 !== item.sha256 || current.bytes !== item.bytes) mismatches.push({ path: item.path, status: 'changed' });
    actualMap.delete(item.path);
  }
  for (const file of actualMap.keys()) mismatches.push({ path: file, status: 'unexpected' });

  const expectedDirectories = [...(found.manifest.originalDirectories || [])].sort();
  const actualDirectories = [...actual.directoryInventory].sort();
  for (const directory of expectedDirectories) if (!actualDirectories.includes(directory)) mismatches.push({ path: directory, status: 'missing-directory' });
  for (const directory of actualDirectories) if (!expectedDirectories.includes(directory)) mismatches.push({ path: directory, status: 'unexpected-directory' });

  if (found.manifest.sourceArchive?.sha256) {
    const archivePath = path.join(found.versionRoot, found.manifest.sourceArchive.path || 'source-archive.zip');
    try {
      const archiveHash = await sha256File(archivePath);
      if (archiveHash !== found.manifest.sourceArchive.sha256) mismatches.push({ path: 'source-archive.zip', status: 'changed' });
    } catch (error) { if (error.code === 'ENOENT') mismatches.push({ path: 'source-archive.zip', status: 'missing' }); else throw error; }
  }

  const history = await readJson(path.join(found.contributionRoot, 'history.json'), { versions: [] });
  const anchor = (history.versions || []).find(item => item.contributionId === found.contributionId);
  if (!anchor) mismatches.push({ path: 'history.json', status: 'missing-anchor' });
  else if (anchor.metadataIntegrityVersion >= 2) {
    const manifestHash = await sha256File(path.join(found.versionRoot, 'manifest.json'));
    const provenanceHash = await sha256File(path.join(found.versionRoot, 'provenance.json'));
    if (manifestHash !== anchor.manifestSha256) mismatches.push({ path: 'manifest.json', status: 'changed' });
    if (provenanceHash !== anchor.provenanceSha256) mismatches.push({ path: 'provenance.json', status: 'changed' });
    if (anchor.analysisSha256) {
      const analysisHash = await sha256File(path.join(found.versionRoot, 'analysis.json'));
      if (analysisHash !== anchor.analysisSha256) mismatches.push({ path: 'analysis.json', status: 'changed' });
    }
  }
  return { contributionId: found.contributionId, expectedFiles: expected.length, actualFiles: actual.inventory.length, expectedBytes: found.manifest.originalBytes, actualBytes: actual.totalBytes, status: mismatches.length ? 'compromised' : 'verified', mismatches };
}

export async function refreshContributionHistoryAnchors(contributionId, { root = process.cwd() } = {}) {
  const found = await findContribution(contributionId, { root });
  if (!found) throw new Error(`Contribution not found: ${contributionId}`);
  const historyPath = path.join(found.contributionRoot, 'history.json');
  const history = await readJson(historyPath, { versions: [] });
  const entry = (history.versions || []).find(item => item.contributionId === found.contributionId);
  if (!entry) throw new Error(`Version history anchor is missing for ${found.contributionId}`);
  entry.metadataIntegrityVersion = 2;
  entry.manifestSha256 = await sha256File(path.join(found.versionRoot, 'manifest.json'));
  entry.provenanceSha256 = await sha256File(path.join(found.versionRoot, 'provenance.json'));
  entry.analysisSha256 = await fs.access(path.join(found.versionRoot, 'analysis.json')).then(() => sha256File(path.join(found.versionRoot, 'analysis.json'))).catch(() => null);
  entry.sourceArchiveSha256 = found.manifest.sourceArchive?.sha256 || null;
  entry.integrityAnchoredAt = new Date().toISOString();
  await writeJsonAtomic(historyPath, history);
  return entry;
}
