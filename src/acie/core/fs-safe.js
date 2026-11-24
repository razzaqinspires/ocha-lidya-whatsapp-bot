import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const sha256Buffer = value => crypto.createHash('sha256').update(value).digest('hex');
export const sha256File = async file => {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(file, 'r');
  try {
    const stream = handle.createReadStream();
    for await (const chunk of stream) hash.update(chunk);
  } finally { await handle.close().catch(() => {}); }
  return hash.digest('hex');
};

export function safeSlug(value, label = 'identifier') {
  const raw = String(value || '').trim();
  if (!raw || /[\\/]/.test(raw) || raw.includes('..')) throw new TypeError(`${label} must not contain path separators or traversal sequences`);
  const text = raw.toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!text || text.length > 80) throw new TypeError(`${label} must resolve to 1-80 safe ASCII characters`);
  return text;
}

export function safeRelativePath(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`Unsafe contribution path: ${normalized.slice(0, 120)}`);
  }
  const parts = normalized.split('/');
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..')) throw new Error(`Unsafe contribution path: ${normalized.slice(0, 120)}`);
  return parts.join(path.sep);
}

export async function writeJsonAtomic(file, value, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temp, 'wx', mode);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  await fs.rename(temp, file);
}

export async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export async function ensurePrivateDir(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try { await fs.chmod(directory, 0o700); } catch {}
}

export function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function acquireExclusiveFileLock(file, message = 'Another operation holds this lock.') {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const handle = await fs.open(file, 'wx', 0o600).catch(error => {
    if (error.code === 'EEXIST') throw new Error(message);
    throw error;
  });
  await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  return async () => { await handle.close().catch(() => {}); await fs.unlink(file).catch(() => {}); };
}
