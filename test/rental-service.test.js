import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DEFAULT_PLANS } from '../src/rental/catalog.js';
import { quotaCostFor } from '../src/rental/service.js';

test('rental catalog exposes three affordable 30-day tiers with increasing shared quotas', () => {
  assert.deepEqual(Object.keys(DEFAULT_PLANS), ['mini', 'standard', 'pro']);
  assert.deepEqual(Object.values(DEFAULT_PLANS).map(plan => plan.price), [5000, 10000, 20000]);
  assert.deepEqual(Object.values(DEFAULT_PLANS).map(plan => plan.durationDays), [30, 30, 30]);
  assert.deepEqual(Object.values(DEFAULT_PLANS).map(plan => plan.maxMembers), [50, 200, 1000]);
  assert.ok(DEFAULT_PLANS.mini.dailyQuota < DEFAULT_PLANS.standard.dailyQuota);
  assert.ok(DEFAULT_PLANS.standard.dailyQuota < DEFAULT_PLANS.pro.dailyQuota);
});

test('quota weights distinguish routine, web, AI and execution commands', () => {
  assert.equal(quotaCostFor({ name: 'calc' }, 'calc'), 1);
  assert.equal(quotaCostFor({ name: 'weather', description: 'fetch weather from website' }, 'weather'), 5);
  assert.equal(quotaCostFor({ name: 'chat', description: 'AI response' }, 'chat'), 3);
  assert.equal(quotaCostFor({ name: 'run', description: 'execute Python code' }, 'run'), 12);
  assert.equal(quotaCostFor({ name: 'menu' }, 'menu'), 0);
});

test('rental order, manual payment verification, activation, quota rollover and idempotency', async () => {
  const root = path.resolve('src/rental/service.js');
  const serviceUrl = pathToFileURL(root).href;
  const metadataUrl = pathToFileURL(path.resolve('src/core/group-metadata.js')).href;
  const temp = path.join(os.tmpdir(), `ocha-rental-${process.pid}-${Date.now()}`);
  await fs.mkdir(temp, { recursive: true });
  const script = `
    import assert from 'node:assert/strict';
    const svc = await import(${JSON.stringify(serviceUrl)});
    const metadata = await import(${JSON.stringify(metadataUrl)});
    const groupJid = '120363123456789012@g.us';
    const buyer = '6281234567890@s.whatsapp.net';
    const now = 1760000000000;
    await metadata.upsertGroupMetadata({ id: groupJid, subject: 'Rental Test', size: 51, participants: Array.from({ length: 51 }, (_, i) => ({ id: '6281234567' + String(100 + i) + '@s.whatsapp.net' })) });
    await assert.rejects(() => svc.createRentalOrder({ groupJid, requestedBy: buyer, groupName: 'Rental Test', planId: 'mini', now }), /51 anggota/);
    await metadata.upsertGroupMetadata({ id: groupJid, subject: 'Rental Test', size: 50, participants: Array.from({ length: 50 }, (_, i) => ({ id: '6281234567' + String(100 + i) + '@s.whatsapp.net' })) });
    const context = await svc.setRentalContext(buyer, groupJid, 'Rental Test', now);
    assert.equal(context.groupJid, groupJid);
    assert.equal((await svc.getRentalContext(buyer, now + 60_000)).groupName, 'Rental Test');
    assert.equal(await svc.getRentalContext(buyer, now + 13 * 60 * 60_000), null, 'private group context expires after 12 hours');
    const created = await svc.createRentalOrder({ groupJid, requestedBy: buyer, groupName: 'Rental Test', planId: 'mini', now });
    assert.equal(created.order.maxMembers, 50);
    assert.equal(created.order.status, 'pending');
    const [same, concurrentSame] = await Promise.all([
      svc.createRentalOrder({ groupJid, requestedBy: '6281234567890@s.whatsapp.net', groupName: 'Rental Test', planId: 'mini', now: now + 1000 }),
      svc.createRentalOrder({ groupJid, requestedBy: '6281234567890@s.whatsapp.net', groupName: 'Rental Test', planId: 'mini', now: now + 1000 })
    ]);
    assert.equal(same.reused, true);
    assert.equal(concurrentSame.order.id, created.order.id);
    await assert.rejects(() => svc.createRentalOrder({ groupJid, requestedBy: '6281234567890@s.whatsapp.net', groupName: 'Rental Test', planId: 'pro', now: now + 1500 }), /masih memiliki invoice/);
    await svc.updatePlan('mini', { price: 9900, dailyQuota: 999 }, 'owner');
    await svc.setOrderPaymentMethod(created.order.id, 'qris', buyer, now + 2000);
    const reported = await svc.reportPayment(created.order.id, buyer, '', now + 3000);
    assert.equal(reported.order.status, 'payment_reported');
    const evidenceId = '12345678-1234-4234-8234-123456789abc';
    const evidence = await svc.attachPaymentEvidence(created.order.id, buyer, { id: evidenceId, relativePath: 'data/rental-evidence/' + created.order.id + '/' + evidenceId + '.jpg', mimetype: 'image/jpeg', size: 1024 }, 'Transfer selesai', now + 3500);
    assert.equal(evidence.order.paymentEvidence.length, 1);
    await assert.rejects(() => svc.attachPaymentEvidence(created.order.id, 'invalid@lid', { id: '12345678-1234-4234-8234-123456789def', relativePath: 'data/rental-evidence/' + created.order.id + '/12345678-1234-4234-8234-123456789def.jpg', mimetype: 'image/jpeg', size: 1024 }, '', now + 3600), /nomor WhatsApp pribadi/);
    const approved = await svc.approvePayment(created.order.id, 'owner', now + 4000);
    assert.equal(approved.tenant.status, 'active');
    assert.equal(approved.tenant.dailyQuota, 120, 'invoice keeps its snapshotted quota after package changes');
    assert.equal(approved.tenant.maxMembers, 50, 'invoice keeps its snapshotted member cap');
    assert.equal(approved.order.amount, 5000, 'invoice keeps its snapshotted amount after package changes');
    const approvedAgain = await svc.approvePayment(created.order.id, 'owner', now + 5000);
    assert.equal(approvedAgain.reused, true);
    const review = await svc.submitRentalReview({ groupJid, reviewerJid: buyer, rating: 5, comment: 'Bot stabil dan proses sewa mudah', now: now + 5200 });
    assert.equal(review.duplicate, false);
    assert.equal(review.review.verifiedPurchase, true);
    const duplicateReview = await svc.submitRentalReview({ groupJid, reviewerJid: buyer, rating: 1, comment: 'Percobaan rating kedua', now: now + 5300 });
    assert.equal(duplicateReview.duplicate, true, 'one reviewer can submit only one review per approved order');
    const support = await svc.createRentalSupportTicket({
      groupJid, requesterJid: buyer, requesterName: 'Pelanggan Uji',
      category: 'keluhan', message: 'Kuota grup belum terbarui setelah pembayaran.', now: now + 5400
    });
    assert.equal(support.duplicate, false);
    assert.match(support.ticket.id, /^SUP-/);
    assert.equal(support.ticket.status, 'open');
    const duplicateSupport = await svc.createRentalSupportTicket({
      groupJid, requesterJid: buyer, requesterName: 'Pelanggan Uji',
      category: 'keluhan', message: 'Kuota grup belum terbarui setelah pembayaran.', now: now + 5500
    });
    assert.equal(duplicateSupport.duplicate, true, 'duplicate feedback inside the dedupe window reuses the same ticket');
    await assert.rejects(() => svc.createRentalSupportTicket({
      groupJid, requesterJid: buyer, category: 'masukan', message: 'API key: rahasia jangan simpan', now: now + 5600
    }), /Jangan kirim password/);
    const supportQueue = await svc.listRentalSupportTickets({ status: 'open' });
    assert.equal(supportQueue.total, 1);
    const answered = await svc.updateRentalSupportTicket(support.ticket.id, { status: 'answered', response: 'Kuota telah disinkronkan.' }, 'owner', now + 5700);
    assert.equal(answered.status, 'answered');
    assert.equal(answered.response, 'Kuota telah disinkronkan.');
    const answeredQueue = await svc.listRentalSupportTickets({ status: 'answered' });
    assert.equal(answeredQueue.total, 1);
    const reviewSummary = await svc.getRentalReviewSummary();
    assert.equal(reviewSummary.total, 1);
    assert.equal(reviewSummary.average, 5);
    assert.equal(reviewSummary.distribution[5], 1);
    await assert.rejects(() => svc.submitRentalReview({ groupJid, reviewerJid: buyer, rating: 6, comment: '' }), /Rating harus/);
    await metadata.upsertGroupMetadata({ id: groupJid, subject: 'Rental Test', size: 51, participants: Array.from({ length: 51 }, (_, i) => ({ id: '6281234567' + String(100 + i) + '@s.whatsapp.net' })) });
    const overLimit = await svc.getTenantStatus(groupJid, now + 5500);
    assert.equal(overLimit.status, 'over-limit');
    assert.equal(overLimit.memberCount, 51);
    await metadata.upsertGroupMetadata({ id: groupJid, subject: 'Rental Test', size: 50, participants: Array.from({ length: 50 }, (_, i) => ({ id: '6281234567' + String(100 + i) + '@s.whatsapp.net' })) });
    const usage1 = await svc.consumeTenantQuota({ groupJid, command: 'calc', plugin: { name: 'calc' }, now: now + 6000 });
    assert.equal(usage1.allowed, true);
    assert.equal(usage1.used, 1);
    const status = await svc.getQuotaStatus(groupJid, now + 6000);
    assert.equal(status.remaining, 119);
    const resetAt = status.resetAt;
    await svc.maintainRentals(() => null, resetAt + 1);
    const resetStatus = await svc.getQuotaStatus(groupJid, resetAt + 1);
    assert.equal(resetStatus.used, 0, 'autonomous maintenance persists quota reset without a new command');
    const usage2 = await svc.consumeTenantQuota({ groupJid, command: 'calc', plugin: { name: 'calc' }, now: resetAt + 2 });
    assert.equal(usage2.allowed, true);
    assert.equal(usage2.used, 1);
    const tenantStatus = await svc.getTenantStatus(groupJid, now + 7000);
    assert.equal(tenantStatus.status, 'active');
    const atGrace = Date.parse(approved.tenant.expiresAt) + 60_000;
    await svc.maintainRentals(() => null, atGrace);
    assert.equal((await svc.getTenantStatus(groupJid, atGrace)).status, 'grace');
    const afterGrace = Date.parse(approved.tenant.graceUntil) + 1;
    await svc.maintainRentals(() => null, afterGrace);
    assert.equal((await svc.getTenantStatus(groupJid, afterGrace)).status, 'suspended');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: temp, encoding: 'utf8', timeout: 30_000 });
  await fs.rm(temp, { recursive: true, force: true });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
