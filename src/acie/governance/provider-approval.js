import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { getACIEPaths } from '../core/paths.js';
import { readJson, writeJsonAtomic, acquireExclusiveFileLock } from '../core/fs-safe.js';
import { getProvider } from '../registry/provider-registry.js';
import { inspectRuntimeHost } from '../runtime/runtime-manager.js';
import { validateAdapterDescriptor } from '../adapters/universal-adapter.js';
import { appendACIEAudit } from '../telemetry/audit-log.js';

const STAGES = new Set(['license', 'attribution', 'adapter', 'sandbox', 'authorization']);

async function updateProviderRecord(root, providerId, updater) {
  const paths = getACIEPaths(root);
  await fs.mkdir(paths.registry, { recursive: true, mode: 0o700 });
  const releaseLock = await acquireExclusiveFileLock(path.join(paths.registry, '.registry.lock'), 'ACIE provider registry update sedang berjalan.');
  try {
    const file = path.join(paths.registry, 'providers.json');
    const registry = await readJson(file, { schemaVersion: 1, providers: [] });
    const current = registry.providers.find(item => item.providerId === providerId);
    if (!current) throw new Error('Provider menghilang dari registry ketika pengujian berjalan.');
    const result = await updater(current, registry);
    registry.updatedAt = new Date().toISOString();
    await writeJsonAtomic(file, registry);
    return result ?? current;
  } finally { await releaseLock(); }
}

export async function reviewProviderStage(providerId, stage, { root = process.cwd(), actor = 'owner' } = {}) {
  const normalizedStage = String(stage || '').toLowerCase();
  if (!STAGES.has(normalizedStage)) throw new Error(`Stage tidak dikenal. Pilihan: ${[...STAGES].join(', ')}`);
  const paths = getACIEPaths(root);
  const releaseLock = await acquireExclusiveFileLock(path.join(paths.registry, '.registry.lock'), 'ACIE provider review sedang berjalan.');
  try {
    const providersFile = path.join(paths.registry, 'providers.json');
    const store = await readJson(providersFile, { schemaVersion: 1, providers: [] });
    const provider = store.providers.find(item => item.providerId.toLowerCase() === String(providerId).toLowerCase());
    if (!provider) throw new Error(`Provider tidak ditemukan: ${providerId}`);
    if (provider.status === 'disabled' || provider.status === 'active') throw new Error(`Review stage tidak dapat diubah ketika provider berstatus ${provider.status}. Nonaktifkan provider terlebih dahulu jika perlu review ulang.`);

    if (normalizedStage === 'license') {
      const license = String(provider.governance?.license || '').trim();
      if (!license || license === 'PENDING_INFORMATION') throw new Error('Informasi lisensi belum tersedia. Intake ulang dengan informasi lisensi yang benar.');
      provider.governance.licenseReviewed = true;
      provider.governance.licenseReviewedBy = String(actor).slice(0, 100);
      provider.governance.licenseReviewedAt = new Date().toISOString();
    }
    if (normalizedStage === 'attribution') {
      if (!String(provider.governance?.attribution || '').trim() || provider.governance.attribution === 'PENDING_INFORMATION') throw new Error('Informasi atribusi belum tersedia. Intake ulang dengan atribusi kontributor.');
      provider.governance.attributionConfirmed = true;
      provider.governance.attributionConfirmedBy = String(actor).slice(0, 100);
      provider.governance.attributionConfirmedAt = new Date().toISOString();
    }
    if (normalizedStage === 'adapter') {
      const adapterFile = path.join(paths.adapters, `${provider.providerId}.adapter.json`);
      const adapter = await readJson(adapterFile, null);
      const check = validateAdapterDescriptor(adapter, provider);
      if (!check.valid) throw new Error(`Adapter tidak valid: ${check.errors.join(', ')}`);
      if (!adapter.entryPoint) throw new Error('Adapter tidak memiliki entry point yang dapat ditinjau.');
      adapter.validation = { ...(adapter.validation || {}), adapterReviewed: true, adapterReviewedBy: String(actor).slice(0, 100), adapterReviewedAt: new Date().toISOString() };
      await writeJsonAtomic(adapterFile, adapter);
      provider.validation.adapterReviewed = true;
    }
    if (normalizedStage === 'sandbox') {
      const runtime = inspectRuntimeHost({ root });
      const runtimeConfig = await readJson(paths.config, {});
      const image = runtimeConfig.sandbox?.images?.[provider.language];
      if (!runtime.sandbox.available) throw new Error('Sandbox belum tersedia atau probe belum berhasil. Perintah review sandbox ditolak.');
      if (!provider.sandbox?.profileId) throw new Error('Provider belum memiliki profile sandbox yang disetujui.');
      if (typeof image !== 'string' || !/@sha256:[a-f0-9]{64}$/i.test(image)) throw new Error(`Image ${provider.language} harus dipatok dengan SHA-256 digest sebelum sandbox disetujui.`);
      provider.sandbox.approved = true;
      provider.sandbox.approvedBy = String(actor).slice(0, 100);
      provider.sandbox.approvedAt = new Date().toISOString();
    }
    if (normalizedStage === 'authorization') {
      const missing = [];
      if (!provider.governance?.licenseReviewed) missing.push('license-review');
      if (!provider.governance?.attributionConfirmed) missing.push('attribution-confirmation');
      if (!provider.validation?.adapterReviewed) missing.push('adapter-review');
      if (!provider.sandbox?.approved) missing.push('sandbox-approval');
      if (Number(provider.security?.critical || 0) > 0) missing.push('critical-security-findings');
      if (Number(provider.security?.high || 0) > 0) missing.push('high-security-findings');
      if (missing.length) throw new Error(`Owner authorization belum dapat diberikan: ${missing.join(', ')}`);
      provider.executionAuthorized = true;
      provider.executionAuthorizedBy = String(actor).slice(0, 100);
      provider.executionAuthorizedAt = new Date().toISOString();
    }

    provider.updatedAt = new Date().toISOString();
    store.updatedAt = provider.updatedAt;
    await writeJsonAtomic(providersFile, store);
    await appendACIEAudit('provider.review.stage', { providerId, stage: normalizedStage, actor, status: provider.status }, { root });
    return provider;
  } finally { await releaseLock(); }
}

export async function testProviderAdapter(providerId, { root = process.cwd(), actor = 'owner', capability = null, input = null, spawnImpl } = {}) {
  const provider = await getProvider(providerId, { root });
  if (!provider) throw new Error(`Provider tidak ditemukan: ${providerId}`);
  if (provider.status !== 'quarantined') throw new Error('Protocol test hanya boleh dijalankan ketika provider masih quarantined. Untuk versi baru, lakukan intake sebagai versi kontribusi baru.');
  if (!provider.governance?.licenseReviewed || !provider.governance?.attributionConfirmed || !provider.validation?.adapterReviewed || !provider.sandbox?.approved || !provider.executionAuthorized) {
    throw new Error('Adapter test membutuhkan license review, attribution confirmation, adapter review, sandbox approval, dan owner authorization.');
  }
  const { assertSandboxExecutionAllowed } = await import('../runtime/runtime-manager.js');
  const { executeProviderInSandbox } = await import('../runtime/sandbox-runner.js');
  const { normalizeResponse } = await import('../response-engine/response-normalizer.js');
  const { verifyContribution } = await import('../core/contribution-vault.js');
  const selectedCapability = capability && provider.capabilities.includes(capability) ? capability : provider.capabilities[0];
  if (!selectedCapability) throw new Error('Provider tidak memiliki capability untuk diuji.');
  assertSandboxExecutionAllowed(provider, { root });
  const traceId = crypto.randomUUID();
  const request = input || { action: 'acie.protocol-test', capability: selectedCapability, input: { protocol: 'acie-json-stdio-v1', probe: true } };
  const adapterFile = path.join(getACIEPaths(root).adapters, `${provider.providerId}.adapter.json`);
  let adapter = await readJson(adapterFile, null);
  if (!adapter?.validation?.adapterReviewed) throw new Error('Adapter descriptor belum ditinjau.');
  // Clear a previous green flag before any new probe. A failed re-test must
  // never leave a stale protocol proof that could satisfy activation policy.
  adapter.validation = { ...(adapter.validation || {}), protocolTested: false };
  await writeJsonAtomic(adapterFile, adapter);
  try {
    const output = await executeProviderInSandbox(provider, { capability: selectedCapability, input: request, traceId }, { root, validationMode: true, ...(spawnImpl ? { spawnImpl } : {}) });
    if (output?.ok === false) throw Object.assign(new Error('Provider menolak protocol probe.'), { code: 'PROTOCOL_REJECTED' });
    const normalized = normalizeResponse(output, { attribution: provider.governance?.attribution });
    const hasOutput = Boolean(normalized.text || normalized.title || normalized.url || normalized.media || normalized.metadata);
    if (!hasOutput) throw Object.assign(new Error('Output JSON valid tetapi tidak memuat field respons yang didukung.'), { code: 'INVALID_OUTPUT' });
    const integrity = await verifyContribution(provider.contributionId, { root });
    if (integrity.status !== 'verified') throw Object.assign(new Error('Integrity source berubah setelah adapter test.'), { code: 'INTEGRITY_FAILURE' });

    // Write the adapter protocol proof first. Provider eligibility remains denied
    // until the corresponding registry flags have been committed successfully.
    adapter = await readJson(adapterFile, null);
    if (!adapter) throw Object.assign(new Error('Adapter descriptor hilang setelah test.'), { code: 'ADAPTER_NOT_FOUND' });
    adapter.validation = { ...(adapter.validation || {}), protocolTested: true, testedAt: new Date().toISOString(), testTraceId: traceId };
    await writeJsonAtomic(adapterFile, adapter);

    await updateProviderRecord(root, provider.providerId, current => {
      current.validation = { ...(current.validation || {}), adapterTested: true, protocolTested: true, outputContractVerified: true, testedAt: new Date().toISOString() };
      current.health = { ...(current.health || {}), status: 'healthy', lastCheckAt: new Date().toISOString(), successCount: Number(current.health?.successCount || 0) + 1, consecutiveFailures: 0, lastErrorCode: null };
      return current;
    });
    await appendACIEAudit('provider.adapter.test.success', { traceId, providerId, capability: selectedCapability, actor }, { root }).catch(() => null);
    return { ok: true, traceId, providerId, capability: selectedCapability, outputFields: Object.keys(output).slice(0, 20), integrity: integrity.status };
  } catch (error) {
    await updateProviderRecord(root, provider.providerId, current => {
      current.validation = { ...(current.validation || {}), adapterTested: false, protocolTested: false, outputContractVerified: false, lastTestFailureAt: new Date().toISOString() };
      current.health = { ...(current.health || {}), status: 'failed', lastCheckAt: new Date().toISOString(), failureCount: Number(current.health?.failureCount || 0) + 1, lastErrorCode: String(error.code || error.name || 'TEST_FAILED').slice(0, 80) };
      return current;
    }).catch(() => null);
    if (adapter) {
      adapter.validation = { ...(adapter.validation || {}), protocolTested: false, lastTestFailureAt: new Date().toISOString() };
      await writeJsonAtomic(adapterFile, adapter).catch(() => null);
    }
    await appendACIEAudit('provider.adapter.test.failure', { traceId, providerId, capability: selectedCapability, actor, errorCode: String(error.code || error.name || 'TEST_FAILED').slice(0, 80) }, { root }).catch(() => null);
    throw new Error(`Adapter test gagal (${String(error.code || error.name || 'TEST_FAILED').slice(0, 80)}). Trace: ${traceId}`);
  }
}
