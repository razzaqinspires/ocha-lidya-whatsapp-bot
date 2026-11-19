import fs from 'node:fs/promises';
import path from 'node:path';

const FILE = path.resolve('data/contact.jsonl');
const contacts = new Map();
let initialized = false;
let writeQueue = Promise.resolve();

function pnToNumber(value) {
  if (typeof value !== 'string' || !value.endsWith('@s.whatsapp.net')) return null;
  const user = value.slice(0, -'@s.whatsapp.net'.length).split(':')[0];
  return /^\d{8,15}$/.test(user) ? user : null;
}

export function getNumberFromPnJid(value) {
  return pnToNumber(value);
}

export async function initializeContacts() {
  if (initialized) return;
  await fs.mkdir(path.dirname(FILE), { recursive: true, mode: 0o700 });
  const initialHandle = await fs.open(FILE, 'a', 0o600);
  await initialHandle.close();
  let content = '';
  try { content = await fs.readFile(FILE, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const validLines = [];
  let needsRewrite = false;
  for (const [index, raw] of content.split(/\r?\n/).entries()) {
    if (!raw.trim()) continue;
    try {
      const parsed = JSON.parse(raw);
      const number = typeof parsed?.number === 'string' && /^\d{8,15}$/.test(parsed.number) ? parsed.number : null;
      if (!number) { needsRewrite = true; continue; }
      if (contacts.has(number)) { needsRewrite = true; continue; }
      const entry = { number, name: typeof parsed.name === 'string' ? parsed.name : '', gender: typeof parsed.gender === 'string' ? parsed.gender : '' };
      contacts.set(number, entry);
      validLines.push(JSON.stringify(entry));
    } catch {
      // Keep a quarantine copy before normalizing malformed legacy lines.
      needsRewrite = true;
    }
  }
  if (needsRewrite && content.trim()) {
    const quarantine = path.resolve('data/quarantine');
    await fs.mkdir(quarantine, { recursive: true, mode: 0o700 });
    const backup = path.join(quarantine, `contact.jsonl.${Date.now()}.pre-dedupe`);
    await fs.writeFile(backup, content, { mode: 0o600, flag: 'wx' });
    const temp = `${FILE}.${process.pid}.tmp`;
    await fs.writeFile(temp, validLines.length ? `${validLines.join('\n')}\n` : '', { mode: 0o600 });
    await fs.rename(temp, FILE);
  }
  initialized = true;
  return { count: contacts.size };
}

function enqueue(operation) {
  const next = writeQueue.then(operation);
  writeQueue = next.catch(() => {});
  return next;
}

/** Store only explicitly verified PN JIDs. LID digits are never converted into phone numbers. */
export async function addContactFromPnJid(jid) {
  if (!initialized) await initializeContacts();
  const number = pnToNumber(jid);
  if (!number || contacts.has(number)) return { added: false, number };
  return enqueue(async () => {
    if (contacts.has(number)) return { added: false, number };
    const entry = { number, name: '', gender: '' };
    const handle = await fs.open(FILE, 'a', 0o600);
    try { await handle.writeFile(`${JSON.stringify(entry)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    contacts.set(number, entry);
    return { added: true, number };
  });
}

export async function addContactsFromPnJids(jids = []) {
  if (!initialized) await initializeContacts();
  const numbers = [...new Set(jids.map(pnToNumber).filter(Boolean))];
  return enqueue(async () => {
    const additions = numbers.filter(number => !contacts.has(number));
    if (!additions.length) return [];
    const entries = additions.map(number => ({ number, name: '', gender: '' }));
    const handle = await fs.open(FILE, 'a', 0o600);
    try { await handle.writeFile(entries.map(entry => JSON.stringify(entry)).join('\n') + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    for (const entry of entries) contacts.set(entry.number, entry);
    return entries.map(entry => ({ added: true, number: entry.number }));
  });
}

export function getContactCount() { return contacts.size; }
export function hasContact(number) { return contacts.has(String(number)); }
export function listContacts({ limit = 1000 } = {}) {
  return [...contacts.values()].slice(-Math.max(0, limit)).map(entry => ({ ...entry }));
}
export function getContactFilePath() { return FILE; }
