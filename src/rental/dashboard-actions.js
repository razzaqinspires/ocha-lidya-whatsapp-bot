import crypto from 'node:crypto';
import { getRecord, listRecords, putRecord } from '../core/repository.js';
import { getTenantStatus } from './service.js';
import { getGroupMetadata } from '../core/group-metadata.js';
import { ensureGroupMetadata } from '../core/group-runtime.js';

const cleanJid = value => String(value || '').replace(/:\d+(?=@)/, '').toLowerCase();
const nowIso = () => new Date().toISOString();
const makeId = () => `MEM-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

export async function queueRentalMembershipAction({ groupJid, actorJid, targetJid, action, idempotencyKey }) {
  const group = String(groupJid || '');
  const actor = cleanJid(actorJid);
  const target = cleanJid(targetJid);
  const operation = String(action || '').toLowerCase();
  if (!['remove', 'promote', 'demote'].includes(operation)) throw new Error('Aksi anggota yang diizinkan: remove, promote, atau demote.');
  if (!/^\d{8,15}@s\.whatsapp\.net$/.test(target)) throw new Error('Nomor anggota harus berupa JID WhatsApp valid, misalnya 62812xxxx@s.whatsapp.net.');
  if (target === actor) throw new Error('Dashboard tidak dapat mengubah role atau mengeluarkan akun pemilik key sendiri.');
  const tenant = await getTenantStatus(group);
  if (!tenant.tenant || tenant.status !== 'active') throw new Error('Sewa grup tidak aktif. Aksi keanggotaan ditolak.');
  const all = Object.values(await listRecords('rental.membership-action'));
  const idem = String(idempotencyKey || '').trim();
  if (idem) {
    const existing = all.find(item => item.groupJid === group && cleanJid(item.actorJid) === actor && item.idempotencyKey === idem);
    if (existing) return existing;
  }
  const waiting = all.filter(item => item.groupJid === group && ['pending', 'processing'].includes(item.status));
  if (waiting.length >= 20) throw new Error('Antrean pengelolaan anggota grup penuh. Tunggu proses sebelumnya selesai.');
  const id = makeId();
  const record = { id, groupJid: group, actorJid: actor, targetJid: target, action: operation, idempotencyKey: String(idempotencyKey || '').slice(0, 100), status: 'pending', requestedAt: nowIso(), startedAt: null, completedAt: null, result: null, error: null, schemaVersion: 1 };
  await putRecord('rental.membership-action', id, record, { actor, reason: `dashboard membership ${operation} requested` });
  await putRecord('rental.audit', `MEM-${id}`, { action: 'membership.queued', actionId: id, groupJid: group, actor, targetJid: target, operation, at: record.requestedAt }, { source: 'rental-dashboard-api' });
  return record;
}

function botJids(sock) {
  const user = sock?.user || {};
  return [user.id, user.jid, user.lid].filter(Boolean).map(cleanJid);
}
function findParticipant(meta, jid) {
  const value = cleanJid(jid);
  return (meta?.participants || []).find(item => [item.id, item.phoneNumber, item.lid].filter(Boolean).some(candidate => cleanJid(candidate) === value));
}

export async function processRentalMembershipActions(getSocket, { limit = 8 } = {}) {
  const sock = typeof getSocket === 'function' ? getSocket() : getSocket;
  if (!sock?.groupParticipantsUpdate) return { processed: 0, skipped: 'socket_unavailable' };
  const all = Object.values(await listRecords('rental.membership-action'))
    .filter(item => item.status === 'pending' || (item.status === 'processing' && Date.now() - Date.parse(item.startedAt || '') > 5 * 60_000))
    .sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt)));
  const seenGroups = new Set();
  let processed = 0;
  for (const snapshot of all) {
    if (processed >= Math.max(1, Math.min(20, Number(limit) || 8))) break;
    if (seenGroups.has(snapshot.groupJid)) continue;
    seenGroups.add(snapshot.groupJid);
    const action = await getRecord('rental.membership-action', snapshot.id);
    if (!action || !['pending', 'processing'].includes(action.status)) continue;
    const startedAt = nowIso();
    const working = { ...action, status: 'processing', startedAt, error: null };
    await putRecord('rental.membership-action', action.id, working, { source: 'rental-dashboard-worker', reason: 'membership action processing started' });
    try {
      const tenant = await getTenantStatus(action.groupJid);
      if (!tenant.tenant || tenant.status !== 'active') throw new Error('Sewa grup tidak aktif saat aksi diproses.');
      const fresh = await ensureGroupMetadata(sock, action.groupJid, { force: true });
      const meta = fresh || getGroupMetadata(action.groupJid);
      if (!meta) throw new Error('Metadata grup tidak tersedia.');
      const bot = botJids(sock).map(jid => findParticipant(meta, jid)).find(Boolean);
      if (!bot || !['admin', 'superadmin', true].includes(bot.admin)) throw new Error('Bot bukan admin grup. Promosikan bot sebagai admin sebelum menggunakan panel anggota.');
      const participant = findParticipant(meta, action.targetJid);
      if (!participant) throw new Error('Anggota target tidak ditemukan di dalam grup.');
      if ([meta.owner, meta.ownerPn].filter(Boolean).some(value => cleanJid(value) === cleanJid(action.targetJid))) throw new Error('Akun pembuat grup tidak dapat diubah melalui dashboard.');
      if (action.action === 'remove' && cleanJid(action.targetJid) === cleanJid(sock.user?.id)) throw new Error('Bot tidak dapat mengeluarkan dirinya sendiri.');
      if (action.action === 'promote' && ['admin', 'superadmin', true].includes(participant.admin)) throw new Error('Target sudah menjadi admin.');
      if (action.action === 'demote' && !['admin', 'superadmin', true].includes(participant.admin)) throw new Error('Target bukan admin.');
      const result = await sock.groupParticipantsUpdate(action.groupJid, [participant.id], action.action);
      const next = { ...working, status: 'completed', completedAt: nowIso(), result: Array.isArray(result) ? result.map(item => ({ status: item.status, jid: item.jid || item.participant })) : null };
      await putRecord('rental.membership-action', action.id, next, { source: 'rental-dashboard-worker', reason: `membership ${action.action} sent to WhatsApp` });
      await putRecord('rental.audit', `MEM-DONE-${action.id}`, { action: `membership.${action.action}`, actionId: action.id, groupJid: action.groupJid, actor: action.actorJid, targetJid: action.targetJid, at: next.completedAt }, { source: 'rental-dashboard-worker' });
    } catch (error) {
      const next = { ...working, status: 'failed', completedAt: nowIso(), error: String(error.message || error).slice(0, 300) };
      await putRecord('rental.membership-action', action.id, next, { source: 'rental-dashboard-worker', reason: 'membership action failed closed' });
      await putRecord('rental.audit', `MEM-FAIL-${action.id}`, { action: 'membership.failed', actionId: action.id, groupJid: action.groupJid, actor: action.actorJid, targetJid: action.targetJid, error: next.error, at: next.completedAt }, { source: 'rental-dashboard-worker' });
    }
    processed += 1;
  }
  return { processed, pending: all.length };
}
