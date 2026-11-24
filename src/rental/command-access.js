import { getRecord, putRecord } from '../core/repository.js';
import { getTenantStatus } from './service.js';
const RESERVED = new Set(['menu', 'help', 'start', 'sewa', 'rent', 'paketsewa', 'gadmin', 'groupadmin', 'sewaapi', 'profile', 'groupinfo']);
const validCommand = value => /^[a-z][a-z0-9_-]{0,39}$/.test(String(value || '').toLowerCase());

export async function getTenantCommandPolicy(groupJid) {
  const current = await getRecord('rental.command-policy', groupJid);
  return current || { groupJid, mode: 'denylist', commands: [], updatedAt: null };
}

export async function updateTenantCommandPolicy(groupJid, { mode = 'denylist', commands = [] } = {}, actor = 'dashboard') {
  const tenant = await getTenantStatus(groupJid);
  if (!tenant.tenant || tenant.status !== 'active') throw new Error('Pengaturan akses command hanya tersedia saat sewa aktif.');
  const selectedMode = String(mode || '').toLowerCase();
  if (!['allowlist', 'denylist'].includes(selectedMode)) throw new Error('Mode harus allowlist atau denylist.');
  if (!Array.isArray(commands) || commands.length > 80) throw new Error('Daftar command harus berupa array maksimum 80 item.');
  const normalized = [...new Set(commands.map(value => String(value || '').trim().toLowerCase()))];
  if (normalized.some(value => !validCommand(value))) throw new Error('Nama command hanya boleh berisi huruf kecil, angka, garis bawah, dan tanda hubung.');
  const protectedNames = normalized.filter(value => RESERVED.has(value));
  if (protectedNames.length) throw new Error(`Command sistem tidak boleh diblokir atau dikeluarkan dari allowlist: ${protectedNames.join(', ')}.`);
  const previous = await getTenantCommandPolicy(groupJid);
  const next = { groupJid, mode: selectedMode, commands: normalized, updatedAt: new Date().toISOString(), version: (Number(previous.version) || 0) + 1 };
  await putRecord('rental.command-policy', groupJid, next, { actor, reason: `tenant command access ${selectedMode} updated` });
  await putRecord('rental.audit', `CMD-POLICY-${groupJid}-${Date.now()}`, { action: 'tenant.command-policy-updated', groupJid, actor, mode: selectedMode, commands: normalized, at: next.updatedAt }, { source: 'rental-dashboard-api' });
  return next;
}

export async function isTenantCommandAllowed(groupJid, command) {
  const policy = await getTenantCommandPolicy(groupJid);
  const name = String(command || '').toLowerCase();
  if (!policy.updatedAt || !['allowlist', 'denylist'].includes(policy.mode)) return { allowed: true, policy };
  if (RESERVED.has(name)) return { allowed: true, policy, protected: true };
  const includes = policy.commands.includes(name);
  const allowed = policy.mode === 'allowlist' ? includes : !includes;
  return { allowed, policy };
}

export const RESERVED_TENANT_COMMANDS = [...RESERVED];
