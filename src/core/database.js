/**
 * Append-only JSONL event database.
 *
 * Durability model:
 * - One newline-delimited event per write.
 * - SHA-256 hash chain detects edits, truncation, and invalid records.
 * - Primary journal + byte-identical mirror journal.
 * - fsync before acknowledging a write.
 * - Recovery selects the longest valid journal and repairs the other copy.
 * - Size-based ZIP archival occurs only after archive integrity verification.
 *
 * This is a single-writer local database, not a distributed multi-process database.
 */
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { logger } from './logger.js';

const ROOT = path.resolve('data');
const PRIMARY_DIR = path.join(ROOT, 'journal');
const MIRROR_DIR = path.join(ROOT, 'replica');
const ARCHIVE_DIR = path.join(ROOT, 'archives');
const PRIMARY = path.join(PRIMARY_DIR, 'active.jsonl');
const MIRROR = path.join(MIRROR_DIR, 'active.jsonl');
const ARCHIVE_INDEX = path.join(ARCHIVE_DIR, 'index.jsonl');
const CONTROL_DIR = path.join(ROOT, 'control');
const CONFIG_SNAPSHOT = path.join(CONTROL_DIR, 'config.snapshot.jsonl');

let sequence = 0;
let lastHash = 'GENESIS';
let activeSegmentId = crypto.randomUUID();
let initialized = false;
let writeQueue = Promise.resolve();
let settings = { segmentMaxBytes: 8 * 1024 * 1024, archiveMaxCount: 120, mirrorEnabled: true, fsync: true };

const canonical = value => JSON.stringify(value);
const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const hashable = ({ hash, ...record }) => record;

async function ensureLayout() {
  for (const dir of [ROOT, PRIMARY_DIR, MIRROR_DIR, ARCHIVE_DIR, CONTROL_DIR, path.join(ROOT, 'quarantine')]) await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  for (const file of [PRIMARY, MIRROR, ARCHIVE_INDEX, CONFIG_SNAPSHOT]) {
    try { await fs.access(file); } catch { await fs.writeFile(file, '', { mode: 0o600 }); }
  }
}

async function readValidJournal(file) {
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); } catch { return { records: [], validBytes: 0, error: 'missing' }; }
  const records = [];
  let previous = 'GENESIS';
  let validBytes = 0;
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      if (i === lines.length - 1) break;
      return { records, validBytes, error: `empty line at ${i + 1}` };
    }
    let parsed;
    try { parsed = JSON.parse(line); } catch { return { records, validBytes, error: `invalid JSON at ${i + 1}` }; }
    if (!Number.isInteger(parsed.seq) || parsed.seq !== records.length + 1 || parsed.prevHash !== previous || parsed.hash !== digest(hashable(parsed))) {
      return { records, validBytes, error: `integrity mismatch at ${i + 1}` };
    }
    records.push(parsed);
    previous = parsed.hash;
    validBytes += Buffer.byteLength(line) + 1;
  }
  return { records, validBytes, error: null };
}

async function quarantine(file, reason) {
  try {
    const target = path.join(ROOT, 'quarantine', `${path.basename(file)}.${Date.now()}.corrupt`);
    await fs.copyFile(file, target);
    logger.warn({ file, target, reason }, 'Invalid journal copied to quarantine');
  } catch (error) { logger.error({ err: error, file }, 'Unable to quarantine journal'); }
}

async function writeAtomic(file, data) {
  const temp = `${file}.${process.pid}.tmp`;
  const handle = await fs.open(temp, 'w', 0o600);
  try { await handle.writeFile(data); if (settings.fsync) await handle.sync(); }
  finally { await handle.close(); }
  await fs.rename(temp, file);
  if (settings.fsync) {
    try {
      const directory = await fs.open(path.dirname(file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } catch {}
  }
}

export function configureDatabase(nextSettings = {}) { settings = { ...settings, ...nextSettings }; }

export async function initializeDatabase(options = {}) {
  if (initialized) return;
  await ensureLayout();
  settings = { ...settings, ...(options.settings || {}) };
  const [primary, mirror] = await Promise.all([readValidJournal(PRIMARY), readValidJournal(MIRROR)]);
  let chosen = primary;
  let chosenFile = PRIMARY;

  if (primary.error) await quarantine(PRIMARY, primary.error);
  if (mirror.error) await quarantine(MIRROR, mirror.error);

  // A journal with a corrupt trailing line may still contain a longer valid prefix.
  // Prefer the copy with the most verified records, even if its tail is damaged.
  if (mirror.records.length > primary.records.length) {
    chosen = mirror; chosenFile = MIRROR;
    logger.warn({ primaryValid: primary.records.length, replicaValid: mirror.records.length }, 'Restoring longest verified journal prefix from replica');
  } else if (primary.records.length > mirror.records.length) {
    chosen = primary; chosenFile = PRIMARY;
    if (mirror.error) logger.warn({ primaryValid: primary.records.length, replicaValid: mirror.records.length }, 'Restoring primary journal over damaged/behind replica');
  } else if (primary.error && mirror.error && primary.records.length === 0) {
    throw new Error('Both JSONL journals failed integrity validation. Quarantined copies retained; manual archive recovery required.');
  } else if (primary.error && !mirror.error) {
    chosen = mirror; chosenFile = MIRROR;
    logger.warn('Primary journal invalid; recovering from replica');
  } else if (mirror.error && !primary.error) {
    chosen = primary; chosenFile = PRIMARY;
    logger.warn('Replica journal invalid; recovering from primary');
  }

  const serialized = chosen.records.map(canonical).join('\n') + (chosen.records.length ? '\n' : '');
  await writeAtomic(PRIMARY, serialized);
  if (settings.mirrorEnabled) await writeAtomic(MIRROR, serialized);

  sequence = chosen.records.length;
  lastHash = chosen.records.at(-1)?.hash || 'GENESIS';
  activeSegmentId = chosen.records[0]?.segmentId || crypto.randomUUID();
  initialized = true;
  logger.info({ records: sequence, restoredFrom: chosenFile }, 'JSONL database ready');
}

function enqueue(operation) {
  const run = writeQueue.then(operation);
  writeQueue = run.catch(() => {});
  return run;
}

export async function appendRecord(type, payload = {}, metadata = {}) {
  if (!initialized) await initializeDatabase();
  return enqueue(async () => {
    const base = {
      seq: sequence + 1,
      segmentId: activeSegmentId,
      ts: new Date().toISOString(),
      type: String(type),
      payload,
      metadata,
      prevHash: lastHash
    };
    const record = { ...base, hash: digest(base) };
    const line = `${canonical(record)}\n`;
    const primaryHandle = await fs.open(PRIMARY, 'a', 0o600);
    try { await primaryHandle.writeFile(line); if (settings.fsync) await primaryHandle.sync(); }
    finally { await primaryHandle.close(); }

    if (settings.mirrorEnabled) {
      try {
        const mirrorHandle = await fs.open(MIRROR, 'a', 0o600);
        try { await mirrorHandle.writeFile(line); if (settings.fsync) await mirrorHandle.sync(); }
        finally { await mirrorHandle.close(); }
      } catch (error) {
        logger.error({ err: error, seq: record.seq }, 'Replica append failed; primary remains authoritative');
      }
    }

    sequence = record.seq;
    lastHash = record.hash;
    if (record.type === 'config.replace') {
      // A compact, one-line JSONL checkpoint keeps the latest control state
      // available even when old archive segments are pruned by retention.
      await writeAtomic(CONFIG_SNAPSHOT, `${canonical(record)}\n`);
    }
    try { await maybeArchive(); }
    catch (error) { logger.error({ err: error, seq: record.seq }, 'Archive rotation failed; durable journal append retained for retry'); }
    return record;
  });
}

export async function getRecords(filter = {}) {
  if (!initialized) await initializeDatabase();
  await writeQueue;
  const { records: active } = await readValidJournal(PRIMARY);
  const archived = await searchArchives({ type: filter.type, limit: Number.MAX_SAFE_INTEGER });
  const unique = new Map();
  for (const record of [...archived, ...active]) {
    const key = `${record.segmentId || record._archiveId || 'active'}:${record.seq}`;
    unique.set(key, record);
  }
  return [...unique.values()].filter(record =>
    (!filter.type || record.type === filter.type) &&
    (!filter.since || record.ts >= filter.since) &&
    (!filter.until || record.ts <= filter.until) &&
    (!filter.predicate || filter.predicate(record))
  ).sort((a,b) => a.ts.localeCompare(b.ts));
}

export async function getLatestConfigRecord() {
  if (!initialized) await initializeDatabase();
  try {
    const raw = (await fs.readFile(CONFIG_SNAPSHOT, 'utf8')).trim();
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record.type !== 'config.replace' || record.hash !== digest(hashable(record))) return null;
    return record;
  } catch { return null; }
}

async function zipFile(source, destination) {
  const { default: archiver } = await import('archiver');
  await new Promise((resolve, reject) => {
    const output = createWriteStream(destination, { mode: 0o600 });
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(source, { name: path.basename(source) });
    archive.finalize();
  });
}

async function verifyZip(zipPath, expectedZipSha, expectedSourceSha) {
  const { default: yauzl } = await import('yauzl');
  const file = await fs.readFile(zipPath);
  if (crypto.createHash('sha256').update(file).digest('hex') !== expectedZipSha) return false;
  return new Promise(resolve => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return resolve(false);
      let settled = false;
      const finish = value => { if (!settled) { settled = true; zip.close(); resolve(value); } };
      zip.readEntry();
      zip.on('entry', entry => {
        if (!entry.fileName.endsWith('.jsonl')) return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return finish(false);
          const hash = crypto.createHash('sha256');
          stream.on('data', chunk => hash.update(chunk));
          stream.on('error', () => finish(false));
          stream.on('end', () => finish(hash.digest('hex') === expectedSourceSha));
        });
      });
      zip.on('end', () => finish(false));
      zip.on('error', () => finish(false));
    });
  });
}

async function appendArchiveIndex(entry) {
  const handle = await fs.open(ARCHIVE_INDEX, 'a', 0o600);
  try { await handle.writeFile(`${JSON.stringify(entry)}\n`); if (settings.fsync) await handle.sync(); }
  finally { await handle.close(); }
}

async function maybeArchive() {
  const stat = await fs.stat(PRIMARY);
  if (stat.size < settings.segmentMaxBytes) return;
  const segmentId = activeSegmentId;
  const source = path.join(ARCHIVE_DIR, `${segmentId}.jsonl`);
  const zipPath = `${source}.zip`;
  await fs.copyFile(PRIMARY, source);
  const sourceBytes = await fs.readFile(source);
  const sourceSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');
  try { await fs.access(zipPath); } catch { await zipFile(source, zipPath); }
  const zipSha256 = crypto.createHash('sha256').update(await fs.readFile(zipPath)).digest('hex');
  if (!await verifyZip(zipPath, zipSha256, sourceSha256)) {
    await fs.rm(zipPath, { force: true });
    throw new Error(`Archive verification failed: ${zipPath}`);
  }
  const validation = await readValidJournal(source);
  if (validation.error) throw new Error(`Refusing to rotate invalid journal segment: ${validation.error}`);
  const indexed = (await fs.readFile(ARCHIVE_INDEX, 'utf8')).split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).some(row => row?.id === segmentId);
  if (!indexed) await appendArchiveIndex({
    id: segmentId, segmentId, file: path.basename(zipPath), firstSeq: validation.records[0]?.seq,
    lastSeq: validation.records.at(-1)?.seq, records: validation.records.length,
    bytes: sourceBytes.length, sha256: sourceSha256, zipSha256, createdAt: new Date().toISOString()
  });
  await writeAtomic(PRIMARY, '');
  if (settings.mirrorEnabled) await writeAtomic(MIRROR, '');
  sequence = 0;
  lastHash = 'GENESIS';
  activeSegmentId = crypto.randomUUID();
  await fs.rm(source, { force: true });
  await pruneArchives();
  logger.info({ archive: zipPath, records: validation.records.length }, 'JSONL segment archived');
}

async function pruneArchives() {
  const rows = (await fs.readFile(ARCHIVE_INDEX, 'utf8')).split('\n').filter(Boolean);
  if (rows.length <= settings.archiveMaxCount) return;
  const removed = rows.slice(0, rows.length - settings.archiveMaxCount);
  for (const line of removed) {
    try { const entry = JSON.parse(line); await fs.rm(path.join(ARCHIVE_DIR, entry.file), { force: true }); } catch {}
  }
  const kept = rows.slice(-settings.archiveMaxCount).join('\n') + '\n';
  await writeAtomic(ARCHIVE_INDEX, kept);
}

/** Stream-search ZIP archives without extracting them to the filesystem. */
export async function searchArchives({ type, text, fromSeq, toSeq, limit = 100 } = {}) {
  const rows = (await fs.readFile(ARCHIVE_INDEX, 'utf8')).split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  if (!rows.length) return [];
  const { default: yauzl } = await import('yauzl');
  const results = [];
  for (const row of rows) {
    if (fromSeq && row.lastSeq < fromSeq) continue;
    if (toSeq && row.firstSeq > toSeq) continue;
    const archivePath = path.join(ARCHIVE_DIR, row.file);
    const found = await new Promise((resolve, reject) => {
      yauzl.open(archivePath, { lazyEntries: true }, (error, zip) => {
        if (error || !zip) return reject(error || new Error('Cannot open archive'));
        zip.readEntry();
        zip.on('entry', entry => {
          if (!entry.fileName.endsWith('.jsonl')) return zip.readEntry();
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError) { zip.close(); return reject(streamError); }
            let pending = '';
            stream.on('data', chunk => {
              pending += chunk.toString('utf8');
              let index;
              while ((index = pending.indexOf('\n')) >= 0) {
                const line = pending.slice(0,index); pending = pending.slice(index+1);
                if (!line) continue;
                try {
                  const record = JSON.parse(line);
                  record.segmentId ||= row.segmentId || row.id;
                  if ((!type || record.type === type) && (!fromSeq || record.seq >= fromSeq) && (!toSeq || record.seq <= toSeq) && (!text || JSON.stringify(record).includes(text))) {
                    results.push(record);
                  }
                } catch {}
              }
            });
            stream.on('end', () => { zip.close(); resolve(); });
            stream.on('error', reject);
          });
        });
        zip.on('end', resolve);
        zip.on('error', reject);
      });
    });
    if (results.length >= limit) break;
  }
  return results.slice(0, limit);
}

export async function databaseHealth() {
  if (!initialized) await initializeDatabase();
  const [primary, mirror, archives] = await Promise.all([
    readValidJournal(PRIMARY), readValidJournal(MIRROR),
    fs.readFile(ARCHIVE_INDEX, 'utf8').then(s => s.split('\n').filter(Boolean).length)
  ]);
  return {
    sequence, lastHash, primary: { records: primary.records.length, error: primary.error },
    mirror: { records: mirror.records.length, error: mirror.error },
    archives, mirrorEnabled: settings.mirrorEnabled
  };
}
