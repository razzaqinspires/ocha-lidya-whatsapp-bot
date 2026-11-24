import crypto from 'node:crypto';
import { getRecord, listRecords, putRecord } from '../core/repository.js';

const PREFIX = 'ocha_live_';
const SCOPES = Object.freeze({ rental: ['rental:read', 'rental:write'], profile: ['profile:read'] });
const normalizeJid = value => String(value || '').trim().replace(/:\d+(?=@)/, '').toLowerCase();
const hashKey = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const safeEqual = (a, b) => {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
};

export async function createRentalAccessKey({ ownerJid, groupJid, type }) {
  const owner = normalizeJid(ownerJid);
  if (!/^\d{8,15}@s\.whatsapp\.net$/.test(owner)) throw new Error('Identitas WhatsApp pemilik tidak valid.');
  if (!['rental', 'profile'].includes(type)) throw new Error('Jenis API key harus rental atau profile.');
  if (!/^\d{5,30}(?:-\d{1,25})?@g\.us$/.test(String(groupJid || ''))) throw new Error('Grup sewa belum dipilih. Ketik .sewa di grup tujuan.');
  const all = await listRecords('rental.access-key');
  const existing = Object.values(all).find(item => item.ownerJid === owner && item.type === type && item.status === 'active' && item.groupJid === groupJid);
  if (existing) throw new Error(`Anda sudah memiliki API key ${type === 'rental' ? 'informasi sewa' : 'profil'} yang aktif. Cabut dahulu dengan .sewaapi revoke ${existing.id} jika ingin menggantinya.`);
  const secret = `${PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  const id = `OAK-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  const record = {
    id, ownerJid: owner, groupJid,
    type, scope: SCOPES[type][0], scopes: [...SCOPES[type]], keyHash: hashKey(secret), prefix: secret.slice(0, 14),
    status: 'active', createdAt: new Date().toISOString(), revokedAt: null,
    requestCount: 0, lastUsedAt: null, schemaVersion: 1
  };
  await putRecord('rental.access-key', id, record, { actor: owner, reason: `issued ${type} dashboard API key` });
  await putRecord('rental.audit', `KEY-${id}`, { action: 'access-key.created', keyId: id, ownerJid: owner, groupJid: record.groupJid, scope: record.scope, scopes: record.scopes, at: record.createdAt }, { source: 'rental-access-key' });
  return { id, secret, scope: record.scope, scopes: [...record.scopes], type, createdAt: record.createdAt };
}

export async function revokeRentalAccessKey({ ownerJid, keyId }) {
  const id = String(keyId || '').trim().toUpperCase();
  const record = await getRecord('rental.access-key', id);
  if (!record || normalizeJid(record.ownerJid) !== normalizeJid(ownerJid)) throw new Error('API key tidak ditemukan pada akun Anda.');
  if (record.status === 'revoked') return record;
  const next = { ...record, status: 'revoked', revokedAt: new Date().toISOString() };
  await putRecord('rental.access-key', id, next, { actor: normalizeJid(ownerJid), reason: 'owner revoked dashboard API key' });
  await putRecord('rental.audit', `KEY-REVOKE-${id}-${Date.now()}`, { action: 'access-key.revoked', keyId: id, ownerJid: record.ownerJid, at: next.revokedAt }, { source: 'rental-access-key' });
  return next;
}

export async function listOwnerRentalAccessKeys(ownerJid) {
  const all = await listRecords('rental.access-key');
  return Object.values(all).filter(item => normalizeJid(item.ownerJid) === normalizeJid(ownerJid)).map(({ keyHash, ...safe }) => safe);
}

export async function authenticateRentalAccessKey(secret, requiredScope) {
  const value = String(secret || '').trim();
  if (!value.startsWith(PREFIX) || value.length < 40 || value.length > 100) return null;
  const candidateHash = hashKey(value);
  const all = await listRecords('rental.access-key');
  for (const record of Object.values(all)) {
    if (record.status !== 'active' || !(Array.isArray(record.scopes) ? record.scopes : [record.scope]).includes(requiredScope)) continue;
    if (!safeEqual(record.keyHash, candidateHash)) continue;
    const next = { ...record, requestCount: (Number(record.requestCount) || 0) + 1, lastUsedAt: new Date().toISOString() };
    await putRecord('rental.access-key', record.id, next, { source: 'rental-api', reason: 'authenticated API request' });
    return { ...next, keyHash: undefined };
  }
  return null;
}

export const RENTAL_API_SCOPES = SCOPES;
