import crypto from 'node:crypto';
import { getRecord, listRecords, putRecord } from '../core/repository.js';
import { getGroupInteractionState, setGroupInteractionMuted } from '../core/group-control.js';
import { getGroupMetadata } from '../core/group-metadata.js';
import { DEFAULT_PLANS, normalizePlanId } from './catalog.js';
import { logger } from '../core/logger.js';

const DAY_MS = 24 * 60 * 60_000;
const ORDER_TTL_MS = 12 * 60 * 60_000;
const locks = new Map();
const clone = value => structuredClone(value);
const nowIso = now => new Date(now).toISOString();
const validGroup = jid => typeof jid === 'string' && /^\d{5,30}(?:-\d{1,25})?@g\.us$/.test(jid);

async function withLock(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  const queued = previous.then(() => current);
  locks.set(key, queued);
  await previous;
  try { return await task(); }
  finally {
    release();
    if (locks.get(key) === queued) locks.delete(key);
  }
}
function makeId(prefix) { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function dayWindow(tenant, usage, now) {
  const activatedAt = Date.parse(tenant.activatedAt || nowIso(now));
  const storedReset = Number(usage?.resetAt) || activatedAt + DAY_MS;
  if (now < storedReset) return { used: Number(usage?.used) || 0, resetAt: storedReset, startedAt: Number(usage?.startedAt) || storedReset - DAY_MS, breakdown: usage?.breakdown || {} };
  const periods = Math.max(1, Math.floor((now - storedReset) / DAY_MS) + 1);
  return { used: 0, resetAt: storedReset + periods * DAY_MS, startedAt: storedReset + (periods - 1) * DAY_MS, breakdown: {} };
}

export async function getPlans() {
  const overrides = await getRecord('rental.settings', 'plans') || {};
  return Object.fromEntries(Object.entries(DEFAULT_PLANS).map(([id, plan]) => [id, { ...clone(plan), ...(overrides[id] || {}), id }]));
}
export async function updatePlan(planId, patch, actor = 'owner') {
  const id = normalizePlanId(planId);
  if (!id) throw new Error('Paket tidak dikenal. Gunakan mini, standard, atau pro.');
  const plans = await getPlans();
  const current = plans[id];
  const next = { ...current, ...patch, id };
  if (!Number.isInteger(next.price) || next.price < 1000 || next.price > 10_000_000) throw new Error('Harga harus Rp1.000 sampai Rp10.000.000.');
  if (!Number.isInteger(next.dailyQuota) || next.dailyQuota < 10 || next.dailyQuota > 100_000) throw new Error('Kuota harus 10 sampai 100.000 unit per 24 jam.');
  if (!Number.isInteger(next.durationDays) || next.durationDays < 1 || next.durationDays > 365) throw new Error('Durasi harus 1 sampai 365 hari.');
  if (!Number.isInteger(next.maxMembers) || next.maxMembers < 2 || next.maxMembers > 100_000) throw new Error('Batas anggota harus 2 sampai 100.000 anggota.');
  const overrides = await getRecord('rental.settings', 'plans') || {};
  overrides[id] = next;
  await putRecord('rental.settings', 'plans', overrides, { actor, reason: `update rental plan ${id}` });
  await putRecord('rental.audit', makeId('AUD'), { action: 'plan.updated', planId: id, actor, price: next.price, dailyQuota: next.dailyQuota, maxMembers: next.maxMembers, durationDays: next.durationDays, at: nowIso(Date.now()) }, { source: 'rental-service' });
  return next;
}

export async function getTenant(groupJid) {
  if (!validGroup(groupJid)) return null;
  return getRecord('rental.tenant', groupJid);
}
export async function listTenants() { return Object.values(await listRecords('rental.tenant')); }
export async function listOrders() { return Object.values(await listRecords('rental.order')); }
export async function getOrder(orderId) { return getRecord('rental.order', String(orderId || '').toUpperCase()); }

export async function setRentalContext(userJid, groupJid, groupName = '', now = Date.now()) {
  const user = String(userJid || '').replace(/:\d+(?=@)/, '');
  if (!/^\d{8,15}@s\.whatsapp\.net$/.test(user)) throw new Error('Nomor WhatsApp Anda belum dapat diverifikasi. Buka chat pribadi bot setelah sistem mengenali nomor Anda.');
  if (!validGroup(groupJid)) throw new Error('ID grup tidak valid.');
  const meta = getGroupMetadata(groupJid);
  const context = {
    userJid: user, groupJid, groupName: String(groupName || meta?.subject || groupJid).slice(0, 120),
    selectedAt: nowIso(now), expiresAt: nowIso(now + 12 * 60 * 60_000)
  };
  await putRecord('rental.context', user, context, { actor: user, reason: 'private rental checkout context selected from group' });
  return context;
}

export async function getRentalContext(userJid, now = Date.now()) {
  const user = String(userJid || '').replace(/:\d+(?=@)/, '');
  if (!/^\d{8,15}@s\.whatsapp\.net$/.test(user)) return null;
  const context = await getRecord('rental.context', user);
  if (!context || !validGroup(context.groupJid) || Date.parse(context.expiresAt) <= now) return null;
  return context;
}

export function quotaCostFor(plugin = {}, command = '') {
  const text = `${command} ${plugin.name || ''} ${plugin.description || ''} ${plugin.usage || ''}`.toLowerCase();
  if (/^(menu|ping|owner|about|groupinfo|sewa|rent|paket|bayar)$/.test(String(command).toLowerCase())) return 0;
  if (/\b(run|eval|master|python|golang|node|execute|deploy|build)\b/.test(text)) return 12;
  if (/\b(download|scrape|browser|website|search|news|berita|fetch|preview|project|repository)\b/.test(text)) return 5;
  if (/\b(ai|image|video|audio|sticker|media|translat|summar|generate|chat)\b/.test(text)) return 3;
  return Math.max(1, Math.min(4, Number(plugin.quotaWeight) || 1));
}

export async function createRentalOrder({ groupJid, requestedBy, groupName = '', planId, now = Date.now() }) {
  if (!validGroup(groupJid)) throw new Error('Order sewa harus dibuat dari dalam grup WhatsApp.');
  const normalizedPlan = normalizePlanId(planId);
  if (!normalizedPlan) throw new Error('Pilih paket mini, standard, atau pro.');
  return withLock(`tenant:${groupJid}`, async () => {
    const tenant = await getTenant(groupJid);
    if (tenant?.status === 'active' && Date.parse(tenant.expiresAt) > now) {
      // Active tenants may order a renewal; no duplicate pending order is created.
    }
    const plan = (await getPlans())[normalizedPlan];
    const meta = getGroupMetadata(groupJid);
    const memberCount = Number(meta?.size) || Number(meta?.participants?.length) || 0;
    if (memberCount > plan.maxMembers) {
      throw new Error(`Grup ini memiliki ${memberCount.toLocaleString('id-ID')} anggota, sedangkan paket ${plan.name} membatasi ${plan.maxMembers.toLocaleString('id-ID')} anggota. Pilih paket dengan kapasitas lebih besar.`);
    }
    const orders = await listOrders();
    const existing = orders.find(order => order.groupJid === groupJid && ['pending', 'payment_reported'].includes(order.status) && Date.parse(order.expiresAt) > now);
    if (existing) {
      if (existing.planId !== normalizedPlan) throw new Error(`Grup ini masih memiliki invoice ${existing.id} untuk paket ${existing.planName}. Batalkan invoice tersebut atau lanjutkan pembayarannya sebelum memilih paket lain.`);
      return { order: existing, reused: true };
    }
    const order = {
      id: makeId('RV'), groupJid, groupName: groupName || meta?.subject || groupJid,
      requestedBy, planId: normalizedPlan, planName: plan.name,
      amount: plan.price, durationDays: plan.durationDays, dailyQuota: plan.dailyQuota, maxMembers: plan.maxMembers, graceHours: plan.graceHours,
      status: 'pending', createdAt: nowIso(now), expiresAt: nowIso(now + ORDER_TTL_MS),
      paymentMethod: null, paymentReportedAt: null, paymentNote: '', approvedAt: null,
      approvedBy: null, rejectedAt: null, rejectionReason: '',
      schemaVersion: 1
    };
    await putRecord('rental.order', order.id, order, { actor: requestedBy, reason: 'rental order created' });
    await putRecord('rental.audit', makeId('AUD'), { action: 'order.created', orderId: order.id, groupJid, actor: requestedBy, at: order.createdAt }, { source: 'rental-service' });
    return { order, reused: false };
  });
}

export async function setOrderPaymentMethod(orderId, methodId, actor, now = Date.now()) {
  const method = String(methodId || '').toLowerCase();
  if (!['qris', 'ovo', 'gopay', 'dana', 'seabank'].includes(method)) throw new Error('Metode pembayaran tidak dikenal.');
  const initial = await getOrder(orderId);
  if (!initial) throw new Error('Order tidak ditemukan.');
  return withLock(`tenant:${initial.groupJid}`, async () => {
    const order = await getOrder(orderId);
    if (!order) throw new Error('Order tidak ditemukan.');
    if (order.status !== 'pending' || Date.parse(order.expiresAt) <= now) throw new Error('Order sudah tidak aktif. Buat order baru dengan .sewa.');
    const next = { ...order, paymentMethod: method, paymentSelectedAt: nowIso(now) };
    await putRecord('rental.order', order.id, next, { actor, reason: `payment method ${method} selected` });
    await putRecord('rental.audit', makeId('AUD'), { action: 'payment.method-selected', orderId: order.id, method, actor, at: nowIso(now) }, { source: 'rental-service' });
    return next;
  });
}

export async function reportPayment(orderId, actor, note = '', now = Date.now()) {
  const initial = await getOrder(orderId);
  if (!initial) throw new Error('Order tidak ditemukan.');
  return withLock(`tenant:${initial.groupJid}`, async () => {
    const order = await getOrder(orderId);
    if (!order) throw new Error('Order tidak ditemukan.');
    if (order.status === 'payment_reported') return { order, reused: true };
    if (order.status !== 'pending' || !order.paymentMethod) throw new Error('Pilih metode pembayaran terlebih dahulu.');
    if (Date.parse(order.expiresAt) <= now) throw new Error('Invoice sudah kedaluwarsa. Buat order baru.');
    const next = { ...order, status: 'payment_reported', paymentReportedAt: nowIso(now), paymentNote: String(note).slice(0, 240) };
    await putRecord('rental.order', order.id, next, { actor, reason: 'customer reported payment; awaiting manual verification' });
    await putRecord('rental.audit', makeId('AUD'), { action: 'payment.reported', orderId: order.id, actor, at: nowIso(now) }, { source: 'rental-service' });
    return { order: next, reused: false };
  });
}

export async function attachPaymentEvidence(orderId, actor, evidence, note = '', now = Date.now()) {
  const initial = await getOrder(orderId);
  if (!initial) throw new Error('Order tidak ditemukan.');
  return withLock(`tenant:${initial.groupJid}`, async () => {
    const order = await getOrder(orderId);
    if (!order) throw new Error('Order tidak ditemukan.');
    if (!order.paymentMethod) throw new Error('Pilih metode pembayaran terlebih dahulu dengan .sewa pay.');
    if (!['pending', 'payment_reported'].includes(order.status) || Date.parse(order.expiresAt) <= now) {
      throw new Error('Invoice sudah tidak aktif. Buat invoice baru melalui .sewa plan.');
    }
    const existing = Array.isArray(order.paymentEvidence) ? order.paymentEvidence : [];
    if (existing.length >= 3) throw new Error('Maksimal 3 file bukti pembayaran per invoice.');
    const allowedMime = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    const extension = typeof evidence?.relativePath === 'string' ? evidence.relativePath.split('.').at(-1).toLowerCase() : '';
    if (!evidence || typeof evidence.relativePath !== 'string' || !/^data\/rental-evidence\/[A-Z0-9-]+\/[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(evidence.relativePath)
      || !/^[a-f0-9-]{16,64}$/i.test(String(evidence.id || ''))
      || evidence.id !== evidence.relativePath.split('/').at(-1).split('.')[0]
      || allowedMime[extension] !== evidence.mimetype
      || !Number.isInteger(Number(evidence.size)) || Number(evidence.size) < 1 || Number(evidence.size) > 5 * 1024 * 1024) {
      throw new Error('Metadata file bukti pembayaran tidak valid atau melewati batas 5 MB.');
    }
    const normalizedActor = String(actor || '').replace(/:\d+(?=@)/, '');
    if (!/^\d{8,15}@s\.whatsapp\.net$/.test(normalizedActor)) throw new Error('Pengirim bukti harus terverifikasi melalui nomor WhatsApp pribadi.');
    const next = {
      ...order,
      status: 'payment_reported',
      paymentReportedAt: order.paymentReportedAt || nowIso(now),
      paymentNote: String(note || order.paymentNote || '').slice(0, 240),
      paymentEvidence: [...existing, { ...evidence, uploadedBy: actor, uploadedAt: nowIso(now) }]
    };
    await putRecord('rental.order', order.id, next, { actor, reason: 'payment evidence attached; manual settlement verification required' });
    await putRecord('rental.audit', makeId('AUD'), { action: 'payment.evidence-attached', orderId: order.id, actor, evidenceId: evidence.id, size: evidence.size, at: nowIso(now) }, { source: 'rental-service' });
    return { order: next, reused: order.status === 'payment_reported', evidence: next.paymentEvidence.at(-1) };
  });
}

export async function approvePayment(orderId, actor, now = Date.now()) {
  const initial = await getOrder(orderId);
  if (!initial) throw new Error('Order tidak ditemukan.');
  return withLock(`tenant:${initial.groupJid}`, async () => {
    const order = await getOrder(orderId);
    if (!order) throw new Error('Order tidak ditemukan.');
    if (order.status === 'approved') {
      const tenant = await getTenant(order.groupJid);
      if (!tenant) throw new Error(`Order ${order.id} tercatat disetujui, tetapi record tenant tidak ditemukan. Jalankan pemulihan data sebelum mengulang aktivasi.`);
      // Idempotent recovery: retry the activation side effect if a previous
      // approval was journaled but the group-mute update failed during handoff.
      if (tenant && tenant.status !== 'suspended') await setGroupInteractionMuted(order.groupJid, false, { actor, reason: `recover approved rental activation: ${order.id}` });
      return { order, tenant, reused: true };
    }
    if (order.status !== 'payment_reported') throw new Error('Order belum dilaporkan dibayar. Periksa daftar .rentals pending.');
    const plan = (await getPlans())[order.planId];
    // Terms are snapshotted on the invoice. Later package edits must not alter an issued bill.
    const durationDays = Number(order.durationDays) || plan.durationDays;
    const dailyQuota = Number(order.dailyQuota) || plan.dailyQuota;
    const maxMembers = Number(order.maxMembers) || plan.maxMembers || 50;
    const graceHours = Number(order.graceHours) || plan.graceHours;
    const previous = await getTenant(order.groupJid);
    const alreadyApplied = previous?.lastOrderId === order.id;
    const previousExpiry = Date.parse(previous?.expiresAt || '') || 0;
    const continuing = alreadyApplied || Boolean(previous && previousExpiry > now - 48 * 60 * 60_000);
    const startMs = alreadyApplied
      ? (Date.parse(previous.activatedAt) || now)
      : continuing ? Math.max(now, previousExpiry) : now;
    const expiresAt = alreadyApplied
      ? (Date.parse(previous.expiresAt) || (startMs + durationDays * DAY_MS))
      : startMs + durationDays * DAY_MS;
    const previousUsage = await getRecord('rental.usage', order.groupJid) || {};
    const previousWindow = previous && continuing ? dayWindow(previous, previousUsage, now) : null;
    const quotaResetAt = alreadyApplied
      ? (Number(previous.quotaWindowResetAt) || previousWindow?.resetAt || Number(previousUsage.resetAt) || (startMs + DAY_MS))
      : continuing ? (previousWindow?.resetAt || startMs + DAY_MS) : startMs + DAY_MS;
    const tenant = alreadyApplied ? previous : {
      groupJid: order.groupJid, groupName: order.groupName,
      status: 'active', manuallySuspended: false, planId: plan.id, planName: plan.name,
      dailyQuota, maxMembers, billingContact: order.requestedBy, activatedAt: continuing ? previous.activatedAt : nowIso(startMs), expiresAt: nowIso(expiresAt),
      graceUntil: nowIso(expiresAt + graceHours * 60 * 60_000),
      lastOrderId: order.id, activatedBy: actor,
      quotaWindowResetAt: quotaResetAt,
      reminderMarks: [],
      createdAt: previous?.createdAt || nowIso(now), updatedAt: nowIso(now),
      version: (Number(previous?.version) || 0) + 1
    };
    const approved = { ...order, status: 'approved', approvedAt: nowIso(now), approvedBy: actor, serviceStartsAt: tenant.activatedAt, serviceExpiresAt: tenant.expiresAt };
    // Persist the entitlement before acknowledging payment. If a later write fails,
    // the order stays payment_reported and can be safely retried by the owner.
    if (!alreadyApplied) await putRecord('rental.tenant', order.groupJid, tenant, { actor, reason: 'subscription activated after manual payment verification' });
    const currentUsage = await getRecord('rental.usage', order.groupJid) || {};
    if (!currentUsage.resetAt || Number(currentUsage.resetAt) !== quotaResetAt) {
      await putRecord('rental.usage', order.groupJid, {
        tenantId: order.groupJid, used: 0, startedAt: quotaResetAt - DAY_MS, resetAt: quotaResetAt, breakdown: {}, updatedAt: nowIso(now)
      }, { source: 'rental-quota', reason: 'subscription quota window initialized or recovered' });
    }
    await putRecord('rental.order', order.id, approved, { actor, reason: 'payment verified and order approved' });
    await putRecord('rental.audit', makeId('AUD'), { action: 'subscription.activated', groupJid: order.groupJid, orderId: order.id, planId: plan.id, actor, at: nowIso(now) }, { source: 'rental-service' });
    await setGroupInteractionMuted(order.groupJid, false, { actor, reason: `rental subscription activated: ${order.id}` });
    return { order: approved, tenant, reused: false };
  });
}

export async function rejectOrder(orderId, actor, reason = 'Pembayaran belum dapat diverifikasi.') {
  const initial = await getOrder(orderId);
  if (!initial) throw new Error('Order tidak ditemukan.');
  return withLock(`tenant:${initial.groupJid}`, async () => {
    const order = await getOrder(orderId);
    if (!order) throw new Error('Order tidak ditemukan.');
    if (['approved', 'cancelled'].includes(order.status)) throw new Error(`Order berstatus ${order.status} tidak dapat ditolak.`);
    const next = { ...order, status: 'rejected', rejectedAt: nowIso(Date.now()), rejectionReason: String(reason).slice(0, 240) };
    await putRecord('rental.order', order.id, next, { actor, reason: 'order rejected by owner' });
    await putRecord('rental.audit', makeId('AUD'), { action: 'order.rejected', orderId: order.id, actor, reason: next.rejectionReason, at: next.rejectedAt }, { source: 'rental-service' });
    return next;
  });
}

export async function cancelOrder(orderId, actor, now = Date.now()) {
  const initial = await getOrder(orderId);
  if (!initial) throw new Error('Order tidak ditemukan.');
  return withLock(`tenant:${initial.groupJid}`, async () => {
    const order = await getOrder(orderId);
    if (!order) throw new Error('Order tidak ditemukan.');
    if (!['pending', 'payment_reported'].includes(order.status)) throw new Error('Order ini tidak dapat dibatalkan.');
    const next = { ...order, status: 'cancelled', cancelledAt: nowIso(now), cancelledBy: actor };
    await putRecord('rental.order', order.id, next, { actor, reason: 'order cancelled' });
    await putRecord('rental.audit', makeId('AUD'), { action: 'order.cancelled', orderId: order.id, groupJid: order.groupJid, actor, at: next.cancelledAt }, { source: 'rental-service' });
    return next;
  });
}

export async function getTenantStatus(groupJid, now = Date.now()) {
  const tenant = await getTenant(groupJid);
  if (!tenant) return { tenant: null, status: 'not-rented', remainingMs: 0 };
  const expiry = Date.parse(tenant.expiresAt) || 0;
  const graceUntil = Date.parse(tenant.graceUntil) || expiry + 48 * 60 * 60_000;
  const lifecycleStatus = tenant.manuallySuspended ? 'suspended' : now < expiry ? 'active' : now < graceUntil ? 'grace' : 'suspended';
  const metadata = getGroupMetadata(groupJid);
  const memberCount = Number(metadata?.size) || Number(metadata?.participants?.length) || 0;
  const memberLimit = Number(tenant.maxMembers) || (await getPlans())[tenant.planId]?.maxMembers || 0;
  const overLimit = lifecycleStatus === 'active' && memberLimit > 0 && memberCount > memberLimit;
  const status = overLimit ? 'over-limit' : lifecycleStatus;
  return {
    tenant: { ...tenant, status, memberCount, maxMembers: memberLimit },
    status, lifecycleStatus, memberCount, memberLimit, overLimit,
    remainingMs: Math.max(0, expiry - now),
    graceRemainingMs: Math.max(0, graceUntil - now)
  };
}


export async function consumeTenantQuota({ groupJid, command, plugin = {}, now = Date.now() }) {
  if (!validGroup(groupJid)) return { applies: false, allowed: true, cost: 0 };
  return withLock(`tenant:${groupJid}`, async () => {
    const result = await getTenantStatus(groupJid, now);
    const tenant = result.tenant;
    if (!tenant) return { applies: false, allowed: true, cost: 0 };
    if (result.status !== 'active') return { applies: true, allowed: false, reason: result.status, cost: 0, tenant, remainingMs: result.remainingMs, graceRemainingMs: result.graceRemainingMs };
    const cost = quotaCostFor(plugin, command);
    if (cost === 0) return { applies: true, allowed: true, exempt: true, cost: 0, tenant };
    const key = groupJid;
    const oldUsage = await getRecord('rental.usage', key) || {};
    const window = dayWindow(tenant, oldUsage, now);
    const limit = Math.max(1, Number(tenant.dailyQuota) || (await getPlans())[tenant.planId]?.dailyQuota || 100);
    const remaining = Math.max(0, limit - window.used);
    if (window.used + cost > limit) {
      if (oldUsage.resetAt !== window.resetAt || oldUsage.used !== window.used) await putRecord('rental.usage', key, { ...oldUsage, ...window, updatedAt: nowIso(now) }, { source: 'rental-quota', reason: '24-hour quota rollover' });
      return { applies: true, allowed: false, reason: 'quota', cost, used: window.used, limit, remaining, resetAt: window.resetAt, remainingMs: Math.max(0, window.resetAt - now), tenant };
    }
    const next = { tenantId: groupJid, used: window.used + cost, resetAt: window.resetAt, startedAt: window.startedAt, breakdown: { ...window.breakdown, [command]: (window.breakdown?.[command] || 0) + cost }, updatedAt: nowIso(now) };
    await putRecord('rental.usage', key, next, { source: 'rental-quota', command, groupJid });
    return { applies: true, allowed: true, cost, used: next.used, limit, remaining: limit - next.used, resetAt: next.resetAt, tenant };
  });
}


function normalizeReviewComment(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email disamarkan]')
    .replace(/\b(?:\+?62|0)\d{8,13}\b/g, '[nomor disamarkan]')
    .replace(/https?:\/\/\S+/gi, '[tautan dihapus]')
    .replace(/\s+/g, ' ').trim().slice(0, 240);
}

export async function submitRentalReview({ groupJid, reviewerJid, rating, comment = '', now = Date.now() }) {
  if (!validGroup(groupJid)) throw new Error('Grup ulasan tidak valid.');
  const reviewer = String(reviewerJid || '').replace(/:\d+(?=@)/, '');
  if (!/^\d{8,15}@s\.whatsapp\.net$/.test(reviewer)) throw new Error('Ulasan hanya dapat dikirim dari nomor WhatsApp pribadi yang terverifikasi.');
  const score = Number(rating);
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error('Rating harus berupa angka bulat 1 sampai 5.');
  const tenant = await getTenant(groupJid);
  if (!tenant?.lastOrderId) throw new Error('Ulasan hanya dapat diberikan oleh pelanggan yang memiliki riwayat langganan terverifikasi.');
  const order = await getOrder(tenant.lastOrderId);
  if (!order || order.groupJid !== groupJid || order.status !== 'approved') throw new Error('Riwayat pembayaran grup ini belum terverifikasi. Ulasan belum dapat dikirim.');
  const reviewerHash = crypto.createHash('sha256').update(reviewer).digest('hex').slice(0, 24);
  const key = `${order.id}:${reviewerHash}`;
  const existing = await getRecord('rental.review', key);
  if (existing) return { review: existing, duplicate: true };
  const review = {
    id: makeId('REV'), groupJid, groupName: String(tenant.groupName || order.groupName || 'Grup pelanggan').slice(0, 120),
    orderId: order.id, planId: order.planId, planName: order.planName,
    reviewerHash, rating: score, comment: normalizeReviewComment(comment),
    createdAt: nowIso(now), verifiedPurchase: true
  };
  await putRecord('rental.review', key, review, { actor: reviewerHash, reason: 'verified rental customer review' });
  await putRecord('rental.audit', makeId('AUD'), { action: 'review.submitted', groupJid, orderId: order.id, rating: score, reviewerHash, at: review.createdAt }, { source: 'rental-service' });
  return { review, duplicate: false };
}

export async function getRentalReviewSummary(groupJid = '') {
  if (groupJid && !validGroup(groupJid)) throw new Error('Grup ulasan tidak valid.');
  const rows = Object.values(await listRecords('rental.review'))
    .filter(review => review?.verifiedPurchase === true && (!groupJid || review.groupJid === groupJid));
  const distribution = Object.fromEntries([1, 2, 3, 4, 5].map(score => [score, rows.filter(review => review.rating === score).length]));
  const total = rows.length;
  const average = total ? rows.reduce((sum, review) => sum + Number(review.rating || 0), 0) / total : 0;
  return {
    total, average: Number(average.toFixed(2)), distribution,
    reviews: rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 5)
      .map(({ rating, comment, planName, createdAt, groupName }) => ({ rating, comment, planName, createdAt, groupName }))
  };
}

function sanitizeSupportMessage(value) {
  const message = String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (message.length < 12) throw new Error('Masukan minimal 12 karakter agar tim dapat memahami kendalanya.');
  if (message.length > 2000) throw new Error('Masukan maksimal 2.000 karakter. Pecah menjadi beberapa poin bila lebih panjang.');
  if (/(?:password|kata\s+sandi|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|otp|cvv)\s*[:=]/i.test(message)) {
    throw new Error('Jangan kirim password, token, OTP, private key, atau data pembayaran rahasia melalui tiket dukungan.');
  }
  return message;
}

export async function createRentalSupportTicket({ groupJid, requesterJid, requesterName = '', category = 'masukan', message, now = Date.now() }) {
  if (!validGroup(groupJid)) throw new Error('Grup dukungan tidak valid. Pilih grup melalui .sewa di dalam grup tujuan.');
  const requester = String(requesterJid || '').replace(/:\d+(?=@)/, '');
  if (!/^\d{8,15}@s\.whatsapp\.net$/.test(requester)) throw new Error('Pengirim tiket harus berupa identitas WhatsApp pribadi yang terverifikasi.');
  const kind = String(category || 'masukan').toLowerCase();
  if (!['masukan', 'saran', 'keluhan', 'konsultasi', 'teknis'].includes(kind)) throw new Error('Kategori tiket tidak dikenal.');
  const body = sanitizeSupportMessage(message);
  const requesterHash = crypto.createHash('sha256').update(requester).digest('hex').slice(0, 24);
  const contentHash = crypto.createHash('sha256').update(body.toLocaleLowerCase('id-ID')).digest('hex');
  return withLock(`support:${groupJid}:${requesterHash}`, async () => {
    const previous = Object.values(await listRecords('rental.support'))
      .find(ticket => ticket.groupJid === groupJid && ticket.requesterHash === requesterHash
        && ticket.contentHash === contentHash && Number(now) - Date.parse(ticket.createdAt || '') >= 0
        && Number(now) - Date.parse(ticket.createdAt || '') < 10 * 60_000);
    if (previous) return { ticket: previous, duplicate: true };
    const tenant = await getTenant(groupJid);
    const metadata = getGroupMetadata(groupJid);
    const ticket = {
      id: makeId('SUP'), groupJid,
      groupName: String(tenant?.groupName || metadata?.subject || groupJid).replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120),
      requesterJid: requester, requesterHash,
      requesterName: String(requesterName || 'Pelanggan').replace(/[\r\n\u0000-\u001f]/g, ' ').trim().slice(0, 64),
      category: kind, message: body, contentHash,
      status: 'open', createdAt: nowIso(now), updatedAt: nowIso(now),
      response: '', handledBy: null, closedAt: null
    };
    await putRecord('rental.support', ticket.id, ticket, { actor: requesterHash, reason: `rental customer ${kind} ticket` });
    await putRecord('rental.audit', makeId('AUD'), { action: 'support.created', ticketId: ticket.id, groupJid, category: kind, requesterHash, at: ticket.createdAt }, { source: 'rental-service' });
    return { ticket, duplicate: false };
  });
}

export async function getRentalSupportTicket(ticketId) {
  return getRecord('rental.support', String(ticketId || '').toUpperCase());
}

export async function listRentalSupportTickets({ status = 'open', limit = 40 } = {}) {
  const wanted = String(status || 'open').toLowerCase();
  const rows = Object.values(await listRecords('rental.support'))
    .filter(ticket => wanted === 'all' || ticket.status === wanted)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { total: rows.length, tickets: rows.slice(0, Math.max(1, Math.min(100, Number(limit) || 40))) };
}

export async function updateRentalSupportTicket(ticketId, { status, response = '' } = {}, actor = 'owner', now = Date.now()) {
  const id = String(ticketId || '').toUpperCase();
  if (!/^SUP-[A-Z0-9-]{8,64}$/.test(id)) throw new Error('ID tiket dukungan tidak valid.');
  const nextStatus = String(status || '').toLowerCase();
  if (!['answered', 'closed'].includes(nextStatus)) throw new Error('Status tiket hanya boleh answered atau closed.');
  const note = String(response || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500);
  return withLock(`support-ticket:${id}`, async () => {
    const current = await getRentalSupportTicket(id);
    if (!current) throw new Error('Tiket dukungan tidak ditemukan.');
    const next = {
      ...current, status: nextStatus,
      response: note || current.response,
      handledBy: String(actor || 'owner').slice(0, 120),
      updatedAt: nowIso(now),
      ...(nextStatus === 'closed' ? { closedAt: nowIso(now) } : {})
    };
    await putRecord('rental.support', id, next, { actor, reason: `rental support ticket ${next.status}` });
    await putRecord('rental.audit', makeId('AUD'), { action: `support.${next.status}`, ticketId: id, groupJid: next.groupJid, actor, at: next.updatedAt }, { source: 'rental-service' });
    return next;
  });
}

export async function updateTenantMemberLimit(groupJid, memberLimit, actor = 'dashboard') {
  if (!validGroup(groupJid)) throw new Error('ID grup tidak valid.');
  const value = Number(memberLimit);
  if (!Number.isSafeInteger(value) || value < 2 || value > 100_000) throw new Error('Batas anggota harus bilangan bulat 2 sampai 100.000.');
  return withLock(`tenant:${groupJid}`, async () => {
    const tenant = await getTenant(groupJid);
    if (!tenant) throw new Error('Tenant sewa tidak ditemukan.');
    const status = await getTenantStatus(groupJid);
    if (status.status !== 'active') throw new Error('Pengubahan limit hanya tersedia saat sewa aktif.');
    const plans = await getPlans();
    const purchasedCeiling = Number(plans[tenant.planId]?.maxMembers || tenant.maxMembers || 0);
    if (value > purchasedCeiling) throw new Error(`Limit melebihi kapasitas paket ${tenant.planName || tenant.planId} (${purchasedCeiling.toLocaleString('id-ID')} anggota). Upgrade paket diperlukan untuk menaikkan batas di atas kapasitas tersebut.`);
    if (value < Number(status.memberCount || 0)) throw new Error(`Limit tidak boleh lebih rendah dari jumlah anggota saat ini (${status.memberCount}).`);
    const next = { ...tenant, maxMembers: value, updatedAt: nowIso(Date.now()), version: (Number(tenant.version) || 0) + 1 };
    await putRecord('rental.tenant', groupJid, next, { actor, reason: `tenant member limit changed to ${value}` });
    await putRecord('rental.audit', makeId('AUD'), { action: 'tenant.member-limit-updated', groupJid, actor, previousLimit: status.memberLimit, memberLimit: value, at: next.updatedAt }, { source: 'rental-dashboard-api' });
    return { ...next, memberCount: status.memberCount, maxMembers: value };
  });
}

export async function getQuotaStatus(groupJid, now = Date.now()) {
  const tenant = await getTenant(groupJid);
  if (!tenant) return null;
  const usage = await getRecord('rental.usage', groupJid) || {};
  const window = dayWindow(tenant, usage, now);
  const plan = (await getPlans())[tenant.planId];
  const limit = Number(tenant.dailyQuota || plan?.dailyQuota || 0);
  return { used: window.used, limit, remaining: Math.max(0, limit - window.used), resetAt: window.resetAt, remainingMs: Math.max(0, window.resetAt - now), breakdown: window.breakdown };
}

export async function maintainRentals(getSocket, now = Date.now()) {
  const tenantsSnapshot = await listTenants();
  const ordersSnapshot = await listOrders();
  const sock = typeof getSocket === 'function' ? getSocket() : null;

  // Invoice expiry is serialized with approval/report/cancel for the same group.
  for (const snapshot of ordersSnapshot) {
    try {
      await withLock(`tenant:${snapshot.groupJid}`, async () => {
        const order = await getOrder(snapshot.id);
        if (order && ['pending', 'payment_reported'].includes(order.status) && Date.parse(order.expiresAt) <= now) {
          await putRecord('rental.order', order.id, { ...order, status: 'expired', expiredAt: nowIso(now) }, { source: 'rental-scheduler', reason: 'invoice timeout' });
          await putRecord('rental.audit', makeId('AUD'), { action: 'order.expired', orderId: order.id, groupJid: order.groupJid, at: nowIso(now) }, { source: 'rental-scheduler' });
        }
      });
    } catch (error) { logger.error({ orderId: snapshot.id, message: error.message }, 'Rental invoice reconciliation failed; it will retry'); }
  }

  for (const snapshot of tenantsSnapshot) {
    try {
    const dueReminders = await withLock(`tenant:${snapshot.groupJid}`, async () => {
      const tenant = await getTenant(snapshot.groupJid);
      if (!tenant) return [];
      const expiry = Date.parse(tenant.expiresAt) || 0;
      const graceUntil = Date.parse(tenant.graceUntil) || expiry + 48 * 60 * 60_000;
      const oldStatus = tenant.status;
      const newStatus = tenant.manuallySuspended ? 'suspended' : now < expiry ? 'active' : now < graceUntil ? 'grace' : 'suspended';
      if (newStatus !== oldStatus) {
        const next = { ...tenant, status: newStatus, updatedAt: nowIso(now) };
        await putRecord('rental.tenant', tenant.groupJid, next, { source: 'rental-scheduler', reason: `subscription ${oldStatus} -> ${newStatus}` });
        await putRecord('rental.audit', makeId('AUD'), { action: `subscription.${newStatus}`, groupJid: tenant.groupJid, at: nowIso(now) }, { source: 'rental-scheduler' });
      }

      // Retry the mute side effect every cycle until it succeeds. Persisted suspension
      // must never leave a group accidentally unmuted after a transient config error.
      if (newStatus === 'suspended' && !getGroupInteractionState(tenant.groupJid).muted) {
        await setGroupInteractionMuted(tenant.groupJid, true, { actor: 'rental-scheduler', reason: tenant.manuallySuspended ? 'manual rental suspension recovery' : 'subscription grace period ended' });
      }

      // Persist a 24-hour quota rollover even if nobody sends another command.
      const usage = await getRecord('rental.usage', tenant.groupJid) || {};
      const window = dayWindow(tenant, usage, now);
      if (Number(usage.resetAt) !== window.resetAt || Number(usage.used || 0) !== window.used) {
        await putRecord('rental.usage', tenant.groupJid, {
          tenantId: tenant.groupJid, ...window, updatedAt: nowIso(now)
        }, { source: 'rental-quota', reason: 'autonomous 24-hour quota reset' });
      }

      if (!sock || tenant.manuallySuspended) return [];
      const marks = new Set(tenant.reminderMarks || []);
      const remaining = expiry - now;
      const stages = [
        { key: '72h', due: remaining <= 72 * 60 * 60_000 && remaining > 24 * 60 * 60_000, label: '3 hari sebelum berakhir' },
        { key: '24h', due: remaining <= 24 * 60 * 60_000 && remaining > 0, label: '24 jam sebelum berakhir' },
        { key: 'grace', due: now >= expiry && now < graceUntil, label: 'masa aktif berakhir; masa tenggang 48 jam dimulai' },
        { key: 'grace-end', due: now >= graceUntil, label: 'masa tenggang berakhir; layanan grup ditangguhkan' }
      ];
      return stages.filter(stage => stage.due && !marks.has(stage.key)).map(stage => ({ ...stage, groupJid: tenant.groupJid, groupName: tenant.groupName, billingContact: tenant.billingContact || '', expiresAt: tenant.expiresAt, planName: tenant.planName }));
    });

    for (const stage of dueReminders) {
      try {
        const graceEnd = stage.key === 'grace-end';
        const metadata = getGroupMetadata(stage.groupJid);
        const adminRecipients = (metadata?.participants || [])
          .filter(participant => ['admin', 'superadmin', true].includes(participant.admin))
          .map(participant => String(participant.phoneNumber || '').replace(/:\d+(?=@)/, ''))
          .filter(value => /^\d{8,15}@s\.whatsapp\.net$/.test(value));
        const billingContact = /^\d{8,15}@s\.whatsapp\.net$/.test(stage.billingContact) ? stage.billingContact : '';
        const adminTargets = [...new Set(adminRecipients)].filter(value => value !== billingContact).slice(0, 5);
        const reminder = `*OCHA LIDYA · INFORMASI SEWA*\nGrup: ${stage.groupName || stage.groupJid}\nPengingat: ${stage.label}.\nPaket: ${stage.planName}\nBerakhir: ${new Date(stage.expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n${graceEnd ? 'Masa tenggang telah berakhir; interaksi bot grup ditangguhkan.' : 'Perpanjang melalui .sewa di grup tujuan, lalu selesaikan transaksi di chat pribadi.'}`;
        let delivered = false;
        if (billingContact) {
          try { await sock.sendMessage(billingContact, { text: reminder }); delivered = true; }
          catch (deliveryError) { logger.warn({ recipient: billingContact, groupJid: stage.groupJid, message: deliveryError.message }, 'Private billing-contact reminder failed; trying group admins'); }
        }
        if (!delivered) {
          for (const recipient of adminTargets) {
            try { await sock.sendMessage(recipient, { text: reminder }); delivered = true; break; }
            catch (deliveryError) { logger.warn({ recipient, groupJid: stage.groupJid, message: deliveryError.message }, 'Private group-admin reminder delivery failed'); }
          }
        }
        if (!delivered) throw new Error('No billing contact or verified group admin could receive the private reminder.');
        await withLock(`tenant:${stage.groupJid}`, async () => {
          const latest = await getTenant(stage.groupJid);
          if (!latest || latest.expiresAt !== stage.expiresAt) return;
          const marks = new Set(latest.reminderMarks || []);
          marks.add(stage.key);
          await putRecord('rental.tenant', stage.groupJid, { ...latest, reminderMarks: [...marks], updatedAt: nowIso(now) }, { source: 'rental-scheduler', reason: `sent ${stage.key} reminder` });
        });
      } catch (error) {
        logger.warn({ groupJid: stage.groupJid, stage: stage.key, message: error.message }, 'Rental reminder delivery failed; it will be retried');
      }
    }
    } catch (error) {
      logger.error({ groupJid: snapshot.groupJid, message: error.message }, 'Rental tenant reconciliation failed; other groups will continue and this group will retry');
    }
  }
  return { tenants: tenantsSnapshot.length, orders: ordersSnapshot.length, checkedAt: nowIso(now) };
}

export async function suspendTenant(groupJid, actor, reason = 'suspended by owner') {
  if (!validGroup(groupJid)) throw new Error('Group JID tidak valid.');
  return withLock(`tenant:${groupJid}`, async () => {
    const tenant = await getTenant(groupJid);
    if (!tenant) throw new Error('Tenant tidak ditemukan.');
    const now = Date.now();
    const next = { ...tenant, status: 'suspended', manuallySuspended: true, suspendedAt: nowIso(now), suspendedBy: actor, suspendReason: reason, updatedAt: nowIso(now) };
    await putRecord('rental.tenant', groupJid, next, { actor, reason });
    await setGroupInteractionMuted(groupJid, true, { actor, reason: `rental suspension: ${reason}` });
    await putRecord('rental.audit', makeId('AUD'), { action: 'subscription.manually-suspended', groupJid, actor, reason, at: nowIso(now) }, { source: 'rental-service' });
    return next;
  });
}

export async function activateTenantManually(groupJid, actor, days = 30) {
  if (!validGroup(groupJid)) throw new Error('Group JID tidak valid.');
  return withLock(`tenant:${groupJid}`, async () => {
    const plan = (await getPlans()).standard;
    const now = Date.now();
    const duration = Math.max(1, Math.min(365, Number(days) || 30));
    const expiry = now + duration * DAY_MS;
    const previous = await getTenant(groupJid);
    const next = { groupJid, groupName: getGroupMetadata(groupJid)?.subject || groupJid, status: 'active', manuallySuspended: false, planId: 'standard', planName: plan.name, dailyQuota: plan.dailyQuota, maxMembers: plan.maxMembers, activatedAt: nowIso(now), expiresAt: nowIso(expiry), graceUntil: nowIso(expiry + 48 * 60 * 60_000), quotaWindowResetAt: now + DAY_MS, lastOrderId: null, activatedBy: actor, reminderMarks: [], createdAt: previous?.createdAt || nowIso(now), updatedAt: nowIso(now), version: (previous?.version || 0) + 1 };
    await putRecord('rental.tenant', groupJid, next, { actor, reason: 'manual activation by owner' });
    await putRecord('rental.usage', groupJid, { tenantId: groupJid, used: 0, startedAt: now, resetAt: now + DAY_MS, breakdown: {}, updatedAt: nowIso(now) }, { source: 'rental-quota', reason: 'manual activation quota initialized' });
    await setGroupInteractionMuted(groupJid, false, { actor, reason: 'rental manually activated by owner' });
    await putRecord('rental.audit', makeId('AUD'), { action: 'subscription.manually-activated', groupJid, actor, days: duration, at: nowIso(now) }, { source: 'rental-service' });
    return next;
  });
}

export async function extendTenant(groupJid, actor, days = 30, requestId = '') {
  if (!validGroup(groupJid)) throw new Error('Group JID tidak valid.');
  return withLock(`tenant:${groupJid}`, async () => {
    const current = await getTenant(groupJid);
    if (!current) throw new Error('Tenant tidak ditemukan.');
    if (requestId && current.lastExtensionRequestId === requestId) {
      await setGroupInteractionMuted(groupJid, false, { actor, reason: 'recover idempotent rental extension' });
      return current;
    }
    const now = Date.now();
    const extensionDays = Math.max(1, Math.min(365, Number(days) || 30));
    const oldExpiry = Date.parse(current.expiresAt) || now;
    const base = oldExpiry > now - 48 * 60 * 60_000 ? Math.max(now, oldExpiry) : now;
    const expiresAt = base + extensionDays * DAY_MS;
    const reactivatedAfterGrace = oldExpiry <= now - 48 * 60 * 60_000;
    const priorUsage = await getRecord('rental.usage', groupJid) || {};
    const activeWindow = reactivatedAfterGrace ? null : dayWindow(current, priorUsage, now);
    const quotaWindowResetAt = reactivatedAfterGrace ? now + DAY_MS : activeWindow.resetAt;
    const next = { ...current, status: 'active', manuallySuspended: false, activatedAt: current.activatedAt || nowIso(now), expiresAt: nowIso(expiresAt), graceUntil: nowIso(expiresAt + 48 * 60 * 60_000), quotaWindowResetAt, lastExtensionRequestId: requestId || current.lastExtensionRequestId || null, reminderMarks: [], updatedAt: nowIso(now), version: (Number(current.version) || 0) + 1 };
    await putRecord('rental.tenant', groupJid, next, { actor, reason: `owner extended subscription by ${extensionDays} days` });
    if (reactivatedAfterGrace || Number(priorUsage.resetAt) !== quotaWindowResetAt) {
      await putRecord('rental.usage', groupJid, { tenantId: groupJid, used: 0, startedAt: quotaWindowResetAt - DAY_MS, resetAt: quotaWindowResetAt, breakdown: {}, updatedAt: nowIso(now) }, { source: 'rental-quota', reason: 'subscription extension quota window reconciled' });
    }
    await setGroupInteractionMuted(groupJid, false, { actor, reason: 'subscription extended by owner' });
    await putRecord('rental.audit', makeId('AUD'), { action: 'subscription.extended', groupJid, actor, days: extensionDays, at: nowIso(now) }, { source: 'rental-service' });
    return next;
  });
}

export async function rentalSummary() {
  const [tenants, orders] = await Promise.all([listTenants(), listOrders()]);
  return {
    tenants: tenants.length,
    active: tenants.filter(item => item.status === 'active').length,
    grace: tenants.filter(item => item.status === 'grace').length,
    suspended: tenants.filter(item => item.status === 'suspended').length,
    pendingOrders: orders.filter(item => ['pending', 'payment_reported'].includes(item.status)).length,
    approvedOrders: orders.filter(item => item.status === 'approved').length,
    revenueApproved: orders.filter(item => item.status === 'approved').reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
  };
}
