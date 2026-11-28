import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createReadStream, createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { getRuntimeSettings } from '../core/runtime-settings.js';

const VERSION = 1;
const locks = new Map();
const keyCache = new Map();
const verifiedJournalCache = new Map();
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const canonical = value => JSON.stringify(value);
const monthOf = value => String(value || new Date().toISOString()).slice(0, 7);

function normalizeUserId(userId) {
  const value = String(userId || '')
    .trim()
    .replace(/:\d+(?=@)/, '');
  if (!value || value.length > 160 || /@g\.us$|@broadcast$|@newsletter$/i.test(value)) {
    throw new TypeError('Private User Vault hanya menerima identitas pengguna, bukan grup atau broadcast.');
  }
  if (!/^\d{8,20}@(s\.whatsapp\.net|lid)$/i.test(value) && !/^\d{8,20}$/.test(value)) {
    throw new TypeError('Format identitas pengguna tidak valid untuk User Vault.');
  }
  return value;
}

function userKey(userId) {
  return hash(normalizeUserId(userId));
}
function rootDirectory() {
  return path.resolve(getRuntimeSettings().paths.rooRoot || path.join(process.cwd(), 'data', 'roo'));
}
function safeChild(parent, child) {
  const resolved = path.resolve(parent, child);
  if (resolved !== parent && !resolved.startsWith(`${parent}${path.sep}`))
    throw new Error('User Vault path traversal ditolak.');
  return resolved;
}

async function ensureDirectory(directory, mode = 0o700) {
  await fs.mkdir(directory, { recursive: true, mode });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`User Vault menolak direktori tidak aman: ${path.basename(directory)}`);
  await fs.chmod(directory, mode).catch(() => {});
}

async function masterKey() {
  const root = rootDirectory();
  if (keyCache.has(root)) return keyCache.get(root);
  const promise = (async () => {
    await ensureDirectory(root);
    const configured = String(process.env.OCHA_ROO_MASTER_KEY || '').trim();
    if (configured) {
      if (!/^[a-f0-9]{64}$/i.test(configured))
        throw new Error('OCHA_ROO_MASTER_KEY harus berupa 64 karakter hexadecimal (32 byte).');
      return Buffer.from(configured, 'hex');
    }
    const file = safeChild(root, '.master-key');
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 32)
        throw new Error('File kunci User Vault tidak valid.');
      await fs.chmod(file, 0o600).catch(() => {});
      return await fs.readFile(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const generated = crypto.randomBytes(32);
    try {
      const handle = await fs.open(file, 'wx', 0o600);
      try {
        await handle.writeFile(generated);
        await handle.sync();
      } finally {
        await handle.close();
      }
      return generated;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await fs.readFile(file);
      if (existing.length !== 32)
        throw new Error('Race pembuatan kunci User Vault menghasilkan file yang tidak valid.');
      return existing;
    }
  })();
  keyCache.set(root, promise);
  try {
    return await promise;
  } catch (error) {
    keyCache.delete(root);
    throw error;
  }
}

async function userDirectories(userId) {
  const root = rootDirectory();
  const id = userKey(userId);
  const user = safeChild(root, id);
  await ensureDirectory(root);
  await ensureDirectory(user);
  const directories = {
    root: user,
    profile: safeChild(user, 'profile'),
    memory: safeChild(user, 'memory'),
    conversations: safeChild(user, 'conversations'),
    projects: safeChild(user, 'projects'),
    index: safeChild(user, 'index'),
    journal: safeChild(user, 'journal'),
  };
  for (const directory of Object.values(directories).slice(1)) await ensureDirectory(directory);
  return { ...directories, id };
}

function encryptObject(value, key, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value))), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: ciphertext.toString('base64'),
  };
}
function decryptObject(envelope, key, aad) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const clear = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
    return JSON.parse(clear.toString('utf8'));
  } catch {
    const error = new Error('Autentikasi/dekripsi User Vault gagal. Data tidak boleh digunakan sebagai konteks AI.');
    error.code = 'OCHA_VAULT_DECRYPT_FAILED';
    throw error;
  }
}

async function userEncryptionKey(userId) {
  const master = await masterKey();
  return crypto.hkdfSync('sha256', master, Buffer.from(userKey(userId)), Buffer.from('ocha-lidya-user-vault-v1'), 32);
}

async function atomicWrite(file, data) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, file);
  await fs.chmod(file, 0o600).catch(() => {});
}

async function withUserLock(id, operation) {
  const prior = locks.get(id) || Promise.resolve();
  const current = prior.catch(() => {}).then(operation);
  const marker = current.catch(() => {});
  locks.set(id, marker);
  try {
    return await current;
  } finally {
    if (locks.get(id) === marker) locks.delete(id);
  }
}

function rowHash(row) {
  return hash(
    canonical({
      version: row.version,
      seq: row.seq,
      createdAt: row.createdAt,
      prevHash: row.prevHash,
      iv: row.iv,
      tag: row.tag,
      data: row.data,
    }),
  );
}

async function listJournalFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && /^\d{4}-\d{2}\.jsonl$/.test(entry.name))
    .map(entry => entry.name)
    .sort()
    .map(name => safeChild(directory, name));
}

async function readRowsFromFile(file, { onRow, reverse = false } = {}) {
  if (reverse) {
    // Walk backward in bounded chunks instead of reading an entire month into
    // memory. Encrypted JSONL rows contain only ASCII envelope bytes.
    const handle = await fs.open(file, 'r');
    try {
      const stat = await handle.stat();
      const chunkSize = 64 * 1024;
      let position = stat.size;
      let carry = '';
      let lineNo = 0;
      while (position > 0) {
        const start = Math.max(0, position - chunkSize);
        const buffer = Buffer.alloc(position - start);
        await handle.read(buffer, 0, buffer.length, start);
        const parts = `${buffer.toString('utf8')}${carry}`.split('\n');
        carry = parts.shift() || '';
        for (let i = parts.length - 1; i >= 0; i--) {
          if (!parts[i]) continue;
          lineNo++;
          let row;
          try {
            row = JSON.parse(parts[i]);
          } catch {
            throw new Error(`JSONL User Vault rusak pada ${path.basename(file)} dekat baris akhir ${lineNo}.`);
          }
          if ((await onRow(row)) === false) return;
        }
        position = start;
      }
      if (carry.trim()) {
        let row;
        try {
          row = JSON.parse(carry);
        } catch {
          throw new Error(`JSONL User Vault rusak pada ${path.basename(file)} baris pertama.`);
        }
        await onRow(row);
      }
    } finally {
      await handle.close();
    }
    return;
  }
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNo = 0;
  for await (const line of lines) {
    lineNo++;
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error(`JSONL User Vault rusak pada ${path.basename(file)} baris ${lineNo}.`);
    }
    await onRow(row);
  }
}

async function decryptRow(row, directories, key) {
  if (!row || row.version !== VERSION || !Number.isInteger(row.seq) || row.seq < 1 || typeof row.hash !== 'string') {
    throw new Error('Schema event User Vault tidak valid.');
  }
  const payload = decryptObject({ iv: row.iv, tag: row.tag, data: row.data }, key, `${directories.id}:${row.seq}`);
  return { seq: row.seq, createdAt: row.createdAt, type: payload.type, payload: payload.payload };
}

async function verifyJournalIntegrity(directories, key) {
  const files = await listJournalFiles(directories.journal);
  const previousCache = verifiedJournalCache.get(directories.id) || new Map();
  const currentCache = new Map();
  let expectedSeq = 0;
  let previousHash = 'GENESIS';
  for (const file of files) {
    const stat = await fs.stat(file);
    const cached = previousCache.get(file);
    const signatureMatches =
      cached &&
      cached.size === stat.size &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.ino === stat.ino &&
      cached.device === stat.dev &&
      cached.ctimeMs === stat.ctimeMs &&
      cached.startSeq === expectedSeq + 1 &&
      cached.startPrevHash === previousHash;
    if (signatureMatches) {
      expectedSeq = cached.lastSeq;
      previousHash = cached.lastHash;
      currentCache.set(file, cached);
      continue;
    }
    const startSeq = expectedSeq + 1;
    const startPrevHash = previousHash;
    let rowCount = 0;
    await readRowsFromFile(file, {
      onRow: async row => {
        if (row.seq !== expectedSeq + 1 || row.prevHash !== previousHash || row.hash !== rowHash(row)) {
          const error = new Error(
            'Integritas hash-chain User Vault gagal. Konteks AI dihentikan untuk mencegah penggunaan data rusak.',
          );
          error.code = 'OCHA_VAULT_INTEGRITY_FAILED';
          throw error;
        }
        // Authenticate AES-GCM tags for every row in a changed segment. A local
        // edit that recomputes the unkeyed row hash must still fail decryption.
        await decryptRow(row, directories, key);
        expectedSeq = row.seq;
        previousHash = row.hash;
        rowCount++;
      },
    });
    currentCache.set(file, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      ino: stat.ino,
      device: stat.dev,
      startSeq,
      startPrevHash,
      lastSeq: expectedSeq,
      lastHash: previousHash,
      rowCount,
    });
  }
  if (previousCache.size && [...previousCache.keys()].some(file => !currentCache.has(file))) {
    const error = new Error(
      'Segmen arsip User Vault hilang atau berubah nama. Operasi dihentikan untuk menjaga integritas.',
    );
    error.code = 'OCHA_VAULT_INTEGRITY_FAILED';
    throw error;
  }
  verifiedJournalCache.set(directories.id, currentCache);
  return { files, lastSeq: expectedSeq, lastHash: previousHash };
}

function indexTokens(text) {
  const stop = new Set([
    'yang',
    'dan',
    'atau',
    'dengan',
    'untuk',
    'dari',
    'pada',
    'ini',
    'itu',
    'aku',
    'saya',
    'kamu',
    'dia',
    'the',
    'and',
    'for',
    'with',
    'was',
    'are',
    'jadi',
    'karena',
    'kalau',
  ]);
  return [
    ...new Set(
      String(text || '')
        .toLocaleLowerCase('id-ID')
        .match(/[\p{L}]{3,}|[\p{N}]{1,}/gu) || [],
    ),
  ]
    .filter(word => !stop.has(word))
    .slice(0, 120);
}
function searchIndexFile(directories, month) {
  return safeChild(directories.index, `conversation-${month}.vault`);
}
async function readConversationIndex(directories, key, month) {
  const file = searchIndexFile(directories, month);
  try {
    const envelope = JSON.parse(await fs.readFile(file, 'utf8'));
    return decryptObject(envelope, key, `${directories.id}:conversation-index:${month}`);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function buildConversationIndex(file, directories, key, month) {
  const stat = await fs.stat(file);
  const documents = [];
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let offset = 0;
  let lastSeq = 0;
  for await (const line of lines) {
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error(`Tidak dapat membangun indeks percakapan: JSONL rusak pada ${path.basename(file)}.`);
    }
    const length = Buffer.byteLength(line) + 1;
    if (row.version !== VERSION || !Number.isInteger(row.seq))
      throw new Error('Schema row tidak valid saat membangun indeks percakapan.');
    const event = await decryptRow(row, directories, key);
    if (event.type === 'conversation.turn') {
      const tokens = indexTokens(event.payload?.content);
      if (tokens.length)
        documents.push({
          seq: row.seq,
          createdAt: event.payload?.originalCreatedAt || event.createdAt,
          offset,
          length,
          role: event.payload?.role === 'assistant' ? 'assistant' : 'user',
          tokens,
        });
    }
    lastSeq = row.seq;
    offset += length;
  }
  return { version: 1, month, journalSize: stat.size, lastSeq, documents };
}
async function updateConversationIndex({
  directories,
  key,
  file,
  month,
  sequence,
  previousSize,
  line,
  createdAt,
  eventType,
  payload,
}) {
  const indexFile = searchIndexFile(directories, month);
  const stat = await fs.stat(file);
  let index = await readConversationIndex(directories, key, month);
  if (index?.journalSize === previousSize && index.lastSeq === sequence - 1) {
    if (eventType === 'conversation.turn') {
      const tokens = indexTokens(payload?.content);
      if (tokens.length)
        index.documents.push({
          seq: sequence,
          createdAt: payload?.originalCreatedAt || createdAt,
          offset: previousSize,
          length: Buffer.byteLength(line),
          role: payload?.role === 'assistant' ? 'assistant' : 'user',
          tokens,
        });
    }
    index.lastSeq = sequence;
    index.journalSize = stat.size;
  } else {
    index = await buildConversationIndex(file, directories, key, month);
  }
  const envelope = encryptObject(index, key, `${directories.id}:conversation-index:${month}`);
  await atomicWrite(indexFile, `${canonical(envelope)}\n`);
}
async function readIndexedConversationRow(doc, directories, key, month) {
  const file = safeChild(directories.journal, `${month}.jsonl`);
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(doc.length);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, doc.offset);
    if (bytesRead !== doc.length) throw new Error('Pointer indeks percakapan tidak lengkap.');
    const row = JSON.parse(buffer.toString('utf8').trim());
    return decryptRow(row, directories, key);
  } finally {
    await handle.close();
  }
}

export async function appendUserVaultEvent(userId, type, payload = {}) {
  const normalized = normalizeUserId(userId);
  const directories = await userDirectories(normalized);
  const key = await userEncryptionKey(normalized);
  return withUserLock(directories.id, async () => {
    const verified = await verifyJournalIntegrity(directories, key);
    const sequence = verified.lastSeq + 1;
    const previousHash = verified.lastHash;
    const createdAt = new Date().toISOString();
    const encrypted = encryptObject({ type: String(type || 'event'), payload }, key, `${directories.id}:${sequence}`);
    const row = { version: VERSION, seq: sequence, createdAt, prevHash: previousHash, ...encrypted };
    row.hash = rowHash(row);
    const month = monthOf(createdAt);
    const file = safeChild(directories.journal, `${month}.jsonl`);
    const previousSize = await fs
      .stat(file)
      .then(stat => stat.size)
      .catch(error => (error.code === 'ENOENT' ? 0 : Promise.reject(error)));
    const line = `${canonical(row)}\n`;
    const handle = await fs.open(file, 'a', 0o600);
    try {
      await handle.writeFile(line);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.chmod(file, 0o600).catch(() => {});
    // Retain verification checkpoints for closed monthly segments and advance
    // the active segment checkpoint using the row we just authenticated.
    const cache = verifiedJournalCache.get(directories.id);
    const prior = cache?.get(file);
    const stat = await fs.stat(file);
    cache?.set(file, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      ino: stat.ino,
      device: stat.dev,
      startSeq: prior?.startSeq ?? sequence,
      startPrevHash: prior?.startPrevHash ?? previousHash,
      lastSeq: sequence,
      lastHash: row.hash,
      rowCount: (prior?.rowCount || 0) + 1,
    });
    try {
      await updateConversationIndex({
        directories,
        key,
        file,
        month,
        sequence,
        previousSize,
        line,
        createdAt,
        eventType: String(type || 'event'),
        payload,
      });
    } catch {
      // The journal remains authoritative. Search lazily rebuilds a missing or
      // stale month index from its authenticated journal segment.
    }
    return { seq: sequence, createdAt, type: String(type || 'event'), hash: row.hash };
  });
}

export async function readUserVaultEvents(userId, { types, limit = Infinity, reverse = false } = {}) {
  const normalized = normalizeUserId(userId);
  const directories = await userDirectories(normalized);
  const key = await userEncryptionKey(normalized);
  const { files } = await verifyJournalIntegrity(directories, key);
  const accepted = types ? new Set(Array.isArray(types) ? types : [types]) : null;
  const keep = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Infinity;
  if (keep === 0) return [];
  const result = [];
  const orderedFiles = reverse ? [...files].reverse() : files;
  for (const file of orderedFiles) {
    let reachedLimit = false;
    await readRowsFromFile(file, {
      reverse,
      onRow: async row => {
        const event = await decryptRow(row, directories, key);
        if (accepted && !accepted.has(event.type)) return;
        result.push(event);
        if (result.length >= keep) {
          reachedLimit = true;
          return false;
        }
      },
    });
    if (reachedLimit) break;
  }
  return result;
}

export async function saveUserVaultSnapshot(userId, area, value) {
  const normalized = normalizeUserId(userId);
  if (!/^(profile|memory|identity|preferences)$/.test(String(area || '')))
    throw new TypeError('Area snapshot User Vault tidak dikenal.');
  const directories = await userDirectories(normalized);
  const key = await userEncryptionKey(normalized);
  const folder = directories[area] || directories.index;
  const file = safeChild(folder, 'snapshot.vault');
  return withUserLock(directories.id, async () => {
    const encrypted = encryptObject({ version: VERSION, value }, key, `${directories.id}:snapshot:${area}`);
    await atomicWrite(file, `${canonical(encrypted)}\n`);
    return { saved: true, area, updatedAt: new Date().toISOString() };
  });
}

export async function loadUserVaultSnapshot(userId, area) {
  const normalized = normalizeUserId(userId);
  if (!/^(profile|memory|identity|preferences)$/.test(String(area || '')))
    throw new TypeError('Area snapshot User Vault tidak dikenal.');
  const directories = await userDirectories(normalized);
  const key = await userEncryptionKey(normalized);
  const file = safeChild(directories[area] || directories.index, 'snapshot.vault');
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    const value = decryptObject(parsed, key, `${directories.id}:snapshot:${area}`);
    if (value?.version !== VERSION) throw new Error('Snapshot version mismatch.');
    return value.value ?? null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function getRecentUserConversationTurns(userId, { limit = 20 } = {}) {
  const rows = await readUserVaultEvents(userId, {
    types: 'conversation.turn',
    limit: Math.max(1, Number(limit) || 20),
    reverse: true,
  });
  return rows
    .reverse()
    .map(event => ({
      role: event.payload?.role,
      content: String(event.payload?.content || ''),
      jobId: event.payload?.jobId || null,
      createdAt: event.payload?.originalCreatedAt || event.createdAt,
    }))
    .filter(turn => ['user', 'assistant'].includes(turn.role) && turn.content);
}

export async function getUserConversationTurnsForJobs(userId, jobIds = []) {
  const wanted = new Set((Array.isArray(jobIds) ? jobIds : [jobIds]).map(String));
  if (!wanted.size) return [];
  const rows = await readUserVaultEvents(userId, { types: 'conversation.turn' });
  return rows
    .filter(event => wanted.has(String(event.payload?.jobId || '')))
    .map(event => ({
      role: event.payload.role,
      content: String(event.payload.content || ''),
      jobId: event.payload.jobId,
      createdAt: event.payload?.originalCreatedAt || event.createdAt,
    }));
}

function words(text) {
  return [
    ...new Set(
      String(text || '')
        .toLocaleLowerCase('id-ID')
        .match(/[\p{L}]{3,}|[\p{N}]{1,}/gu) || [],
    ),
  ].filter(
    word =>
      !new Set([
        'yang',
        'dan',
        'atau',
        'dengan',
        'untuk',
        'dari',
        'pada',
        'ini',
        'itu',
        'aku',
        'saya',
        'kamu',
        'dia',
        'the',
        'and',
        'for',
        'with',
        'was',
        'are',
      ]).has(word),
  );
}

export async function searchUserConversation(userId, query, { limit = 8 } = {}) {
  const terms = indexTokens(query);
  if (!terms.length) return [];
  const normalized = normalizeUserId(userId);
  const directories = await userDirectories(normalized);
  const key = await userEncryptionKey(normalized);
  const { files } = await verifyJournalIntegrity(directories, key);
  const wanted = new Set(terms);
  const scored = [];
  for (const file of files) {
    const month = path.basename(file, '.jsonl');
    const journalStat = await fs.stat(file);
    let index = await readConversationIndex(directories, key, month);
    if (!index || index.journalSize !== journalStat.size || !Array.isArray(index.documents)) {
      index = await buildConversationIndex(file, directories, key, month);
      const envelope = encryptObject(index, key, `${directories.id}:conversation-index:${month}`);
      await atomicWrite(searchIndexFile(directories, month), `${canonical(envelope)}\n`);
    }
    for (const doc of index.documents) {
      const matches = doc.tokens.filter(token => wanted.has(token));
      if (!matches.length) continue;
      const coverage = new Set(matches).size / Math.max(1, wanted.size);
      const density = matches.length / Math.max(1, new Set(doc.tokens).size);
      const score = coverage * 5 + density * 2;
      if (score >= 1.5) scored.push({ score, doc, month });
    }
  }
  const selected = scored
    .sort((a, b) => b.score - a.score || String(b.doc.createdAt).localeCompare(String(a.doc.createdAt)))
    .slice(0, Math.max(1, Number(limit) || 8));
  const results = [];
  for (const item of selected) {
    const event = await readIndexedConversationRow(item.doc, directories, key, item.month);
    const content = String(event.payload?.content || '');
    const exactPhrase = content.toLocaleLowerCase('id-ID').includes(String(query).toLocaleLowerCase('id-ID').trim());
    results.push({
      score: item.score + (exactPhrase ? 2 : 0),
      role: event.payload?.role,
      content,
      jobId: event.payload?.jobId,
      createdAt: event.payload?.originalCreatedAt || event.createdAt,
    });
  }
  return results.sort((a, b) => b.score - a.score || String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getUserVaultStats(userId) {
  const normalized = normalizeUserId(userId);
  const directories = await userDirectories(normalized);
  const files = await listJournalFiles(directories.journal);
  let bytes = 0;
  let events = 0;
  let firstAt = null;
  let lastAt = null;
  const byType = {};
  const key = await userEncryptionKey(normalized);
  await verifyJournalIntegrity(directories, key);
  for (const file of files) {
    const stat = await fs.stat(file);
    bytes += stat.size;
    await readRowsFromFile(file, {
      onRow: async row => {
        const event = await decryptRow(row, directories, key);
        events++;
        byType[event.type] = (byType[event.type] || 0) + 1;
        firstAt ||= event.createdAt;
        lastAt = event.createdAt;
      },
    });
  }
  return { events, bytes, firstAt, lastAt, byType, encrypted: true, directoryId: directories.id };
}

export async function exportUserVaultTranscript(userId, outputPath) {
  const normalized = normalizeUserId(userId);
  const directories = await userDirectories(normalized);
  const key = await userEncryptionKey(normalized);
  const { files } = await verifyJournalIntegrity(directories, key);
  const output = path.resolve(String(outputPath || ''));
  if (!outputPath || !path.isAbsolute(output)) throw new TypeError('Path ekspor User Vault harus absolut.');
  const stream = createWriteStream(output, { flags: 'wx', mode: 0o600 });
  const waitForDrain = async () =>
    new Promise((resolve, reject) => {
      stream.once('drain', resolve);
      stream.once('error', reject);
    });
  try {
    const header = {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      scope: 'single-user-private-conversation',
      encryptedSource: true,
    };
    if (!stream.write(`${canonical({ type: 'export.meta', payload: header })}\n`)) await waitForDrain();
    for (const file of files) {
      await readRowsFromFile(file, {
        onRow: async row => {
          const event = await decryptRow(row, directories, key);
          if (event.type !== 'conversation.turn') return;
          const line = canonical({ seq: event.seq, createdAt: event.createdAt, type: event.type, ...event.payload });
          if (!stream.write(`${line}\n`)) await waitForDrain();
        },
      });
    }
    stream.end();
    await finished(stream);
    await fs.chmod(output, 0o600).catch(() => {});
    return { path: output, files: files.length };
  } catch (error) {
    stream.destroy();
    await fs.unlink(output).catch(() => {});
    throw error;
  }
}

export function clearUserVaultKeyCache() {
  keyCache.clear();
  verifiedJournalCache.clear();
}
