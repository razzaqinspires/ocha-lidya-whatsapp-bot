import fs from 'node:fs/promises';
import path from 'node:path';

const PN_SUFFIX = '@s.whatsapp.net';
const LID_SUFFIX = '@lid';
const OWNER_LID_MAP_FILE = path.resolve('data/owner-lid-map.jsonl');
const MAX_OWNER_LID_MAPPINGS = 32;
const ownerLidToPn = new Map();
let ownerLidMapLoadPromise;
let ownerLidMapWriteQueue = Promise.resolve();

function normalizeJid(value) {
  if (typeof value !== 'string' || !value) return '';
  return value.trim().replace(/:\d+(?=@)/, '');
}

function isPn(value) { return normalizeJid(value).endsWith(PN_SUFFIX); }
function isLid(value) { return normalizeJid(value).endsWith(LID_SUFFIX); }

function normalizePhone(value) {
  let digits = String(value || '').replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  return /^\d{8,15}$/.test(digits) ? digits : '';
}

function pnNumber(jid) {
  const normalized = normalizeJid(jid);
  if (!isPn(normalized)) return '';
  const value = normalized.slice(0, -PN_SUFFIX.length);
  return /^\d{8,15}$/.test(value) ? value : '';
}

function candidatesForKey(key = {}, isGroup = false) {
  const ordered = isGroup
    ? [key.senderPn, key.participantPn, key.participantAlt, key.participant]
    : [key.senderPn, key.remoteJidPn, key.remoteJidAlt, key.remoteJid];
  return [...new Set(ordered.map(normalizeJid).filter(Boolean))];
}

async function loadOwnerLidMappings() {
  if (ownerLidMapLoadPromise) return ownerLidMapLoadPromise;
  ownerLidMapLoadPromise = (async () => {
    try {
      const content = await fs.readFile(OWNER_LID_MAP_FILE, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          const lid = normalizeJid(record?.lid);
          const pn = normalizeJid(record?.pn);
          if (/^\d{5,20}@lid$/.test(lid) && pnNumber(pn)) ownerLidToPn.set(lid, pn);
        } catch {}
      }
      while (ownerLidToPn.size > MAX_OWNER_LID_MAPPINGS) ownerLidToPn.delete(ownerLidToPn.keys().next().value);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  })().catch(error => {
    ownerLidMapLoadPromise = null;
    throw error;
  });
  return ownerLidMapLoadPromise;
}

async function rememberVerifiedOwnerLids(lids, pn, ownerNumber) {
  const owner = normalizePhone(ownerNumber);
  if (!owner || pnNumber(pn) !== owner) return;
  const verifiedLids = [...new Set(lids.map(normalizeJid).filter(value => /^\d{5,20}@lid$/.test(value)))];
  if (!verifiedLids.length) return;
  await loadOwnerLidMappings();
  let changed = false;
  for (const lid of verifiedLids) {
    if (ownerLidToPn.get(lid) !== normalizeJid(pn)) {
      ownerLidToPn.delete(lid);
      ownerLidToPn.set(lid, normalizeJid(pn));
      changed = true;
    }
  }
  if (!changed) return;
  while (ownerLidToPn.size > MAX_OWNER_LID_MAPPINGS) ownerLidToPn.delete(ownerLidToPn.keys().next().value);
  const write = ownerLidMapWriteQueue.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(OWNER_LID_MAP_FILE), { recursive: true, mode: 0o700 });
    const body = [...ownerLidToPn.entries()].map(([lid, mappedPn]) => JSON.stringify({ lid, pn: mappedPn, updatedAt: new Date().toISOString() })).join('\n') + '\n';
    const temp = `${OWNER_LID_MAP_FILE}.${process.pid}.tmp`;
    await fs.writeFile(temp, body, { mode: 0o600 });
    await fs.chmod(temp, 0o600).catch(() => {});
    await fs.rename(temp, OWNER_LID_MAP_FILE);
    await fs.chmod(OWNER_LID_MAP_FILE, 0o600).catch(() => {});
  });
  ownerLidMapWriteQueue = write.catch(() => {});
  await write;
}

/**
 * Resolve a sender only from PN fields supplied by Baileys or a verified
 * Baileys LID mapping. Never infer a phone number from LID digits.
 * A minimal private mapping is persisted only for the configured owner so a
 * later message that omits alternate PN fields does not lose owner identity.
 */
export async function resolveMessageSenderPn(sock, key = {}, isGroup = false, { ownerNumber } = {}) {
  const candidates = candidatesForKey(key, isGroup);
  const lids = candidates.filter(isLid);
  const explicitPn = candidates.find(isPn);
  if (explicitPn) {
    if (ownerNumber) await rememberVerifiedOwnerLids(lids, explicitPn, ownerNumber).catch(() => {});
    return explicitPn;
  }

  if (ownerNumber) {
    await loadOwnerLidMappings().catch(() => {});
    const owner = normalizePhone(ownerNumber);
    for (const lid of lids) {
      const mapped = ownerLidToPn.get(lid);
      if (mapped && pnNumber(mapped) === owner) return mapped;
    }
  }

  const mappings = sock?.signalRepository?.lidMapping;
  const lookup = mappings?.getPNForLID;
  if (typeof lookup === 'function') {
    for (const lid of lids) {
      try {
        const mapped = normalizeJid(await lookup.call(mappings, lid));
        if (isPn(mapped)) {
          if (ownerNumber) await rememberVerifiedOwnerLids([lid], mapped, ownerNumber).catch(() => {});
          return mapped;
        }
      } catch {}
    }
  }
  return null;
}

export function extractVerifiedPnCandidates(key = {}, isGroup = false) {
  return candidatesForKey(key, isGroup).filter(isPn);
}

export function phoneNumberFromPnJid(jid) {
  return pnNumber(jid) || null;
}

export function normalizeVerifiedJid(jid) {
  const normalized = normalizeJid(jid);
  return isPn(normalized) ? normalized : null;
}
