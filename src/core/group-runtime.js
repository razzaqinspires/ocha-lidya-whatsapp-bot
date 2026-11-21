import { logger } from './logger.js';
import { getConfig } from './config.js';
import {
  applyGroupParticipantsUpdate,
  deleteGroupMetadata,
  getGroupMetadata,
  hasGroupMetadata,
  listGroupMetadata,
  isGroupBootstrapComplete,
  markGroupBootstrapComplete,
  upsertGroupMetadata,
  updateGroupMetadata
} from './group-metadata.js';
import { addContactsFromPnJids } from './contacts.js';
import { clearGroupMuteOverride } from './group-control.js';

const fetchInFlight = new Map();
const lastFetchAttempt = new Map();
let initialHydrationStarted = false;
let initialHydrationPromise = null;

function cleanJid(value) {
  return typeof value === 'string' ? value.replace(/:\d+(?=@)/, '') : '';
}
function participantPns(participants = []) {
  return participants.map(participant => {
    if (typeof participant === 'string') return participant.endsWith('@s.whatsapp.net') ? cleanJid(participant) : null;
    const explicit = [participant?.phoneNumber, participant?.phone_number, participant?.pn, participant?.participantPn, participant?.participantAlt, participant?.id];
    for (const value of explicit) {
      if (typeof value !== 'string') continue;
      const jid = cleanJid(value);
      if (jid.endsWith('@s.whatsapp.net')) return jid;
      // Digits are accepted only from explicitly PN-labelled Baileys fields;
      // never from the numeric portion of an @lid identifier.
      if ([participant?.phoneNumber, participant?.phone_number, participant?.pn, participant?.participantPn].includes(value) && /^\d{8,15}$/.test(jid)) {
        return `${jid}@s.whatsapp.net`;
      }
    }
    return null;
  }).filter(Boolean);
}
function botIdentitySet(sock) {
  const expected = getConfig().bot.expectedNumber;
  const ids = [sock.user?.id, sock.user?.jid, sock.user?.lid, sock.authState?.creds?.me?.id, sock.authState?.creds?.me?.lid];
  if (expected) ids.push(`${expected}@s.whatsapp.net`);
  return new Set(ids.filter(Boolean).map(cleanJid));
}

function explicitPn(participant) {
  const values = [participant?.phoneNumber, participant?.phone_number, participant?.pn, participant?.participantPn, participant?.participantAlt, participant?.id];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = cleanJid(value);
    if (normalized.endsWith('@s.whatsapp.net')) return normalized;
    if ([participant?.phoneNumber, participant?.phone_number, participant?.pn, participant?.participantPn].includes(value) && /^\d{8,15}$/.test(normalized)) {
      return `${normalized}@s.whatsapp.net`;
    }
  }
  return null;
}

async function verifiedPnForLid(sock, lid) {
  if (typeof lid !== 'string' || !lid.endsWith('@lid')) return null;
  const mapping = sock?.signalRepository?.lidMapping;
  if (typeof mapping?.getPNForLID !== 'function') return null;
  try {
    const result = cleanJid(await mapping.getPNForLID(lid));
    return result.endsWith('@s.whatsapp.net') ? result : null;
  } catch {
    return null;
  }
}

async function enrichParticipants(sock, participants = []) {
  const result = [];
  for (const raw of participants) {
    const participant = typeof raw === 'string' ? { id: raw, ...(raw.endsWith('@lid') ? { lid: raw } : {}) } : { ...(raw || {}) };
    let pn = explicitPn(participant);
    if (!pn) {
      const lid = participant.lid || (participant.id?.endsWith('@lid') ? participant.id : null);
      pn = await verifiedPnForLid(sock, lid);
    }
    if (pn) participant.phoneNumber = pn;
    result.push(participant);
  }
  return result;
}

async function enrichGroupMetadata(sock, metadata) {
  if (!metadata || typeof metadata !== 'object') return metadata;
  const enriched = { ...metadata };
  if (Array.isArray(metadata.participants)) enriched.participants = await enrichParticipants(sock, metadata.participants);
  if (!enriched.ownerPn && typeof metadata.owner === 'string' && metadata.owner.endsWith('@lid')) {
    const ownerPn = await verifiedPnForLid(sock, metadata.owner);
    if (ownerPn) enriched.ownerPn = ownerPn;
  }
  return enriched;
}
function isBotAmongParticipants(sock, participants = []) {
  const own = botIdentitySet(sock);
  for (const participant of participants) {
    if (typeof participant === 'string') {
      if (own.has(cleanJid(participant))) return true;
      continue;
    }
    for (const value of [participant?.id, participant?.phoneNumber, participant?.phone_number, participant?.pn, participant?.participantPn, participant?.participantAlt, participant?.lid]) {
      if (value && own.has(cleanJid(value))) return true;
    }
  }
  return false;
}

/** Fetch a single group only when it has never been cached. Cached groups never cause protocol queries. */
export async function ensureGroupMetadata(sock, groupId, { force = false } = {}) {
  if (!groupId?.endsWith('@g.us')) return null;
  const cached = getGroupMetadata(groupId);
  if (cached && !force) return cached;
  if (fetchInFlight.has(groupId)) return fetchInFlight.get(groupId);
  const cooldownMs = Number(getConfig().groupMetadata?.fetchCooldownMs || 10 * 60_000);
  const last = lastFetchAttempt.get(groupId) || 0;
  if (!force && Date.now() - last < cooldownMs) return cached;
  if (typeof sock.groupMetadata !== 'function') return cached;

  const request = (async () => {
    lastFetchAttempt.set(groupId, Date.now());
    try {
      const metadata = await sock.groupMetadata(groupId);
      return await upsertGroupMetadata(await enrichGroupMetadata(sock, metadata));
    } catch (error) {
      logger.warn({ groupId, err: error }, 'One-time group metadata fetch failed; cache retained');
      return getGroupMetadata(groupId);
    } finally {
      fetchInFlight.delete(groupId);
    }
  })();
  fetchInFlight.set(groupId, request);
  return request;
}

/** One batched participating-groups query on a fresh cache; not repeated on reconnect/restart once populated. */
export async function hydrateParticipatingGroupsOnce(sock) {
  if (!getConfig().groupMetadata?.initialSync || isGroupBootstrapComplete()) return;
  if (initialHydrationPromise) return initialHydrationPromise;
  if (initialHydrationStarted) return;
  initialHydrationStarted = true;
  if (typeof sock.groupFetchAllParticipating !== 'function') {
    initialHydrationStarted = false;
    return;
  }

  initialHydrationPromise = (async () => {
    try {
      // Baileys returns a jid-keyed object. Persist the returned value directly
      // instead of depending on undocumented side effects such as groups.update.
      const result = await sock.groupFetchAllParticipating();
      const entries = Array.isArray(result)
        ? result.map(group => [group?.id, group])
        : Object.entries(result || {});
      let saved = 0;
      for (const [jid, metadata] of entries) {
        if (!metadata || typeof metadata !== 'object') continue;
        const id = metadata.id || jid;
        if (!String(id || '').endsWith('@g.us')) continue;
        const enriched = await enrichGroupMetadata(sock, { ...metadata, id });
        const group = await upsertGroupMetadata(enriched);
        if (group) saved += 1;
      }
      await markGroupBootstrapComplete();
      logger.info({ fetched: entries.length, saved, groups: listGroupMetadata().length }, 'Initial group metadata batch hydration completed and checkpointed');
      return { saved, groups: listGroupMetadata().length };
    } catch (error) {
      initialHydrationStarted = false;
      logger.warn({ err: error }, 'Initial group metadata batch hydration failed; one-time lazy fetch remains enabled');
      throw error;
    } finally {
      initialHydrationPromise = null;
    }
  })();
  return initialHydrationPromise;
}

export async function handleGroupsUpsert(sock, payload) {
  const items = Array.isArray(payload) ? payload : [payload];
  for (const group of items) {
    if (group?.id?.endsWith('@g.us')) await upsertGroupMetadata(await enrichGroupMetadata(sock, group));
  }
}

export async function handleGroupsUpdate(sock, payload) {
  const items = Array.isArray(payload) ? payload : [payload];
  for (const update of items) {
    const id = update?.id;
    if (!id?.endsWith('@g.us')) continue;
    if (!hasGroupMetadata(id)) {
      await ensureGroupMetadata(sock, id);
      continue;
    }
    const enriched = await enrichGroupMetadata(sock, update);
    if (Array.isArray(enriched.participants)) {
      const current = getGroupMetadata(id);
      const merged = new Map((current?.participants || []).map(participant => [participant.id || participant.phoneNumber || participant.lid, participant]));
      for (const participant of enriched.participants) {
        const key = participant.id || participant.phoneNumber || participant.lid;
        if (key) merged.set(key, { ...(merged.get(key) || {}), ...participant });
      }
      await upsertGroupMetadata({ ...current, ...enriched, id, participants: [...merged.values()] });
      continue;
    }
    await updateGroupMetadata(id, enriched);
  }
}

export async function handleGroupParticipantsUpdate(sock, update) {
  const { id, participants = [], action } = update || {};
  if (!id?.endsWith('@g.us')) return;
  const normalizedAction = action === 'leave' ? 'remove' : action;

  const enrichedParticipants = await enrichParticipants(sock, participants);
  // Capture verified PN values before any membership deletion, including the
  // bot-leaves event. contact.jsonl is append-only and is never pruned here.
  await addContactsFromPnJids(participantPns(enrichedParticipants));
  if (normalizedAction === 'remove' && isBotAmongParticipants(sock, enrichedParticipants)) {
    const removed = await deleteGroupMetadata(id, 'bot-left-or-removed');
    await clearGroupMuteOverride(id, { reason: `bot left or was removed from ${id}` });
    if (removed) logger.info({ groupId: id }, 'Bot left/was removed; group metadata and per-group control state deleted');
    return;
  }

  if (!hasGroupMetadata(id)) await ensureGroupMetadata(sock, id);
  const group = await applyGroupParticipantsUpdate({ id, participants: enrichedParticipants, action: normalizedAction });
  if (group) logger.debug({ groupId: id, action: normalizedAction, size: group.participants.length }, 'Group participant cache updated');
}

export function getCachedGroupInfo(id) { return getGroupMetadata(id); }
export function getCachedGroups() { return listGroupMetadata(); }
