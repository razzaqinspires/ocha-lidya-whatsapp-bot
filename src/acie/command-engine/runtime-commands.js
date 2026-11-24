import path from 'node:path';
import { getACIEPaths } from '../core/paths.js';
import { readJson } from '../core/fs-safe.js';
import { listProviders } from '../registry/provider-registry.js';
import { canActivateProvider } from '../security/policy.js';
import { executeWithFallback } from '../routing/provider-router.js';
import { normalizeResponse } from '../response-engine/response-normalizer.js';

function isHttps(value) {
  try { const url = new URL(String(value)); return url.protocol === 'https:'; } catch { return false; }
}

export function renderProviderOutput(output, attribution = null) {
  const normalized = normalizeResponse(output, { attribution });
  const lines = [];
  if (normalized.title) lines.push(`*${String(normalized.title).slice(0, 180)}*`);
  if (normalized.text) lines.push(String(normalized.text).slice(0, 3500));
  if (normalized.url && isHttps(normalized.url)) lines.push(`URL: ${normalized.url}`);
  if (normalized.media) {
    const items = Array.isArray(normalized.media) ? normalized.media : [normalized.media];
    const links = items.map(item => typeof item === 'string' ? item : item?.url).filter(isHttps).slice(0, 5);
    for (const link of links) lines.push(`Media: ${link}`);
  }
  if (normalized.duration) lines.push(`Durasi: ${String(normalized.duration).slice(0, 40)}`);
  if (normalized.metadata && typeof normalized.metadata === 'object') {
    const metadata = JSON.stringify(normalized.metadata, null, 2).slice(0, 1200);
    lines.push(metadata);
  }
  if (normalized.attribution) lines.push(`Sumber: ${normalized.attribution}`);
  return lines.join('\n').slice(0, 4200);
}

function buildInput(raw) {
  const text = String(raw || '').trim().slice(0, 8000);
  if (!text) return null;
  let url = null;
  try { const parsed = new URL(text); if (['http:', 'https:'].includes(parsed.protocol)) url = parsed.href; } catch {}
  return { input: text, ...(url ? { url } : {}) };
}

const rateBuckets = new Map();

function checkGeneratedRateLimit(command, m) {
  const policy = command.rateLimit || { max: 5, windowMs: 60000 };
  const max = Math.max(1, Math.min(30, Number(policy.max) || 5));
  const windowMs = Math.max(1000, Math.min(3600000, Number(policy.windowMs) || 60000));
  const key = `${m.sender || m.senderPn || 'unknown'}::${m.chat || 'private'}::${command.commandId}`;
  const now = Date.now();
  const current = (rateBuckets.get(key) || []).filter(at => now - at < windowMs);
  if (current.length >= max) { rateBuckets.set(key, current); return { allowed: false, retryAfterMs: Math.max(1000, windowMs - (now - current[0])) }; }
  current.push(now);
  rateBuckets.set(key, current);
  if (rateBuckets.size > 20000) for (const [entry, history] of rateBuckets) if (!history.length || now - history[history.length - 1] > windowMs) rateBuckets.delete(entry);
  return { allowed: true };
}

export function createGeneratedCommandPlugin(command, provider) {
  const capabilityAction = String(command.capability || '').split('.').slice(1).join('.');
  const idempotent = ['metadata', 'search'].includes(capabilityAction);
  return {
    name: command.command,
    aliases: Array.isArray(command.aliases) ? command.aliases : [],
    category: command.category || 'downloader',
    menuCategory: command.category || 'downloader',
    description: command.description || `ACIE provider capability ${command.capability}`,
    usage: command.syntax?.split(/\s+/).slice(1).join(' ') || '<input>',
    ownerOnly: command.permission === 'owner',
    privateOnly: command.permission === 'owner' || command.privateOnly === true,
    cooldownWeight: 2,
    menu: true,
    aiCallable: false,
    acieGenerated: true,
    acieCommandId: command.commandId,
    async execute({ m, args = [], text = '' }) {
      const limit = checkGeneratedRateLimit(command, m);
      if (!limit.allowed) return m.reply(`Batas penggunaan command tercapai. Coba lagi dalam ${Math.ceil(limit.retryAfterMs / 1000)} detik.`);
      const input = buildInput(text || args.join(' '));
      if (!input) return m.reply(`Format: ${command.syntax || `.${command.command} <input>`}`);
      const outcome = await executeWithFallback({ capability: command.capability, input, idempotent });
      if (!outcome.ok) {
        const kind = outcome.error?.kind || 'provider-unavailable';
        return m.reply(`Provider ACIE belum dapat memproses permintaan ini (${kind}). Trace: ${outcome.traceId}`);
      }
      const attribution = provider.governance?.attribution || null;
      const response = renderProviderOutput(outcome.result, attribution);
      if (!response) return m.reply(`Provider selesai tetapi belum menghasilkan field respons yang didukung. Trace: ${outcome.traceId}`);
      return m.reply(response);
    }
  };
}

export async function loadGeneratedCommandPlugins({ root = process.cwd(), existingPlugins = [] } = {}) {
  const paths = getACIEPaths(root);
  const file = path.join(paths.generatedCommands, 'index.json');
  const store = await readJson(file, { commands: [] });
  const providers = await listProviders({ root });
  const providerMap = new Map(providers.map(item => [item.providerId, item]));
  const occupied = new Set();
  for (const plugin of existingPlugins) for (const value of [plugin.name, ...(plugin.aliases || [])]) occupied.add(String(value || '').toLowerCase());
  const loaded = [];
  const skipped = [];
  for (const command of store.commands || []) {
    if (command.status !== 'active' || command.activation?.registeredInPluginLoader !== true || command.activation?.visibleInUserMenu !== true) continue;
    if (!['public', 'owner'].includes(command.permission)) { skipped.push({ commandId: command.commandId, reason: 'command-permission-not-approved' }); continue; }
    const provider = providerMap.get(command.providerMapping);
    if (!provider || provider.status !== 'active' || !provider.capabilities?.includes(command.capability)) { skipped.push({ commandId: command.commandId, reason: 'provider-not-active-or-capability-mismatch' }); continue; }
    const gate = canActivateProvider(provider, { root });
    if (!gate.allowed) { skipped.push({ commandId: command.commandId, reason: `provider-gate:${gate.missing.join(',')}` }); continue; }
    const names = [command.command, ...(command.aliases || [])].map(value => String(value || '').toLowerCase());
    if (!names[0] || names.some(name => !/^[a-z0-9][a-z0-9_-]{1,40}$/.test(name)) || names.some(name => occupied.has(name))) {
      skipped.push({ commandId: command.commandId, reason: 'runtime-command-collision-or-invalid-name' });
      continue;
    }
    names.forEach(name => occupied.add(name));
    loaded.push(createGeneratedCommandPlugin(command, provider));
  }
  return { plugins: loaded, loaded: loaded.length, skipped };
}
