import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

test('shared rental API supports tenant-scoped read, idempotent writes and write-owner checks', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-rental-api-'));
  process.chdir(temp);
  let server;
  try {
    const { initializeDatabase } = await import(pathToFileURL(path.resolve(original, 'src/core/database.js')));
    const { putRecord } = await import(pathToFileURL(path.resolve(original, 'src/core/repository.js')));
    const { createRentalAccessKey } = await import(pathToFileURL(path.resolve(original, 'src/rental/access-keys.js')));
    const { handleRentalApiRequest } = await import(pathToFileURL(path.resolve(original, 'src/rental/http-api.js')));
    await initializeDatabase();
    const owner = '628123456789@s.whatsapp.net';
    const group = '120363123456789@g.us';
    await putRecord('rental.tenant', group, {
      groupJid: group, groupName: 'Test Group', status: 'active', manuallySuspended: false,
      planId: 'standard', planName: 'Standard', maxMembers: 100, dailyQuota: 350,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      graceUntil: new Date(Date.now() + 172_800_000).toISOString(),
      billingContact: owner, activatedAt: new Date().toISOString()
    });
    const key = await createRentalAccessKey({ ownerJid: owner, groupJid: group, type: 'rental' });
    const other = await createRentalAccessKey({ ownerJid: '628987654321@s.whatsapp.net', groupJid: group, type: 'rental' });
    server = http.createServer((req, res) => {
      void handleRentalApiRequest(req, res, new URL(req.url, 'http://127.0.0.1')).then(handled => { if (!handled && !res.headersSent) { res.statusCode = 404; res.end(); } }).catch(error => { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })); });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = async (keyValue, route) => fetch(`${base}${route}`, { headers: { 'x-api-key': keyValue } });
    const overview = await get(key.secret, '/api/v1/rental/overview');
    assert.equal(overview.status, 200);
    assert.equal((await overview.json()).data.group.member_limit, 100);

    const body = JSON.stringify({ member_limit: 120 });
    const write = await fetch(`${base}/api/v1/rental/member-limit`, { method: 'PATCH', headers: { 'x-api-key': key.secret, 'Content-Type': 'application/json', 'Idempotency-Key': 'member-limit-test-01' }, body });
    assert.equal(write.status, 200);
    assert.equal((await write.json()).data.member_limit, 120);
    const replay = await fetch(`${base}/api/v1/rental/member-limit`, { method: 'PATCH', headers: { 'x-api-key': key.secret, 'Content-Type': 'application/json', 'Idempotency-Key': 'member-limit-test-01' }, body });
    assert.equal(replay.status, 200);
    const conflict = await fetch(`${base}/api/v1/rental/member-limit`, { method: 'PATCH', headers: { 'x-api-key': key.secret, 'Content-Type': 'application/json', 'Idempotency-Key': 'member-limit-test-01' }, body: JSON.stringify({ member_limit: 125 }) });
    assert.equal(conflict.status, 409);

    const unauthorized = await fetch(`${base}/api/v1/rental/member-limit`, { method: 'PATCH', headers: { 'x-api-key': other.secret, 'Content-Type': 'application/json', 'Idempotency-Key': 'member-limit-test-02' }, body: JSON.stringify({ member_limit: 130 }) });
    assert.equal(unauthorized.status, 403);
    const actions = await get(key.secret, '/api/v1/rental/membership/actions');
    assert.equal(actions.status, 200);
    const policyBefore = await get(key.secret, '/api/v1/rental/commands');
    assert.equal(policyBefore.status, 200);
    const policyBody = JSON.stringify({ mode: 'denylist', commands: ['download', 'sticker'] });
    const policyWrite = await fetch(`${base}/api/v1/rental/commands`, { method: 'PATCH', headers: { 'x-api-key': key.secret, 'Content-Type': 'application/json', 'Idempotency-Key': 'command-policy-test-01' }, body: policyBody });
    assert.equal(policyWrite.status, 200);
    assert.deepEqual((await policyWrite.json()).data.commands, ['download', 'sticker']);
    const policyInvalid = await fetch(`${base}/api/v1/rental/commands`, { method: 'PATCH', headers: { 'x-api-key': key.secret, 'Content-Type': 'application/json', 'Idempotency-Key': 'command-policy-test-02' }, body: JSON.stringify({ mode: 'allowlist', commands: ['profile'] }) });
    assert.equal(policyInvalid.status, 422);

    const memberActionBody = JSON.stringify({ action: 'promote', target_jid: '628111222333@s.whatsapp.net' });
    const memberAction = await fetch(`${base}/api/v1/rental/membership/actions`, { method: 'POST', headers: { 'x-api-key': key.secret, 'Content-Type': 'application/json', 'Idempotency-Key': 'member-action-test-01' }, body: memberActionBody });
    assert.equal(memberAction.status, 202);
    const memberActionData = (await memberAction.json()).data;
    assert.equal(memberActionData.status, 'pending');
    const memberActionReplay = await fetch(`${base}/api/v1/rental/membership/actions`, { method: 'POST', headers: { 'x-api-key': key.secret, 'Content-Type': 'application/json', 'Idempotency-Key': 'member-action-test-01' }, body: memberActionBody });
    assert.equal(memberActionReplay.status, 202);
    assert.equal((await memberActionReplay.json()).data.action_id, memberActionData.action_id);
    const memberActionHistory = await get(key.secret, '/api/v1/rental/membership/actions');
    assert.equal((await memberActionHistory.json()).data.length, 1);

  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
