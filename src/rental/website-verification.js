import crypto from 'node:crypto';
import { getRecord, putRecord, listRecords } from '../core/repository.js';
const clean = value => String(value || '').replace(/:\d+(?=@)/, '').toLowerCase();
const valid = value => /^\d{8,15}@s\.whatsapp\.net$/.test(clean(value));
const locks = new Map();
async function withLock(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  let release; const current = new Promise(resolve => { release = resolve; });
  const queued = previous.then(() => current); locks.set(key, queued); await previous;
  try { return await task(); } finally { release(); if (locks.get(key) === queued) locks.delete(key); }
}
const id = () => `WEB-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
export async function getWebsiteVerification(userJid) { return getRecord('website.verification', clean(userJid)); }
export async function createWebsiteVerification(userJid) {
  const owner = clean(userJid);
  if (!valid(owner)) throw new Error('Nomor WhatsApp tidak dapat diverifikasi.');
  const entitlement = await getWebsiteVerification(owner);
  if (entitlement?.verified) throw new Error('Akun ini sudah memiliki centang biru dan satu slot website. Verifikasi bersifat satu kali.');
  const orders = Object.values(await listRecords('website.order'));
  const pending = orders.find(item => clean(item.ownerJid) === owner && ['pending', 'reported'].includes(item.status));
  if (pending) return pending;
  const order = { id: id(), ownerJid: owner, amount: 10000, status: 'pending', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(), evidence: null, schemaVersion: 1 };
  await putRecord('website.order', order.id, order, { actor: owner, reason: 'one-time website verification purchase requested' });
  return order;
}
export async function reportWebsitePayment(orderId, userJid, evidence = {}) {
  const order = await getRecord('website.order', String(orderId || '').toUpperCase());
  if (!order || clean(order.ownerJid) !== clean(userJid)) throw new Error('Invoice verifikasi tidak ditemukan pada akun ini.');
  if (order.status === 'reported') return order;
  if (order.status !== 'pending' || Date.parse(order.expiresAt) <= Date.now()) throw new Error('Invoice tidak aktif atau sudah kedaluwarsa.');
  const next = { ...order, status: 'reported', reportedAt: new Date().toISOString(), evidence: { note: String(evidence.note || '').slice(0, 300), file: evidence.file || null } };
  await putRecord('website.order', order.id, next, { actor: clean(userJid), reason: 'website verification payment reported' });
  return next;
}
export async function listWebsiteOrders() { return Object.values(await listRecords('website.order')); }
export async function reviewWebsiteOrder(orderId, actor, decision, reason = '') {
  const key = String(orderId || '').toUpperCase();
  const order = await getRecord('website.order', key);
  if (!order) throw new Error('Invoice verifikasi tidak ditemukan.');
  if (order.status === 'approved') return order;
  if (order.status !== 'reported') throw new Error('Invoice belum dilaporkan atau sudah diproses.');
  const now = new Date().toISOString();
  if (decision === 'approve') {
    const entitlement = { ownerJid: order.ownerJid, verified: true, badge: 'blue-check', websiteSlotsGranted: 1, websiteSlotsUsed: 0, verifiedAt: now, verificationOrderId: order.id, schemaVersion: 1 };
    await putRecord('website.verification', clean(order.ownerJid), entitlement, { actor, reason: 'manual website verification payment approved' });
    const next = { ...order, status: 'approved', approvedAt: now, approvedBy: actor };
    await putRecord('website.order', key, next, { actor, reason: 'website verification approved' });
    return next;
  }
  const next = { ...order, status: 'rejected', rejectedAt: now, rejectedBy: actor, rejectionReason: String(reason || 'Pembayaran belum dapat diverifikasi.').slice(0, 240) };
  await putRecord('website.order', key, next, { actor, reason: 'website verification rejected' });
  return next;
}
export async function claimWebsiteSlot(userJid, projectId) {
  const owner = clean(userJid);
  return withLock(`website-slot:${owner}`, async () => {
    const entitlement = await getWebsiteVerification(owner);
    if (!entitlement?.verified) throw new Error('Pembuatan website memerlukan verifikasi centang biru.');
    if (Number(entitlement.websiteSlotsUsed) >= Number(entitlement.websiteSlotsGranted)) throw new Error('Slot website satu kali sudah digunakan.');
    const next = { ...entitlement, websiteSlotsUsed: Number(entitlement.websiteSlotsUsed || 0) + 1, websiteProjectId: String(projectId || '').slice(0, 100), websiteCreatedAt: new Date().toISOString() };
    await putRecord('website.verification', owner, next, { actor: owner, reason: 'one-time website slot claimed' });
    return next;
  });
}
