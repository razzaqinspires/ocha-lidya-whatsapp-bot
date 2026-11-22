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
  const temp = path.join(os.tmpdir(), `ocha-rental-${process.pid}-${Date.now()}`);
  await fs.mkdir(temp, { recursive: true });
  const script = `
    import assert from 'node:assert/strict';
    const svc = await import(${JSON.stringify(serviceUrl)});
    const groupJid = '120363123456789012@g.us';
    const now = 1760000000000;
    const created = await svc.createRentalOrder({ groupJid, requestedBy: '6281234567890@s.whatsapp.net', groupName: 'Rental Test', planId: 'mini', now });
    assert.equal(created.order.status, 'pending');
    const [same, concurrentSame] = await Promise.all([
      svc.createRentalOrder({ groupJid, requestedBy: '6281234567890@s.whatsapp.net', groupName: 'Rental Test', planId: 'mini', now: now + 1000 }),
      svc.createRentalOrder({ groupJid, requestedBy: '6281234567890@s.whatsapp.net', groupName: 'Rental Test', planId: 'mini', now: now + 1000 })
    ]);
    assert.equal(same.reused, true);
    assert.equal(concurrentSame.order.id, created.order.id);
    await assert.rejects(() => svc.createRentalOrder({ groupJid, requestedBy: '6281234567890@s.whatsapp.net', groupName: 'Rental Test', planId: 'pro', now: now + 1500 }), /masih memiliki invoice/);
    await svc.updatePlan('mini', { price: 9900, dailyQuota: 999 }, 'owner');
    await svc.setOrderPaymentMethod(created.order.id, 'qris', '6281234567890@s.whatsapp.net', now + 2000);
    const reported = await svc.reportPayment(created.order.id, '6281234567890@s.whatsapp.net', '', now + 3000);
    assert.equal(reported.order.status, 'payment_reported');
    const approved = await svc.approvePayment(created.order.id, 'owner', now + 4000);
    assert.equal(approved.tenant.status, 'active');
    assert.equal(approved.tenant.dailyQuota, 120, 'invoice keeps its snapshotted quota after package changes');
    assert.equal(approved.order.amount, 5000, 'invoice keeps its snapshotted amount after package changes');
    const approvedAgain = await svc.approvePayment(created.order.id, 'owner', now + 5000);
    assert.equal(approvedAgain.reused, true);
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
