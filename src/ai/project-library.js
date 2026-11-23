import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWriteStream } from 'node:fs';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';
import { getConfig } from '../core/config.js';
import { logger } from '../core/logger.js';

const execFile = promisify(execFileCallback);
const MAX_PROJECTS_PER_USER = 40;
const MAX_USER_STORAGE_BYTES = 256 * 1024 * 1024;
const MAX_PROJECT_FILES = 80;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_PROJECT_BYTES = 4 * 1024 * 1024;
const MAX_TASKS = 24;
const MAX_SNAPSHOTS = 12;
const MAX_EXPORT_BYTES = 16 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.svg', '.json', '.txt', '.webmanifest', '.xml']);
const BLOCKED_SEGMENTS = new Set(['node_modules', '.git', '.env', 'sessions', 'data', '.nexora', '.control', '.history']);
const locks = new Map();

function sha(value, length = 32) {
  return crypto.createHash('sha256').update(String(value || 'anonymous')).digest('hex').slice(0, length);
}

export function projectUserKey(userId) {
  if (!userId || typeof userId !== 'string') throw new TypeError('Identitas pengguna wajib tersedia untuk mengakses Project Library.');
  const normalized = userId.trim().replace(/:\d+(?=@)/, '');
  if (!/^(?:\d{8,20}@(s\.whatsapp\.net|lid)|\d{8,20})$/i.test(normalized)) {
    throw new TypeError('Identitas pengguna tidak valid untuk Project Library.');
  }
  // Use exactly the same normalized identity and SHA-256 namespace as User Vault.
  return sha(normalized, 64);
}

function cleanText(value, max = 1000) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/(api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization)\s*[:=]\s*["']?[^\s,"';}]+/gi, '$1=[REDACTED]')
    .trim().slice(0, max);
}

function safeSlug(value) {
  const slug = String(value || 'website-project')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'website-project';
}

function safeRelativePath(rawPath) {
  const filePath = String(rawPath || '').trim().replaceAll('\\', '/');
  if (!filePath || filePath.length > 180 || filePath.startsWith('/') || filePath.includes('\0')) return null;
  const parts = filePath.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.') || BLOCKED_SEGMENTS.has(part.toLowerCase()))) return null;
  const ext = path.posix.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return null;
  return filePath;
}

function normalizeFiles(files) {
  const entries = Array.isArray(files)
    ? files.map(item => [item?.path, item?.content])
    : Object.entries(files || {});
  if (!entries.length || entries.length > MAX_PROJECT_FILES) throw new Error(`Repository harus memiliki 1-${MAX_PROJECT_FILES} file source.`);
  const result = Object.create(null);
  let totalBytes = 0;
  for (const [rawPath, content] of entries) {
    const filePath = safeRelativePath(rawPath);
    if (!filePath) throw new Error(`Path repository tidak aman atau jenis file tidak didukung: ${String(rawPath || '(kosong)')}`);
    if (filePath === 'README.md') throw new Error('README.md dikelola otomatis oleh Project Library.');
    if (Object.hasOwn(result, filePath)) throw new Error(`File duplikat dalam repository: ${filePath}`);
    if (typeof content !== 'string') throw new Error(`Konten ${filePath} harus berupa teks.`);
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_FILE_BYTES) throw new Error(`File ${filePath} melebihi batas ${MAX_FILE_BYTES} byte.`);
    totalBytes += bytes;
    if (totalBytes > MAX_PROJECT_BYTES) throw new Error(`Ukuran repository melebihi batas ${MAX_PROJECT_BYTES} byte.`);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{24,}/.test(content)) {
      throw new Error(`Kemungkinan kredensial/secret terdeteksi pada ${filePath}. Hapus secret dan gunakan placeholder.`);
    }
    result[filePath] = content;
  }
  if (!Object.hasOwn(result, 'index.html')) throw new Error('Website wajib memiliki index.html di root repository.');
  return { files: result, fileCount: Object.keys(result).length, totalBytes };
}

function normalizeProjectMemory(memory = {}, fallback = {}) {
  const list = (value, prior) => {
    const source = Array.isArray(value) ? value : prior;
    return [...new Set((Array.isArray(source) ? source : []).map(item => cleanText(item, 220)).filter(Boolean))].slice(-12);
  };
  return {
    summary: cleanText(memory.summary || fallback.summary, 1400),
    architecture: cleanText(memory.architecture || fallback.architecture, 1400),
    features: list(memory.features, fallback.features),
    decisions: list(memory.decisions, fallback.decisions),
    nextSteps: list(memory.nextSteps, fallback.nextSteps)
  };
}

function configuredProjectRoot() {
  let configured = process.env.OCHA_PROJECT_LIBRARY_ROOT || '';
  if (!configured) {
    try { configured = getConfig().codeLab?.projectLibraryRoot || ''; } catch {}
  }
  return configured ? path.resolve(configured) : '';
}
function legacyProjectRoot() {
  return process.getuid?.() === 0
    ? '/root/ocha-project-library'
    : path.join(os.homedir(), '.local', 'share', 'ocha-lidya', 'projects');
}
function rootPath() {
  const configured = configuredProjectRoot();
  if (configured) return configured;
  return path.resolve(process.env.OCHA_ROO_ROOT || path.join(process.cwd(), 'data', 'roo'));
}

async function ensureRealDirectory(directory, mode = 0o700) {
  await fs.mkdir(directory, { recursive: true, mode });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Project Library menolak direktori bukan direktori fisik: ${directory}`);
  await fs.chmod(directory, mode).catch(() => {});
  return directory;
}

function roots() {
  const root = rootPath();
  const perUserRoo = !configuredProjectRoot();
  return {
    root, perUserRoo,
    legacyRoot: perUserRoo ? legacyProjectRoot() : '',
    control: path.join(root, '.control'),
    projectsMeta: path.join(root, '.control', 'projects'),
    active: path.join(root, '.control', 'active'),
    preferences: path.join(root, '.control', 'preferences'),
    history: path.join(root, '.history'),
    temp: path.join(root, '.tmp')
  };
}

async function ensureLibrary() {
  const locations = roots();
  await ensureRealDirectory(locations.root, 0o700);
  // Explicit legacy/custom roots keep their old layout. The default layout is
  // per-user under roo/<sha256>, with no shared metadata or history directory.
  if (!locations.perUserRoo) {
    for (const dir of [locations.control, locations.projectsMeta, locations.active, locations.preferences, locations.history, locations.temp]) {
      await ensureRealDirectory(dir, 0o700);
    }
  }
  return locations;
}

function userContainer(locations, userKey) {
  return resolveInside(locations.root, userKey);
}
function userDirectory(locations, userKey) {
  return locations.perUserRoo
    ? resolveInside(userContainer(locations, userKey), 'projects')
    : resolveInside(locations.root, userKey);
}
function metadataDirectory(locations, userKey) {
  return locations.perUserRoo
    ? resolveInside(userContainer(locations, userKey), '.control', 'projects')
    : resolveInside(locations.projectsMeta, userKey);
}
function activeDirectory(locations, userKey) {
  return locations.perUserRoo
    ? resolveInside(userContainer(locations, userKey), '.control', 'active')
    : locations.active;
}
function preferenceDirectory(locations, userKey) {
  return locations.perUserRoo
    ? resolveInside(userContainer(locations, userKey), '.control', 'preferences')
    : locations.preferences;
}
function projectHistoryRoot(locations, userKey) {
  return locations.perUserRoo
    ? resolveInside(userContainer(locations, userKey), '.history')
    : resolveInside(locations.history, userKey);
}
function projectTempRoot(locations, userKey) {
  return locations.perUserRoo
    ? resolveInside(userContainer(locations, userKey), '.tmp')
    : locations.temp;
}

async function copyLegacyTree(source, destination) {
  const sourceStat = await fs.lstat(source).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!sourceStat || sourceStat.isSymbolicLink()) return false;
  const destinationStat = await fs.lstat(destination).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (destinationStat) return false; // Never overwrite data already present in the new roo container.
  if (sourceStat.isDirectory()) {
    await ensureRealDirectory(destination, 0o700);
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      await copyLegacyTree(path.join(source, entry.name), path.join(destination, entry.name));
    }
    return true;
  }
  if (!sourceStat.isFile()) return false;
  await ensureRealDirectory(path.dirname(destination), 0o700);
  await fs.copyFile(source, destination, 1).catch(error => {
    if (error.code !== 'EEXIST') throw error;
  });
  await fs.chmod(destination, 0o600).catch(() => {});
  return true;
}

async function migrateLegacyProjectContainer(locations, userKey) {
  if (!locations.perUserRoo || !locations.legacyRoot || path.resolve(locations.legacyRoot) === path.resolve(locations.root)) return;
  const container = userContainer(locations, userKey);
  await ensureRealDirectory(container, 0o700);
  const marker = resolveInside(container, '.legacy-project-library-migrated');
  if (await fs.stat(marker).catch(() => null)) return;
  const oldKey = userKey.slice(0, 32);
  const legacy = locations.legacyRoot;
  await copyLegacyTree(path.join(legacy, oldKey), userDirectory(locations, userKey));
  await copyLegacyTree(path.join(legacy, '.control', 'projects', oldKey), metadataDirectory(locations, userKey));
  const oldActive = path.join(legacy, '.control', 'active');
  const newActive = activeDirectory(locations, userKey);
  for (const entry of await fs.readdir(oldActive, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.startsWith(`${oldKey}-`)) continue;
    await copyLegacyTree(path.join(oldActive, entry.name), path.join(newActive, entry.name.slice(oldKey.length + 1)));
  }
  await copyLegacyTree(
    path.join(legacy, '.control', 'preferences', `${oldKey}.json`),
    path.join(preferenceDirectory(locations, userKey), 'preferences.json')
  );
  await copyLegacyTree(path.join(legacy, '.history', oldKey), projectHistoryRoot(locations, userKey));
  await fs.writeFile(marker, `${JSON.stringify({ version: 1, migratedAt: new Date().toISOString(), from: legacy })}\n`, { mode: 0o600, flag: 'wx' }).catch(error => {
    if (error.code !== 'EEXIST') throw error;
  });
}

function resolveInside(parent, ...parts) {
  const resolved = path.resolve(parent, ...parts);
  if (resolved !== parent && !resolved.startsWith(`${parent}${path.sep}`)) throw new Error('Akses path Project Library ditolak.');
  return resolved;
}

function metadataPath(locations, userKey, projectId) {
  if (!/^[a-f0-9-]{36}$/i.test(String(projectId))) throw new Error('ID proyek tidak valid.');
  return resolveInside(metadataDirectory(locations, userKey), `${projectId}.json`);
}
function activePath(locations, userKey, chatId) {
  return resolveInside(activeDirectory(locations, userKey), locations.perUserRoo ? `${sha(chatId, 20)}.json` : `${userKey}-${sha(chatId, 20)}.json`);
}
function preferencePath(locations, userKey) {
  return resolveInside(preferenceDirectory(locations, userKey), locations.perUserRoo ? 'preferences.json' : `${userKey}.json`);
}

async function atomicJson(file, value) {
  await ensureRealDirectory(path.dirname(file), 0o700);
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, file);
  await fs.chmod(file, 0o600).catch(() => {});
}

async function readJson(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) return null;
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn({ code: error.code, file: path.basename(file) }, 'Project Library metadata could not be read');
    return null;
  }
}

async function withLock(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  const marker = current.catch(() => {});
  locks.set(key, marker);
  try { return await current; }
  finally { if (locks.get(key) === marker) locks.delete(key); }
}

function makeReadme(metadata) {
  const memory = metadata.projectMemory || {};
  const features = (memory.features || []).map(item => `- ${item}`).join('\n') || '- See source files and current preview.';
  const decisions = (memory.decisions || []).map(item => `- ${item}`).join('\n') || '- No explicit technical decisions recorded.';
  return [
    `# ${metadata.name}`,
    '',
    metadata.summary || 'Website project managed by Nexora Project Library.',
    '',
    '## Project status',
    `- Version: ${metadata.version}`,
    `- Updated: ${metadata.updatedAt}`,
    '- Type: Static website frontend',
    '',
    '## Features',
    features,
    '',
    '## Technical decisions',
    decisions,
    '',
    '## Local preview',
    'Open `index.html` in a browser or serve this folder with a local static HTTP server.',
    '',
    '## Scope',
    'Backend services, production authentication, payment processing, databases, and external APIs are not included unless implemented and configured separately.',
    ''
  ].join('\n');
}

async function safeWriteRepository(stage, files, metadata) {
  for (const [relative, content] of Object.entries(files)) {
    const safe = safeRelativePath(relative);
    if (!safe) throw new Error(`Path source tidak aman saat penyimpanan: ${relative}`);
    const destination = resolveInside(stage, ...safe.split('/'));
    await ensureRealDirectory(path.dirname(destination), 0o700);
    await fs.writeFile(destination, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }
  await fs.writeFile(path.join(stage, 'README.md'), makeReadme(metadata), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

async function runGit(cwd, args) {
  try {
    const result = await execFile('git', args, { cwd, timeout: 12_000, maxBuffer: 1024 * 1024, windowsHide: true });
    return { ok: true, stdout: result.stdout || '', stderr: result.stderr || '' };
  } catch (error) {
    return { ok: false, code: error.code || 'GIT_ERROR', message: String(error.stderr || error.message || '').slice(0, 500) };
  }
}

async function commitRepository(stage, existingRepo, commitMessage) {
  let gitAvailable = false;
  if (existingRepo) {
    const gitPath = path.join(existingRepo, '.git');
    try {
      const stat = await fs.lstat(gitPath);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        await fs.cp(gitPath, path.join(stage, '.git'), { recursive: true, errorOnExist: true, force: false });
        gitAvailable = true;
      }
    } catch {}
  }
  if (!gitAvailable) {
    const initialized = await runGit(stage, ['init', '--initial-branch=main']);
    gitAvailable = initialized.ok;
    if (!initialized.ok) {
      const fallback = await runGit(stage, ['init']);
      gitAvailable = fallback.ok;
    }
  }
  if (!gitAvailable) return { available: false, commit: null };
  await runGit(stage, ['config', 'user.name', 'Nexora Project Builder']);
  await runGit(stage, ['config', 'user.email', 'nexora-projects@localhost']);
  await runGit(stage, ['add', '-A']);
  const committed = await runGit(stage, ['commit', '-m', commitMessage, '--allow-empty']);
  if (!committed.ok && !/nothing to commit/i.test(committed.message)) {
    logger.warn({ code: committed.code, message: committed.message }, 'Project Git commit failed; filesystem version remains authoritative');
    return { available: true, commit: null };
  }
  const hash = await runGit(stage, ['rev-parse', '--short', 'HEAD']);
  return { available: true, commit: hash.ok ? hash.stdout.trim().slice(0, 16) : null };
}

async function archiveTrackedFiles(repoPath, metadata, destination, { includeReadme = true } = {}) {
  let archiverFactory = null;
  try { ({ default: archiverFactory } = await import('archiver')); }
  catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  const tracked = [...(metadata.files || []).map(item => item.path), ...(includeReadme ? ['README.md'] : [])];
  const inputs = [];
  // Validate the complete manifest before opening an output stream. A rejected
  // path or symlink must never leave a half-open ZIP writer behind.
  for (const relative of tracked) {
    const safe = relative === 'README.md' ? relative : safeRelativePath(relative);
    if (!safe) throw new Error(`Ekspor ditolak: path ${relative} tidak aman.`);
    const source = resolveInside(repoPath, ...safe.split('/'));
    const stat = await fs.lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Ekspor ditolak: ${relative} bukan file reguler.`);
    if (stat.size > MAX_FILE_BYTES + 32 * 1024) throw new Error(`File ${relative} melewati batas ekspor.`);
    const content = await fs.readFile(source, 'utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{24,}/.test(content)) {
      throw new Error(`Ekspor dihentikan: kemungkinan kredensial terdeteksi pada ${relative}.`);
    }
    inputs.push({ name: `${metadata.slug}/${safe}`, content });
  }

  if (archiverFactory) {
    const output = createWriteStream(destination, { mode: 0o600, flags: 'wx' });
    const archive = archiverFactory('zip', { zlib: { level: 8 }, forceZip64: false });
    const closed = new Promise((resolve, reject) => {
      output.once('close', resolve);
      output.once('error', reject);
      archive.once('error', reject);
      archive.once('warning', error => { if (error.code !== 'ENOENT') reject(error); });
    });
    archive.pipe(output);
    for (const input of inputs) archive.append(input.content, { name: input.name });
    try {
      await archive.finalize();
      await closed;
    } catch (error) {
      archive.abort();
      output.destroy();
      await fs.rm(destination, { force: true }).catch(() => {});
      throw error;
    }
  } else {
    // A minimal fallback for VPS installations that use the system ZIP utility
    // before npm dependency preflight has completed. The production path prefers
    // the declared archiver dependency.
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-project-export-'));
    try {
      for (const input of inputs) {
        const destinationFile = resolveInside(staging, ...input.name.split('/'));
        await ensureRealDirectory(path.dirname(destinationFile), 0o700);
        await fs.writeFile(destinationFile, input.content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      }
      await execFile('zip', ['-q', '-X', '-r', destination, metadata.slug], { cwd: staging, timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true });
    } catch (error) {
      await fs.rm(destination, { force: true }).catch(() => {});
      throw new Error(`ZIP utility fallback failed: ${String(error.message || error).slice(0, 300)}`);
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }
  await fs.chmod(destination, 0o600).catch(() => {});
  const stat = await fs.stat(destination);
  if (stat.size > MAX_EXPORT_BYTES) {
    await fs.rm(destination, { force: true });
    throw new Error(`ZIP proyek melewati batas ${Math.round(MAX_EXPORT_BYTES / 1024 / 1024)} MB.`);
  }
  return { bytes: stat.size, files: inputs.length };
}

async function pruneSnapshots(directory, snapshots) {
  const kept = snapshots.slice(-MAX_SNAPSHOTS);
  const keep = new Set(kept.map(item => item.file));
  for (const entry of await fs.readdir(directory).catch(() => [])) {
    if (entry.endsWith('.zip') && !keep.has(entry)) await fs.rm(path.join(directory, entry), { force: true }).catch(() => {});
  }
  return kept;
}

async function listUserMetadata(locations, userKey) {
  const directory = metadataDirectory(locations, userKey);
  await ensureRealDirectory(directory, 0o700);
  const names = await fs.readdir(directory).catch(() => []);
  const result = [];
  for (const name of names.filter(item => /^[a-f0-9-]{36}\.json$/i.test(item))) {
    const metadata = await readJson(path.join(directory, name));
    if (metadata?.ownerKey === userKey && metadata?.projectId) result.push(metadata);
  }
  return result.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function loadProjectFiles(repoPath, metadata) {
  const files = Object.create(null);
  let totalBytes = 0;
  for (const entry of metadata.files || []) {
    const relative = safeRelativePath(entry.path);
    if (!relative) throw new Error('Manifest repository tersimpan memiliki path yang tidak aman.');
    const file = resolveInside(repoPath, ...relative.split('/'));
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw new Error(`File repository tidak valid: ${relative}`);
    const content = await fs.readFile(file, 'utf8');
    if (crypto.createHash('sha256').update(content).digest('hex') !== entry.sha256) {
      logger.warn({ projectId: metadata.projectId, file: relative }, 'Project source hash differs from manifest; loading edited working copy');
    }
    totalBytes += Buffer.byteLength(content, 'utf8');
    if (totalBytes > MAX_PROJECT_BYTES) throw new Error('Repository melewati batas pembacaan Project Library.');
    files[relative] = content;
  }
  return files;
}

async function getMeta(locations, userKey, projectId) {
  const metadata = await readJson(metadataPath(locations, userKey, projectId));
  if (!metadata || metadata.ownerKey !== userKey || metadata.projectId !== projectId) return null;
  return metadata;
}

async function cleanupUserDirectory(directory, activeSlug) {
  const names = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of names) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.stage-')) {
      const stat = await fs.stat(path.join(directory, entry.name)).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 60 * 60 * 1000) await fs.rm(path.join(directory, entry.name), { recursive: true, force: true }).catch(() => {});
      continue;
    }
    if (!entry.name.startsWith('.backup-')) continue;
    const remainder = entry.name.slice('.backup-'.length);
    const separator = remainder.lastIndexOf('--');
    const slug = separator > 0 ? remainder.slice(0, separator) : '';
    const backup = path.join(directory, entry.name);
    if (slug && slug !== activeSlug) continue;
    const current = slug ? path.join(directory, slug) : '';
    if (current && !(await fs.stat(current).catch(() => null))) await fs.rename(backup, current).catch(() => {});
    else await fs.rm(backup, { recursive: true, force: true }).catch(() => {});
  }
}

export async function listUserProjects({ ownerId }) {
  const userKey = projectUserKey(ownerId);
  const locations = await ensureLibrary();
  await migrateLegacyProjectContainer(locations, userKey);
  const rows = await listUserMetadata(locations, userKey);
  return rows.map(item => ({
    id: item.projectId, slug: item.slug, name: item.name, summary: item.summary,
    version: item.version, fileCount: item.files?.length || 0, totalBytes: item.totalBytes || 0,
    updatedAt: item.updatedAt, createdAt: item.createdAt, gitEnabled: Boolean(item.gitEnabled)
  }));
}

export async function getWebsiteProject({ ownerId, projectId, slug, includeFiles = true }) {
  const userKey = projectUserKey(ownerId);
  const locations = await ensureLibrary();
  await migrateLegacyProjectContainer(locations, userKey);
  let metadata = null;
  if (projectId && /^[a-f0-9-]{36}$/i.test(String(projectId))) metadata = await getMeta(locations, userKey, projectId);
  else if (slug || projectId) {
    const requestedSlug = safeSlug(slug || projectId);
    metadata = (await listUserMetadata(locations, userKey)).find(item => item.slug === requestedSlug);
  }
  if (!metadata) return null;
  const repoPath = resolveInside(userDirectory(locations, userKey), metadata.slug);
  const directory = await fs.lstat(repoPath).catch(() => null);
  if (!directory?.isDirectory() || directory.isSymbolicLink()) return null;
  if (!includeFiles) return { ...metadata, fileManifest: metadata.files, files: undefined, path: repoPath };
  const files = await loadProjectFiles(repoPath, metadata);
  return { ...metadata, path: repoPath, files };
}

export async function getActiveWebsiteProject({ ownerId, chatId = '', includeFiles = true }) {
  const userKey = projectUserKey(ownerId);
  const locations = await ensureLibrary();
  await migrateLegacyProjectContainer(locations, userKey);
  const active = await readJson(activePath(locations, userKey, chatId));
  if (!active?.projectId) return null;
  const metadata = await getMeta(locations, userKey, active.projectId);
  if (!metadata) return null;
  const repoPath = resolveInside(userDirectory(locations, userKey), metadata.slug);
  const directory = await fs.lstat(repoPath).catch(() => null);
  if (!directory?.isDirectory() || directory.isSymbolicLink()) return null;
  if (!includeFiles) return { ...metadata, fileManifest: metadata.files, files: undefined, path: repoPath };
  const files = await loadProjectFiles(repoPath, metadata);
  return { ...metadata, path: repoPath, files };
}

export async function setActiveWebsiteProject({ ownerId, chatId = '', projectId }) {
  const userKey = projectUserKey(ownerId);
  const locations = await ensureLibrary();
  await migrateLegacyProjectContainer(locations, userKey);
  const metadata = await getMeta(locations, userKey, projectId);
  if (!metadata) throw new Error('Proyek tidak ditemukan pada library pengguna ini.');
  await atomicJson(activePath(locations, userKey, chatId), { projectId, updatedAt: new Date().toISOString() });
  return { id: metadata.projectId, slug: metadata.slug, name: metadata.name };
}

export async function getProjectExportPreference({ ownerId }) {
  const userKey = projectUserKey(ownerId);
  const locations = await ensureLibrary();
  await migrateLegacyProjectContainer(locations, userKey);
  const value = await readJson(preferencePath(locations, userKey));
  return ['ask', 'always', 'off'].includes(value?.exportMode) ? value.exportMode : 'ask';
}

export async function setProjectExportPreference({ ownerId, mode }) {
  if (!['ask', 'always', 'off'].includes(mode)) throw new Error('Mode ekspor harus ask, always, atau off.');
  const userKey = projectUserKey(ownerId);
  const locations = await ensureLibrary();
  await migrateLegacyProjectContainer(locations, userKey);
  const file = preferencePath(locations, userKey);
  const previous = await readJson(file) || {};
  await atomicJson(file, { ...previous, exportMode: mode, updatedAt: new Date().toISOString() });
  return mode;
}

async function calculateDirectoryBytes(directory) {
  let total = 0;
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const stat = await fs.lstat(fullPath);
    if (stat.isSymbolicLink()) throw new Error('Project Library menolak symbolic link di workspace pengguna.');
    if (stat.isDirectory()) {
      // Temporary staging/backup folders are transaction artifacts, not committed storage.
      if (entry.name.startsWith('.stage-') || entry.name.startsWith('.backup-')) continue;
      total += await calculateDirectoryBytes(fullPath);
    } else if (stat.isFile()) total += stat.size;
    if (total > MAX_USER_STORAGE_BYTES) return total;
  }
  return total;
}

async function calculateUserStorageBytes(projectDirectory, historyDirectory) {
  const [projects, history] = await Promise.all([
    calculateDirectoryBytes(projectDirectory),
    calculateDirectoryBytes(historyDirectory)
  ]);
  return projects + history;
}

export async function saveWebsiteProject({ ownerId, chatId = '', projectId = null, title, summary = '', files, projectMemory = {}, task = '' }) {
  const userKey = projectUserKey(ownerId);
  const locations = await ensureLibrary();
  await migrateLegacyProjectContainer(locations, userKey);
  const normalized = normalizeFiles(files);
  const taskText = cleanText(task, 1000);
  // Serialize all writes to one user's library, not merely one project, so quota
  // checks, slug allocation, and active pointers remain consistent under parallel jobs.
  const operationKey = `${userKey}:library`;
  return withLock(operationKey, async () => {
    let existing = projectId ? await getMeta(locations, userKey, projectId) : null;
    if (projectId && !existing) throw new Error('Repository yang akan diperbarui tidak ditemukan atau bukan milik pengguna ini.');
    const all = await listUserMetadata(locations, userKey);
    if (!existing && all.length >= MAX_PROJECTS_PER_USER) throw new Error(`Batas ${MAX_PROJECTS_PER_USER} repository per pengguna tercapai.`);
    const oldBytes = existing ? Number(existing.totalBytes) || 0 : 0;
    const currentSourceUsage = all.reduce((sum, item) => sum + (Number(item.totalBytes) || 0), 0);
    if (currentSourceUsage - oldBytes + normalized.totalBytes > MAX_USER_STORAGE_BYTES) throw new Error(`Kuota source Project Library pengguna mencapai ${Math.round(MAX_USER_STORAGE_BYTES / 1024 / 1024)} MB.`);

    const now = new Date().toISOString();
    let slug = existing?.slug || safeSlug(title);
    const userDir = await ensureRealDirectory(userDirectory(locations, userKey), 0o700);
    if (!existing) {
      let suffix = 1;
      while (await fs.stat(path.join(userDir, slug)).catch(() => null)) {
        suffix++;
        slug = `${safeSlug(title).slice(0, 42)}-${suffix}`;
      }
    }
    const projectIdValue = existing?.projectId || crypto.randomUUID();
    const previousMemory = existing?.projectMemory || {};
    const normalizedMemory = normalizeProjectMemory(projectMemory, previousMemory);
    const tasks = [...(existing?.tasks || []), { at: now, request: taskText, version: (existing?.version || 0) + 1 }].filter(item => item.request).slice(-MAX_TASKS);
    const fileManifest = Object.entries(normalized.files).map(([relative, content]) => ({
      path: relative,
      size: Buffer.byteLength(content, 'utf8'),
      sha256: crypto.createHash('sha256').update(content).digest('hex')
    }));
    const metadata = {
      schemaVersion: 1,
      projectId: projectIdValue,
      ownerKey: userKey,
      chatKey: sha(chatId, 20),
      slug,
      name: cleanText(title || existing?.name || 'Website Project', 80),
      summary: cleanText(summary || existing?.summary || '', 500),
      version: (existing?.version || 0) + 1,
      fileCount: normalized.fileCount,
      totalBytes: normalized.totalBytes,
      files: fileManifest,
      projectMemory: normalizedMemory,
      tasks,
      snapshots: existing?.snapshots || [],
      gitEnabled: Boolean(existing?.gitEnabled),
      gitCommit: null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastTaskAt: now
    };
    const projectPath = resolveInside(userDir, slug);
    const stage = await fs.mkdtemp(path.join(userDir, '.stage-'));
    const backup = path.join(userDir, `.backup-${slug}--${crypto.randomUUID()}`);
    let backupCreated = false;
    let repositoryInstalled = false;
    let metadataSaved = false;
    let snapshotPathCreated = null;
    try {
      if (existing) {
        await cleanupUserDirectory(userDir, slug);
        const oldProjectPath = resolveInside(userDir, existing.slug);
        const historyDirectory = resolveInside(projectHistoryRoot(locations, userKey), projectIdValue);
        await ensureRealDirectory(historyDirectory, 0o700);
        const snapshotName = `v${String(existing.version).padStart(4, '0')}.zip`;
        const snapshotPath = path.join(historyDirectory, snapshotName);
        let snapshotAvailable = Boolean(await fs.stat(snapshotPath).catch(() => null));
        if (!snapshotAvailable) {
          try {
            await archiveTrackedFiles(oldProjectPath, existing, snapshotPath);
            snapshotPathCreated = snapshotPath;
            snapshotAvailable = true;
          } catch (error) {
            await fs.rm(snapshotPath, { force: true }).catch(() => {});
            logger.warn({ projectId: projectIdValue, version: existing.version, message: error.message }, 'Project history snapshot could not be created');
          }
        }
        metadata.snapshots = [...(existing.snapshots || []), ...(snapshotAvailable ? [{ version: existing.version, file: snapshotName, createdAt: now }] : [])];
        await fs.rename(oldProjectPath, backup);
        backupCreated = true;
      }

      await safeWriteRepository(stage, normalized.files, metadata);
      const gitResult = await commitRepository(stage, backupCreated ? backup : null, `website: v${metadata.version} ${safeSlug(metadata.name)}`);
      metadata.gitEnabled = gitResult.available;
      metadata.gitCommit = gitResult.commit;
      // Regenerate README after metadata has the final Git status and version.
      await fs.writeFile(path.join(stage, 'README.md'), makeReadme(metadata), { encoding: 'utf8', mode: 0o600 });
      if (metadata.gitEnabled) {
        await runGit(stage, ['add', '-A']);
        const readmeCommit = await runGit(stage, ['commit', '-m', `docs: update project metadata v${metadata.version}`, '--allow-empty']);
        const hash = await runGit(stage, ['rev-parse', '--short', 'HEAD']);
        if (hash.ok) metadata.gitCommit = hash.stdout.trim().slice(0, 16);
        if (!readmeCommit.ok && !/nothing to commit/i.test(readmeCommit.message)) logger.warn({ projectId: projectIdValue, message: readmeCommit.message }, 'Project README Git commit failed');
      }
      await fs.rename(stage, projectPath);
      repositoryInstalled = true;
      await fs.chmod(projectPath, 0o700).catch(() => {});
      const actualUsage = await calculateUserStorageBytes(userDir, projectHistoryRoot(locations, userKey));
      if (actualUsage > MAX_USER_STORAGE_BYTES) throw new Error(`Kuota penyimpanan aktual Project Library terlampaui (${Math.ceil(actualUsage / 1024 / 1024)} MB dari ${Math.round(MAX_USER_STORAGE_BYTES / 1024 / 1024)} MB). Kurangi aset atau versi lama sebelum melanjutkan.`);
      const finalMeta = metadataPath(locations, userKey, projectIdValue);
      await atomicJson(finalMeta, metadata);
      metadataSaved = true;
      if (metadata.snapshots.length > MAX_SNAPSHOTS) {
        try {
          metadata.snapshots = await pruneSnapshots(resolveInside(projectHistoryRoot(locations, userKey), projectIdValue), metadata.snapshots);
          await atomicJson(finalMeta, metadata);
        } catch (error) {
          logger.warn({ projectId: projectIdValue, code: error.code }, 'Project history pruning deferred');
        }
      }
      if (backupCreated) await fs.rm(backup, { recursive: true, force: true }).catch(error => {
        logger.warn({ projectId: projectIdValue, code: error.code }, 'Old project backup cleanup deferred');
      });
      await atomicJson(activePath(locations, userKey, chatId), { projectId: projectIdValue, updatedAt: now }).catch(error => {
        logger.warn({ projectId: projectIdValue, code: error.code }, 'Project saved but active-project pointer could not be updated');
      });
      logger.info({ projectId: projectIdValue, ownerKey: userKey, slug, version: metadata.version, files: metadata.fileCount, bytes: metadata.totalBytes, gitEnabled: metadata.gitEnabled }, 'Persistent website project saved');
      return { ...metadata, path: projectPath, files: normalized.files };
    } catch (error) {
      await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
      if (!metadataSaved) {
        if (repositoryInstalled) await fs.rm(projectPath, { recursive: true, force: true }).catch(() => {});
        if (backupCreated) await fs.rename(backup, projectPath).catch(() => {});
        if (snapshotPathCreated) await fs.rm(snapshotPathCreated, { force: true }).catch(() => {});
      }
      throw error;
    }
  });
}

export async function getProjectHistory({ ownerId, projectId }) {
  const userKey = projectUserKey(ownerId);
  const locations = await ensureLibrary();
  await migrateLegacyProjectContainer(locations, userKey);
  const metadata = await getMeta(locations, userKey, projectId);
  if (!metadata) throw new Error('Repository tidak ditemukan atau bukan milik pengguna ini.');
  return [...(metadata.snapshots || [])].map(item => ({ version: item.version, createdAt: item.createdAt }));
}

export async function createProjectArchive({ ownerId, projectId }) {
  const userKey = projectUserKey(ownerId);
  const locations = await ensureLibrary();
  await migrateLegacyProjectContainer(locations, userKey);
  // Keep an export pinned to one committed repository version while an update
  // is staged and atomically installed for the same user.
  return withLock(`${userKey}:library`, async () => {
    const metadata = await getMeta(locations, userKey, projectId);
    if (!metadata) throw new Error('Repository tidak ditemukan atau bukan milik pengguna ini.');
    const projectPath = resolveInside(userDirectory(locations, userKey), metadata.slug);
    const archiveName = `${metadata.slug}-v${metadata.version}.zip`;
    const tempRoot = projectTempRoot(locations, userKey);
    await ensureRealDirectory(tempRoot, 0o700);
    const archivePath = resolveInside(tempRoot, `${crypto.randomUUID()}-${archiveName}`);
    try {
      const result = await archiveTrackedFiles(projectPath, metadata, archivePath);
      return { path: archivePath, fileName: archiveName, bytes: result.bytes, files: result.files, project: { id: metadata.projectId, name: metadata.name, slug: metadata.slug, version: metadata.version } };
    } catch (error) {
      await fs.rm(archivePath, { force: true }).catch(() => {});
      throw error;
    }
  });
}

export async function removeProjectArchive(archivePath) {
  const locations = await ensureLibrary();
  const resolved = path.resolve(archivePath);
  if (!resolved.endsWith('.zip')) return false;
  if (locations.perUserRoo) {
    const relative = path.relative(locations.root, resolved).split(path.sep);
    if (relative.length !== 3 || !/^[a-f0-9]{64}$/.test(relative[0]) || relative[1] !== '.tmp') return false;
  } else if (resolved === locations.temp || !resolved.startsWith(`${locations.temp}${path.sep}`)) return false;
  await fs.rm(resolved, { force: true });
  return true;
}

export async function getProjectLibraryStatus({ ownerId }) {
  const userKey = projectUserKey(ownerId);
  const locations = await ensureLibrary();
  await migrateLegacyProjectContainer(locations, userKey);
  const rows = await listUserMetadata(locations, userKey);
  // Match the quota's real accounting: current repositories, local Git objects,
  // and retained snapshots. Source-only totals underreported actual disk use.
  const storageBytes = await calculateUserStorageBytes(
    userDirectory(locations, userKey),
    projectHistoryRoot(locations, userKey)
  );
  return {
    workspace: 'private-per-user',
    projects: rows.length,
    maxProjects: MAX_PROJECTS_PER_USER,
    storageBytes,
    maxStorageBytes: MAX_USER_STORAGE_BYTES,
    activeVersionedProjects: rows.filter(item => item.gitEnabled).length
  };
}

export function isProjectExportIntent(text) {
  return /\b(?:zip|\.zip|arsip(?:kan)?|ekspor|export|unduh(?:kan)?|download|kirim(?:kan)?\s+(?:file|repository|repo|project|proyek))\b/i.test(String(text || ''));
}

export function isExplicitNewWebsiteProject(text) {
  const value = String(text || '').toLowerCase();
  return /\b(?:buat(?:kan)?|bikin(?:kan)?|bangun|mulai)\b.{0,55}\b(?:website|web\s*site|situs|landing\s*page|proyek|project)\b.{0,30}\b(?:baru|lain|terpisah)\b/.test(value)
    || /\b(?:proyek|project|website|situs)\s+(?:baru|lain|terpisah)\b/.test(value);
}
