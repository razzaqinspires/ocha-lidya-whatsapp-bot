import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';
import { addContactsFromPnJids } from './contacts.js';

const FILE = path.resolve('data/group-metadata.jsonl');
const groups = new Map();
let initialized = false;
let bootstrapComplete = false;
let writeQueue = Promise.resolve();

function cleanPn(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/:\d+(?=@)/, '');
  if (/^\d{8,15}$/.test(normalized)) return `${normalized}@s.whatsapp.net`;
  if (!normalized.endsWith('@s.whatsapp.net')) return null;
  const number = normalized.slice(0, -'@s.whatsapp.net'.length);
  return /^\d{8,15}$/.test(number) ? `${number}@s.whatsapp.net` : null;
}
function cleanLid(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/:\d+(?=@)/, '');
  return normalized.endsWith('@lid') ? normalized : null;
}
function participantValues(raw) {
  if (typeof raw === 'string') raw = { id: raw };
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.replace(/:\d+(?=@)/, '') : null;
  const phoneNumber = cleanPn(raw.phoneNumber || raw.phone_number || raw.pn || raw.participantPn || raw.participantAlt || (id?.endsWith('@s.whatsapp.net') ? id : null));
  const lid = cleanLid(raw.lid || (id?.endsWith('@lid') ? id : null));
  const stableId = id || lid || phoneNumber;
  if (!stableId) return null;
  return {
    id: stableId,
    ...(phoneNumber ? { phoneNumber } : {}),
    ...(lid ? { lid } : {}),
    username: typeof raw.username === 'string' ? raw.username : (typeof raw.participant_username === 'string' ? raw.participant_username : ''),
    admin: raw.admin === 'superadmin' || raw.admin === 'admin' ? raw.admin : (raw.admin || null)
  };
}
function groupSnapshot(meta = {}) {
  const id = typeof meta.id === 'string' ? meta.id : '';
  if (!id.endsWith('@g.us')) return null;
  const participants = (Array.isArray(meta.participants) ? meta.participants : []).map(participantValues).filter(Boolean);
  return {
    id,
    subject: String(meta.subject || meta.name || ''),
    creation: Number(meta.creation || 0),
    owner: String(meta.owner || ''),
    ownerPn: cleanPn(meta.ownerPn || meta.owner || '') || '',
    desc: String(meta.desc || ''),
    size: Number(meta.size || participants.length || 0),
    participants,
    announce: Boolean(meta.announce),
    restrict: Boolean(meta.restrict),
    isCommunity: Boolean(meta.isCommunity),
    isCommunityAnnounce: Boolean(meta.isCommunityAnnounce),
    joinApprovalMode: Boolean(meta.joinApprovalMode),
    memberAddMode: Boolean(meta.memberAddMode),
    addressingMode: String(meta.addressingMode || ''),
    lastSyncedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
function append(operation) {
  const next = writeQueue.then(operation);
  writeQueue = next.catch(() => {});
  return next;
}
async function appendEvent(event) {
  await append(async () => {
    const handle = await fs.open(FILE, 'a', 0o600);
    try { await handle.writeFile(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`); await handle.sync(); }
    finally { await handle.close(); }
  });
}

function indexParticipant(group, participant) {
  const keys = [participant.id, participant.phoneNumber, participant.lid].filter(Boolean);
  return group.participants.findIndex(existing => [existing.id, existing.phoneNumber, existing.lid].some(v => v && keys.includes(v)));
}
async function indexContacts(participants) {
  await addContactsFromPnJids(participants.map(participant => participant.phoneNumber).filter(Boolean));
}
function replay(event) {
  const p = event.payload || {};
  if (event.type === 'group.bootstrap.complete') { bootstrapComplete = true; return; }
  if (event.type === 'group.upsert' && p.group?.id) groups.set(p.group.id, p.group);
  else if (event.type === 'group.update' && p.id && groups.has(p.id)) groups.set(p.id, { ...groups.get(p.id), ...p.fields, updatedAt: event.ts });
  else if (event.type === 'group.participants' && p.id && groups.has(p.id)) {
    const group = groups.get(p.id);
    for (const participant of p.participants || []) {
      const index = indexParticipant(group, participant);
      if (p.action === 'remove' && index >= 0) group.participants.splice(index, 1);
      else if (p.action === 'add' && index < 0) group.participants.push(participant);
      else if (index >= 0 && ['modify', 'promote', 'demote'].includes(p.action)) group.participants[index] = { ...group.participants[index], ...participant };
    }
    group.size = group.participants.length;
    group.updatedAt = event.ts;
  } else if (event.type === 'group.delete' && p.id) groups.delete(p.id);
}

export async function initializeGroupMetadata() {
  if (initialized) return { count: groups.size };
  await fs.mkdir(path.dirname(FILE), { recursive: true, mode: 0o700 });
  const initialHandle = await fs.open(FILE, 'a', 0o600);
  await initialHandle.close();
  let raw = '';
  try { raw = await fs.readFile(FILE, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try { replay(JSON.parse(line)); }
    catch (error) { logger.warn({ line: index + 1, err: error }, 'Invalid group metadata JSONL event skipped'); }
  }
  initialized = true;
  // Group cache is a secondary source for the permanent contact index.
  // Replaying metadata never removes a contact and deduplication is handled by contact.jsonl.
  await addContactsFromPnJids([...groups.values()].flatMap(group => [group.ownerPn, ...(group.participants || []).map(participant => participant.phoneNumber)].filter(Boolean)));
  logger.info({ count: groups.size, file: FILE }, 'Group metadata cache restored');
  return { count: groups.size };
}

export async function upsertGroupMetadata(meta) {
  if (!initialized) await initializeGroupMetadata();
  const group = groupSnapshot(meta);
  if (!group) return null;
  const previous = groups.get(group.id);
  if (previous) {
    const merged = { ...previous, ...group };
    if (!Array.isArray(meta.participants)) merged.participants = previous.participants;
    group.participants = merged.participants;
  }
  await appendEvent({ type: 'group.upsert', payload: { group } });
  groups.set(group.id, group);
  await indexContacts(group.participants);
  if (group.ownerPn) await addContactsFromPnJids([group.ownerPn]);
  return structuredClone(group);
}

export async function updateGroupMetadata(id, fields = {}) {
  if (!initialized) await initializeGroupMetadata();
  if (!id?.endsWith('@g.us')) return null;
  const current = groups.get(id);
  if (!current) return null;
  const safe = {};
  for (const key of ['subject', 'desc', 'announce', 'restrict', 'size', 'owner', 'ownerPn', 'creation', 'joinApprovalMode', 'memberAddMode', 'isCommunity', 'isCommunityAnnounce']) {
    if (fields[key] !== undefined) safe[key] = fields[key];
  }
  if (!Object.keys(safe).length) return structuredClone(current);
  await appendEvent({ type: 'group.update', payload: { id, fields: safe } });
  const next = { ...current, ...safe, updatedAt: new Date().toISOString() };
  groups.set(id, next);
  if (safe.ownerPn) await addContactFromPnJids([safe.ownerPn]);
  return structuredClone(next);
}

export async function applyGroupParticipantsUpdate({ id, participants = [], action }) {
  if (!initialized) await initializeGroupMetadata();
  if (!id?.endsWith('@g.us')) return null;
  const current = groups.get(id);
  if (!current) return null;
  const normalized = participants.map(participantValues).filter(Boolean);
  if (!normalized.length || !['add', 'remove', 'modify', 'promote', 'demote'].includes(action)) return structuredClone(current);
  await appendEvent({ type: 'group.participants', payload: { id, action, participants: normalized } });
  const next = structuredClone(current);
  for (const participant of normalized) {
    const index = indexParticipant(next, participant);
    if (action === 'remove') {
      if (index >= 0) next.participants.splice(index, 1);
      continue;
    }
    if (index >= 0) next.participants[index] = { ...next.participants[index], ...participant };
    else next.participants.push(participant);
  }
  next.size = next.participants.length;
  next.updatedAt = new Date().toISOString();
  groups.set(id, next);
  if (action !== 'remove') await indexContacts(normalized);
  return structuredClone(next);
}

export async function deleteGroupMetadata(id, reason = 'bot-left-group') {
  if (!initialized) await initializeGroupMetadata();
  if (!groups.has(id)) return false;
  await appendEvent({ type: 'group.delete', payload: { id, reason } });
  groups.delete(id);
  return true;
}

export function isGroupBootstrapComplete() { return bootstrapComplete; }
export async function markGroupBootstrapComplete() {
  if (!initialized) await initializeGroupMetadata();
  if (bootstrapComplete) return false;
  await appendEvent({ type: 'group.bootstrap.complete', payload: {} });
  bootstrapComplete = true;
  return true;
}

export function getGroupMetadata(id) {
  const value = groups.get(id);
  return value ? structuredClone(value) : null;
}
export function listGroupMetadata() { return [...groups.values()].map(value => structuredClone(value)); }
export function hasGroupMetadata(id) { return groups.has(id); }
export function getGroupMetadataFilePath() { return FILE; }
