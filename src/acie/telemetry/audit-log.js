import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensurePrivateDir } from '../core/fs-safe.js';

const REDACT_KEY = /(?:api.?key|token|secret|password|authorization|credential|private.?key)/i;
function redact(value, depth = 0) {
  if (depth > 6) return '[MaxDepth]';
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redact(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    result[key] = REDACT_KEY.test(key) ? '[REDACTED]' : redact(item, depth + 1);
  }
  return result;
}

export async function appendACIEAudit(event, details = {}, { root = process.cwd() } = {}) {
  const directory = path.join(root, 'contributions', 'audit');
  await ensurePrivateDir(directory);
  const file = path.join(directory, 'events.jsonl');
  const record = {
    id: crypto.randomUUID(), at: new Date().toISOString(), event: String(event).slice(0, 100),
    details: redact(details)
  };
  const handle = await fs.open(file, 'a', 0o600);
  try { await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  return record;
}

export async function readACIEAudit({ root = process.cwd(), limit = 50 } = {}) {
  const file = path.join(root, 'contributions', 'audit', 'events.jsonl');
  try {
    const raw = await fs.readFile(file, 'utf8');
    return raw.split('\n').filter(Boolean).slice(-Math.max(1, Math.min(500, limit))).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean).reverse();
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
