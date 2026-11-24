import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { authenticateRentalAccessKey } from './access-keys.js';
import { getTenantStatus, getQuotaStatus, updateTenantMemberLimit } from './service.js';
import { getUserProfile } from '../ai/user-profiles.js';
import { getGroupMetadata } from '../core/group-metadata.js';
import { getRecord, listRecords, putRecord } from '../core/repository.js';
import { getTenantCommandPolicy, updateTenantCommandPolicy } from './command-access.js';
import { queueRentalMembershipAction } from './dashboard-actions.js';
import { logger } from '../core/logger.js';

let server = null;
let tunnel = null;
let tunnelUrl = null;
const WINDOW_MS = 60_000;
const rate = new Map();
const idempotencyLocks = new Map();
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const normalizeJid = value => String(value || '').replace(/:\d+(?=@)/, '').toLowerCase();
function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'pragma': 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin' });
  res.end(body);
}
async function readJson(req, maxBytes = 16 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request body terlalu besar.');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  const body = JSON.parse(raw);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON body harus berupa object.');
  return body;
}
function allowedRate(keyId) {
  const now = Date.now();
  const state = rate.get(keyId) || { start: now, count: 0 };
  if (now - state.start >= WINDOW_MS) { state.start = now; state.count = 0; }
  state.count++;
  rate.set(keyId, state);
  if (rate.size > 5000) for (const [key, value] of rate) if (now - value.start > WINDOW_MS * 2) rate.delete(key);
  return state.count <= 60;
}
async function withIdempotency(key, req, body, task, res) {
  const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(idempotencyKey)) return send(res, 428, { error: 'idempotency_key_required', message: 'Kirim header Idempotency-Key unik (8-100 karakter) untuk setiap aksi perubahan.' });
  const storageKey = hash(`${key.id}:${idempotencyKey}`);
  const requestHash = hash(JSON.stringify({ method: req.method, path: new URL(req.url || '/', 'http://127.0.0.1').pathname, body }));
  const previous = await getRecord('rental.idempotency', storageKey);
  if (previous) {
    if (previous.requestHash !== requestHash) return send(res, 409, { error: 'idempotency_conflict', message: 'Idempotency-Key yang sama sudah digunakan untuk payload berbeda.' });
    return send(res, previous.status, previous.response);
  }
  const before = idempotencyLocks.get(storageKey) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  const queued = before.then(() => current);
  idempotencyLocks.set(storageKey, queued);
  await before;
  try {
    const again = await getRecord('rental.idempotency', storageKey);
    if (again) {
      if (again.requestHash !== requestHash) return send(res, 409, { error: 'idempotency_conflict' });
      return send(res, again.status, again.response);
    }
    let result;
    try { result = await task(); }
    catch (error) {
      if (error?.statusCode) return send(res, error.statusCode, { error: error.code || 'request_rejected', message: error.publicMessage || 'Permintaan ditolak oleh kebijakan dashboard.' });
      return send(res, 500, { error: 'mutation_failed', message: 'Mutasi gagal diproses. Periksa log server sebelum mengulangi permintaan.' });
    }
    const entry = { requestHash, status: result.status || 200, response: result.response, createdAt: new Date().toISOString(), keyId: key.id };
    await putRecord('rental.idempotency', storageKey, entry, { actor: key.ownerJid, reason: 'dashboard mutation idempotency receipt' });
    return send(res, entry.status, entry.response);
  } finally {
    release();
    if (idempotencyLocks.get(storageKey) === queued) idempotencyLocks.delete(storageKey);
  }
}

async function validatedMutation(task) {
  try { return await task(); }
  catch (error) {
    const rejected = new Error(String(error?.message || 'Permintaan tidak valid.'));
    rejected.statusCode = 422;
    rejected.code = 'validation_error';
    rejected.publicMessage = rejected.message;
    throw rejected;
  }
}

async function handle(req, res, pathnameOverride = null) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (pathnameOverride) url.pathname = pathnameOverride;
  const pathname = url.pathname;
  if (req.method === 'GET' && pathname === '/health') return send(res, 200, { service: 'ocha-rental-api', status: 'ok', timestamp: new Date().toISOString() });
  if (pathname === '/v1/rental/overview') {
    if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
    const key = await authenticateRentalAccessKey(req.headers['x-api-key'] || '', 'rental:read');
    if (!key) return send(res, 401, { error: 'invalid_api_key' });
    if (!allowedRate(key.id)) return send(res, 429, { error: 'rate_limit_exceeded', retry_after_seconds: 60 });
    const status = await getTenantStatus(key.groupJid);
    if (!status.tenant) return send(res, 404, { error: 'rental_not_found' });
    const quota = await getQuotaStatus(key.groupJid);
    const meta = getGroupMetadata(key.groupJid);
    return send(res, 200, { data: { group: { name: status.tenant.groupName, jid: key.groupJid, member_count: status.memberCount, member_limit: status.memberLimit }, subscription: { plan: status.tenant.planName, status: status.status, activated_at: status.tenant.activatedAt, expires_at: status.tenant.expiresAt, grace_until: status.tenant.graceUntil }, quota: quota ? { used: quota.used, limit: quota.limit, remaining: quota.remaining, reset_at: quota.resetAt } : null, metadata_updated_at: meta?.lastSyncedAt || null }, meta: { key_id: key.id, scopes: key.scopes || [key.scope], generated_at: new Date().toISOString() } });
  }
  if (pathname === '/v1/profile') {
    if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
    const key = await authenticateRentalAccessKey(req.headers['x-api-key'] || '', 'profile:read');
    if (!key) return send(res, 401, { error: 'invalid_api_key' });
    if (!allowedRate(key.id)) return send(res, 429, { error: 'rate_limit_exceeded', retry_after_seconds: 60 });
    const tenant = await getTenantStatus(key.groupJid);
    if (!tenant.tenant || tenant.status !== 'active') return send(res, 403, { error: 'rental_entitlement_inactive' });
    const profile = await getUserProfile(key.ownerJid);
    return send(res, 200, { data: profile, meta: { key_id: key.id, scope: key.scope, generated_at: new Date().toISOString() } });
  }
  if (pathname === '/v1/rental/membership/actions' && req.method === 'GET') {
    const key = await authenticateRentalAccessKey(req.headers['x-api-key'] || '', 'rental:read');
    if (!key) return send(res, 401, { error: 'invalid_api_key' });
    if (!allowedRate(key.id)) return send(res, 429, { error: 'rate_limit_exceeded', retry_after_seconds: 60 });
    const actions = Object.values(await listRecords('rental.membership-action'))
      .filter(item => item.groupJid === key.groupJid)
      .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt))).slice(0, 30)
      .map(({ id, action, targetJid, status, requestedAt, completedAt, error }) => ({ action_id: id, action, target_jid: targetJid, status, requested_at: requestedAt, completed_at: completedAt, error }));
    return send(res, 200, { data: actions, meta: { key_id: key.id, generated_at: new Date().toISOString() } });
  }
  if (pathname === '/v1/rental/commands' && req.method === 'GET') {
    const key = await authenticateRentalAccessKey(req.headers['x-api-key'] || '', 'rental:read');
    if (!key) return send(res, 401, { error: 'invalid_api_key' });
    if (!allowedRate(key.id)) return send(res, 429, { error: 'rate_limit_exceeded', retry_after_seconds: 60 });
    const policy = await getTenantCommandPolicy(key.groupJid);
    return send(res, 200, { data: { mode: policy.mode, commands: policy.commands, updated_at: policy.updatedAt }, meta: { key_id: key.id } });
  }
  if (pathname === '/v1/rental/commands' && req.method === 'PATCH') {
    const key = await authenticateRentalAccessKey(req.headers['x-api-key'] || '', 'rental:write');
    if (!key) return send(res, 401, { error: 'invalid_api_key_or_scope' });
    if (!allowedRate(key.id)) return send(res, 429, { error: 'rate_limit_exceeded', retry_after_seconds: 60 });
    let body;
    try { body = await readJson(req); } catch (error) { return send(res, 400, { error: 'invalid_json', message: error.message }); }
    const tenant = await getTenantStatus(key.groupJid);
    if (!tenant.tenant || tenant.status !== 'active' || normalizeJid(tenant.tenant.billingContact) !== normalizeJid(key.ownerJid)) return send(res, 403, { error: 'rental_owner_required', message: 'Aksi dashboard hanya tersedia untuk kontak pemesan/pembayar sewa.' });
    return withIdempotency(key, req, body, async () => {
      const policy = await validatedMutation(() => updateTenantCommandPolicy(key.groupJid, { mode: body.mode, commands: body.commands }, key.ownerJid));
      return { status: 200, response: { data: { mode: policy.mode, commands: policy.commands, updated_at: policy.updatedAt }, meta: { key_id: key.id } } };
    }, res);
  }

  if (pathname === '/v1/rental/member-limit' || pathname === '/v1/rental/membership/actions') {
    if (!['PATCH', 'POST'].includes(req.method) || (pathname.endsWith('/member-limit') && req.method !== 'PATCH') || (pathname.endsWith('/actions') && req.method !== 'POST')) return send(res, 405, { error: 'method_not_allowed' });
    const key = await authenticateRentalAccessKey(req.headers['x-api-key'] || '', 'rental:write');
    if (!key) return send(res, 401, { error: 'invalid_api_key_or_scope' });
    if (!allowedRate(key.id)) return send(res, 429, { error: 'rate_limit_exceeded', retry_after_seconds: 60 });
    let body;
    try { body = await readJson(req); } catch (error) { return send(res, 400, { error: 'invalid_json', message: error.message }); }
    const tenant = await getTenantStatus(key.groupJid);
    if (!tenant.tenant || tenant.status !== 'active' || normalizeJid(tenant.tenant.billingContact) !== normalizeJid(key.ownerJid)) return send(res, 403, { error: 'rental_owner_required', message: 'Aksi dashboard hanya tersedia untuk kontak pemesan/pembayar sewa.' });
    return withIdempotency(key, req, body, async () => {
      if (pathname.endsWith('/member-limit')) {
        const tenant = await validatedMutation(() => updateTenantMemberLimit(key.groupJid, body.member_limit, key.ownerJid));
        return { status: 200, response: { data: { group_jid: key.groupJid, member_limit: tenant.maxMembers, member_count: tenant.memberCount }, meta: { key_id: key.id, updated_at: tenant.updatedAt } } };
      }
      const action = await validatedMutation(() => queueRentalMembershipAction({ groupJid: key.groupJid, actorJid: key.ownerJid, targetJid: body.target_jid, action: body.action, idempotencyKey: req.headers['idempotency-key'] }));
      return { status: 202, response: { data: { action_id: action.id, action: action.action, target_jid: action.targetJid, status: action.status, requested_at: action.requestedAt }, meta: { key_id: key.id, message: 'Aksi masuk antrean dan akan dijalankan bot setelah memeriksa status admin.' } } };
    }, res);
  }
  return send(res, 404, { error: 'not_found' });
}

/** Shared gateway dispatch: keeps the public API behind the existing Code Lab TryCloudflare tunnel. */
export async function handleRentalApiRequest(req, res, url = new URL(req.url || '/', 'http://127.0.0.1')) {
  if (!url.pathname.startsWith('/api/v1/')) return false;
  await handle(req, res, url.pathname.slice('/api'.length));
  return true;
}

export async function startRentalApiServer({ logger: log = logger } = {}) {
  if (server) return getRentalApiStatus();
  const port = Math.max(1024, Math.min(65535, Number(process.env.OCHA_RENTAL_API_PORT) || 8788));
  const host = process.env.OCHA_RENTAL_API_HOST || '127.0.0.1';
  server = http.createServer((req, res) => { void handle(req, res).catch(error => { log.warn({ err: error }, 'Rental API request failed'); if (!res.headersSent) send(res, 500, { error: 'internal_error' }); else res.destroy(); }); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  log.info({ host, port }, 'Rental dashboard API listening');
  // Public traffic uses the already-running Code Lab tunnel. This optional
  // dedicated tunnel remains only for installations that explicitly request it.
  if (process.env.OCHA_RENTAL_API_TUNNEL === '1') {
    try {
      tunnel = spawn(process.env.CLOUDFLARED_BIN || 'cloudflared', ['tunnel', '--url', `http://${host}:${port}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const consume = chunk => { const match = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i); if (match) { tunnelUrl = match[0]; log.info({ url: tunnelUrl }, 'Dedicated TryCloudflare rental API tunnel established'); } };
      tunnel.stdout.on('data', consume); tunnel.stderr.on('data', consume);
      tunnel.once('error', error => log.warn({ err: error }, 'cloudflared tunnel could not start'));
      tunnel.once('exit', code => { tunnel = null; log.warn({ code }, 'Dedicated rental API tunnel exited'); });
    } catch (error) { log.warn({ err: error }, 'Dedicated rental API tunnel unavailable; shared gateway remains available'); }
  }
  return getRentalApiStatus();
}

export function getRentalApiStatus() { return { active: Boolean(server?.listening), host: server?.address()?.address || null, port: server?.address()?.port || null, tunnelActive: Boolean(tunnel && tunnel.exitCode === null), tunnelUrl }; }
export async function stopRentalApiServer() {
  if (tunnel && tunnel.exitCode === null) { tunnel.kill('SIGTERM'); tunnel = null; }
  tunnelUrl = null;
  if (server) await new Promise(resolve => server.close(resolve));
  server = null;
}
