import path from 'node:path';
import crypto from 'node:crypto';
import { getACIEPaths } from '../core/paths.js';
import { readJson, writeJsonAtomic, ensurePrivateDir, acquireExclusiveFileLock } from '../core/fs-safe.js';
import { appendACIEAudit } from '../telemetry/audit-log.js';
import { canActivateProvider } from '../security/policy.js';

const empty = () => ({ schemaVersion: 1, updatedAt: null, providers: [] });
const capabilityEmpty = () => ({ schemaVersion: 1, updatedAt: null, capabilities: [] });
const commandEmpty = () => ({ schemaVersion: 1, updatedAt: null, commands: [] });
async function readStore(file, fallback) { return await readJson(file, fallback); }

export async function registerContribution({ manifest, analysis, capabilities = [], commandDrafts = [] }, { root = process.cwd() } = {}) {
  const paths = getACIEPaths(root);
  await ensurePrivateDir(paths.registry);
  const releaseLock = await acquireExclusiveFileLock(path.join(paths.registry, '.registry.lock'), 'ACIE registry update is already running.');
  try {
    const providerId = `${manifest.contributorId}-${manifest.name}-${manifest.version}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const providersFile = path.join(paths.registry, 'providers.json');
    const capabilityFile = path.join(paths.registry, 'capabilities.json');
    const commandsFile = path.join(paths.registry, 'commands.json');
    const providers = await readStore(providersFile, empty());
    const capStore = await readStore(capabilityFile, capabilityEmpty());
    const commandStore = await readStore(commandsFile, commandEmpty());
    const provider = {
      providerId, contributionId: manifest.contributionId, contributorId: manifest.contributorId,
      contributionName: manifest.name, version: manifest.version,
      language: manifest.runtimeLanguage || manifest.languageDiscovery?.primaryLanguage || 'unknown',
      moduleSystem: manifest.languageDiscovery?.moduleSystem || 'unknown',
      runtime: manifest.languageDiscovery?.runtime || 'unknown',
      priority: 100, status: 'quarantined', integrity: 'verified',
      executionAuthorized: false, sandbox: { approved: false, profileId: 'default' },
      governance: { licenseReviewed: false, attributionConfirmed: false, license: manifest.license, attribution: manifest.attribution },
      security: { critical: Number(analysis?.security?.critical || 0), high: Number(analysis?.security?.high || 0), findings: Number(analysis?.security?.findings?.length || 0) },
      capabilities: capabilities.map(item => item.id),
      validation: { staticAnalysis: Boolean(analysis), adapterTested: false, outputContractVerified: false },
      health: { status: 'not-tested', lastCheckAt: null, successCount: 0, failureCount: 0, consecutiveFailures: 0 },
      circuitBreaker: { state: 'closed', failures: 0, openedAt: null },
      createdAt: new Date().toISOString()
    };
    if (!providers.providers.some(item => item.providerId === providerId)) providers.providers.push(provider);
    providers.updatedAt = new Date().toISOString();

    for (const candidate of capabilities) {
      let record = capStore.capabilities.find(item => item.id === candidate.id);
      if (!record) { record = { id: candidate.id, platform: candidate.platform, action: candidate.action, status: 'discovered', providers: [] }; capStore.capabilities.push(record); }
      if (!record.providers.includes(providerId)) record.providers.push(providerId);
    }
    capStore.updatedAt = new Date().toISOString();
    for (const draft of commandDrafts) {
      const existing = commandStore.commands.find(item => item.commandId === draft.commandId);
      if (!existing) commandStore.commands.push(draft);
    }
    commandStore.updatedAt = new Date().toISOString();

    await writeJsonAtomic(providersFile, providers);
    await writeJsonAtomic(capabilityFile, capStore);
    await writeJsonAtomic(commandsFile, commandStore);
    await appendACIEAudit('contribution.registered', { contributionId: manifest.contributionId, providerId, capabilityCount: capabilities.length, commandDraftCount: commandDrafts.length }, { root });
    return provider;
  } finally { await releaseLock(); }
}

export async function listProviders({ root = process.cwd() } = {}) {
  const file = path.join(getACIEPaths(root).registry, 'providers.json');
  const store = await readJson(file, empty());
  return store.providers || [];
}
export async function listCapabilities({ root = process.cwd() } = {}) {
  const file = path.join(getACIEPaths(root).registry, 'capabilities.json');
  const store = await readJson(file, capabilityEmpty());
  return store.capabilities || [];
}
export async function listCommandDrafts({ root = process.cwd() } = {}) {
  const paths = getACIEPaths(root);
  const canonical = await readJson(path.join(paths.generatedCommands, 'index.json'), null);
  if (canonical && Array.isArray(canonical.commands)) return canonical.commands;
  const store = await readJson(path.join(paths.registry, 'commands.json'), commandEmpty());
  return store.commands || [];
}
export async function getProvider(providerId, { root = process.cwd() } = {}) {
  return (await listProviders({ root })).find(item => item.providerId.toLowerCase() === String(providerId || '').toLowerCase()) || null;
}

export async function setProviderEnabled(providerId, enabled, { root = process.cwd(), actor = 'owner' } = {}) {
  const paths = getACIEPaths(root);
  await ensurePrivateDir(paths.registry);
  const releaseLock = await acquireExclusiveFileLock(path.join(paths.registry, '.registry.lock'), 'ACIE registry update is already running.');
  try {
    const file = path.join(paths.registry, 'providers.json');
    const store = await readJson(file, empty());
    const provider = store.providers.find(item => item.providerId.toLowerCase() === String(providerId || '').toLowerCase());
    if (!provider) throw new Error(`Provider not found: ${providerId}`);
    if (enabled) {
      const gate = canActivateProvider(provider, { root });
      if (!gate.allowed) throw new Error(`Provider belum memenuhi aktivasi. Persyaratan: ${gate.missing.join(', ')}`);
      provider.status = 'active';
    } else {
      provider.status = 'disabled';
    }
    provider.updatedAt = new Date().toISOString();
    provider.updatedBy = String(actor).slice(0, 100);
    store.updatedAt = provider.updatedAt;
    await writeJsonAtomic(file, store);
    await appendACIEAudit(enabled ? 'provider.enabled' : 'provider.disabled', { providerId, actor, status: provider.status }, { root });
    return provider;
  } finally { await releaseLock(); }
}

export async function inspectProvider(providerId, options = {}) {
  const provider = await getProvider(providerId, options);
  if (!provider) return null;
  return { ...provider, activationGate: canActivateProvider(provider, options) };
}

export function createProviderId(prefix = 'provider') { return `${prefix}-${crypto.randomUUID()}`; }


export async function recordProviderExecution(providerId, outcome, { root = process.cwd() } = {}) {
  const paths = getACIEPaths(root);
  await ensurePrivateDir(paths.registry);
  const releaseLock = await acquireExclusiveFileLock(path.join(paths.registry, '.registry.lock'), 'ACIE provider health update is already running.');
  try {
    const file = path.join(paths.registry, 'providers.json');
    const store = await readJson(file, empty());
    const provider = store.providers.find(item => item.providerId.toLowerCase() === String(providerId || '').toLowerCase());
    if (!provider) return null;
    const now = new Date().toISOString();
    const health = provider.health || {};
    const success = outcome?.success === true;
    const durationMs = Math.max(0, Number(outcome?.durationMs) || 0);
    const successCount = Number(health.successCount || 0) + (success ? 1 : 0);
    const failureCount = Number(health.failureCount || 0) + (success ? 0 : 1);
    const total = successCount + failureCount;
    provider.health = {
      ...health,
      status: success ? 'healthy' : (outcome?.errorKind === 'rate-limit' ? 'rate-limited' : 'degraded'),
      lastCheckAt: now,
      lastSuccessAt: success ? now : (health.lastSuccessAt || null),
      successCount,
      failureCount,
      consecutiveFailures: success ? 0 : Number(health.consecutiveFailures || 0) + 1,
      averageResponseMs: Math.round(((Number(health.averageResponseMs || 0) * Math.max(0, total - 1)) + durationMs) / Math.max(1, total)),
      lastErrorKind: success ? null : String(outcome?.errorKind || 'unknown').slice(0, 80),
      fallbackCount: Number(health.fallbackCount || 0) + Math.max(0, Number(outcome?.fallbackCount) || 0)
    };
    if (outcome?.circuitBreaker) provider.circuitBreaker = structuredClone(outcome.circuitBreaker);
    provider.updatedAt = now;
    store.updatedAt = now;
    await writeJsonAtomic(file, store);
    return provider.health;
  } finally { await releaseLock(); }
}
