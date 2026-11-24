import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCommandDrafts, persistCommandDrafts } from '../src/acie/command-engine/command-generation.js';
import { approveCommandDraft, rejectCommandDraft, synchronizeCommandRegistries } from '../src/acie/command-engine/command-lifecycle.js';
import { loadGeneratedCommandPlugins, renderProviderOutput, createGeneratedCommandPlugin } from '../src/acie/command-engine/runtime-commands.js';
import { reviewProviderStage } from '../src/acie/governance/provider-approval.js';
import { createExternalAdapterDescriptor } from '../src/acie/adapters/universal-adapter.js';
import { recordProviderExecution } from '../src/acie/registry/provider-registry.js';
import { listCommandDrafts } from '../src/acie/registry/provider-registry.js';
import { canActivateProvider } from '../src/acie/security/policy.js';
import { normalizeResponse } from '../src/acie/response-engine/response-normalizer.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'acie-command-'));
  await fs.mkdir(path.join(root, 'contributions', 'registry'), { recursive: true });
  await fs.mkdir(path.join(root, 'generated-commands'), { recursive: true });
  return { root, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test('command generation creates one specification for each supported discovered capability and resolves collisions by namespace', () => {
  const capabilities = [
    { id: 'pinterest.metadata', platform: 'pinterest', action: 'metadata' },
    { id: 'pinterest.download.video', platform: 'pinterest', action: 'download.video' },
    { id: 'pinterest.download.image', platform: 'pinterest', action: 'download.image' },
    { id: 'pinterest.download.audio', platform: 'pinterest', action: 'download.audio' },
    { id: 'pinterest.search', platform: 'pinterest', action: 'search' },
    { id: 'unknown.publish', platform: 'unknown', action: 'publish' }
  ];
  const drafts = buildCommandDrafts({ contributionId: 'C-1', providerId: 'P-1', capabilities, existingPlugins: [{ name: 'pinterest-video', aliases: ['pinvideo'] }] });
  assert.equal(drafts.length, 5);
  const video = drafts.find(item => item.capability === 'pinterest.download.video');
  assert.equal(video.command, 'acie-pinterest-video');
  assert.equal(video.collision.resolved, true);
  assert.equal(video.aliases.includes('pinvideo'), false);
  assert.equal(video.permission, 'pending-review');
  assert.equal(video.activation.registeredInPluginLoader, false);
  assert.ok(video.parameters[0].required);
  assert.equal(drafts.some(item => item.status === 'active'), false);
});

test('command draft persistence keeps canonical and compatibility registries synchronized', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const drafts = buildCommandDrafts({ contributionId: 'C-2', providerId: 'P-2', capabilities: [{ id: 'tiktok.download.video', platform: 'tiktok', action: 'download.video' }] });
  await persistCommandDrafts(drafts, { root: f.root });
  const canonical = await fs.readFile(path.join(f.root, 'generated-commands', 'index.json'), 'utf8').then(JSON.parse);
  const compatibility = await fs.readFile(path.join(f.root, 'contributions', 'registry', 'commands.json'), 'utf8').then(JSON.parse);
  assert.equal(canonical.commands.length, 1);
  assert.equal(compatibility.commands.length, 1);
  assert.equal((await listCommandDrafts({ root: f.root }))[0].commandId, drafts[0].commandId);
  const catalog = await fs.readFile(path.join(f.root, 'generated-commands', 'COMMAND_CATALOG.md'), 'utf8');
  assert.match(catalog, /tiktok\.download\.video/);
  assert.match(catalog, /URL yang didukung provider/);
});

test('command approval refuses quarantined providers and never activates a draft', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const drafts = buildCommandDrafts({ contributionId: 'C-3', providerId: 'P-3', capabilities: [{ id: 'instagram.metadata', platform: 'instagram', action: 'metadata' }] });
  await persistCommandDrafts(drafts, { root: f.root });
  await fs.writeFile(path.join(f.root, 'contributions', 'registry', 'providers.json'), JSON.stringify({ providers: [{ providerId: 'P-3', status: 'quarantined', capabilities: ['instagram.metadata'] }] }));
  await assert.rejects(approveCommandDraft(drafts[0].commandId, { root: f.root, permission: 'public' }), /Provider harus aktif/);
  const after = await listCommandDrafts({ root: f.root });
  assert.equal(after[0].status, 'draft-pending-validation');
  assert.equal(after[0].activation.visibleInUserMenu, false);
});

test('rejecting a draft updates both registries and marks activation disabled', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const drafts = buildCommandDrafts({ contributionId: 'C-4', providerId: 'P-4', capabilities: [{ id: 'youtube.metadata', platform: 'youtube', action: 'metadata' }] });
  await persistCommandDrafts(drafts, { root: f.root });
  await rejectCommandDraft(drafts[0].commandId, { root: f.root, actor: 'owner-test', reason: 'not-permitted' });
  const canonical = await fs.readFile(path.join(f.root, 'generated-commands', 'index.json'), 'utf8').then(JSON.parse);
  const compatibility = await fs.readFile(path.join(f.root, 'contributions', 'registry', 'commands.json'), 'utf8').then(JSON.parse);
  assert.equal(canonical.commands[0].status, 'rejected');
  assert.equal(compatibility.commands[0].status, 'rejected');
  assert.equal(canonical.commands[0].activation.registeredInPluginLoader, false);
});

test('generated runtime plugins load only active commands whose provider and security gate are approved', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const drafts = buildCommandDrafts({ contributionId: 'C-5', providerId: 'P-5', capabilities: [{ id: 'reddit.metadata', platform: 'reddit', action: 'metadata' }] });
  drafts[0].status = 'active';
  drafts[0].permission = 'public';
  drafts[0].activation.registeredInPluginLoader = true;
  drafts[0].activation.visibleInUserMenu = true;
  await persistCommandDrafts(drafts, { root: f.root });
  await fs.writeFile(path.join(f.root, 'contributions', 'registry', 'providers.json'), JSON.stringify({ providers: [{ providerId: 'P-5', status: 'quarantined', capabilities: ['reddit.metadata'] }] }));
  const result = await loadGeneratedCommandPlugins({ root: f.root, existingPlugins: [] });
  assert.equal(result.plugins.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /provider-not-active/);
});

test('provider response renderer only exposes HTTPS media links and bounded attribution', () => {
  const output = renderProviderOutput({ title: 'Test', text: 'Ready', url: 'http://127.0.0.1/admin', media: ['https://cdn.example/video.mp4', 'file:///etc/passwd', '/tmp/private.mp4'], metadata: { duration: '10s' } }, 'Contributor source');
  assert.match(output, /Ready/);
  assert.match(output, /https:\/\/cdn\.example\/video\.mp4/);
  assert.doesNotMatch(output, /127\.0\.0\.1|passwd|private\.mp4/);
  assert.match(output, /Contributor source/);
});


test('provider review is staged and sandbox approval fails closed without a probed runtime', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const provider = {
    providerId: 'P-REVIEW', contributionId: 'C-REVIEW', status: 'quarantined', language: 'javascript',
    governance: { license: 'MIT', attribution: 'Original implementation by contributor', licenseReviewed: false, attributionConfirmed: false },
    validation: { adapterReviewed: false, adapterTested: false, outputContractVerified: false },
    sandbox: { approved: false, profileId: 'default' }, executionAuthorized: false,
    capabilities: ['pinterest.metadata'], security: { critical: 0, high: 0 }
  };
  await fs.writeFile(path.join(f.root, 'contributions', 'registry', 'providers.json'), JSON.stringify({ providers: [provider] }));
  const adapter = createExternalAdapterDescriptor({ providerId: provider.providerId, contributionId: provider.contributionId, capabilities: [{ id: 'pinterest.metadata' }], entryPoint: 'index.js', language: 'javascript' });
  await fs.mkdir(path.join(f.root, 'adapters'), { recursive: true });
  await fs.writeFile(path.join(f.root, 'adapters', `${provider.providerId}.adapter.json`), JSON.stringify(adapter));
  await reviewProviderStage(provider.providerId, 'license', { root: f.root, actor: 'owner' });
  await reviewProviderStage(provider.providerId, 'attribution', { root: f.root, actor: 'owner' });
  const adapterReviewed = await reviewProviderStage(provider.providerId, 'adapter', { root: f.root, actor: 'owner' });
  assert.equal(adapterReviewed.validation.adapterReviewed, true);
  await assert.rejects(reviewProviderStage(provider.providerId, 'sandbox', { root: f.root }), /Sandbox belum tersedia/);
  await assert.rejects(reviewProviderStage(provider.providerId, 'authorization', { root: f.root }), /sandbox-approval/);
});

test('provider execution health and circuit-breaker metadata persist without source changes', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await fs.writeFile(path.join(f.root, 'contributions', 'registry', 'providers.json'), JSON.stringify({ providers: [{ providerId: 'P-HEALTH', health: { successCount: 0, failureCount: 0 }, circuitBreaker: { state: 'closed', failures: 0 } }] }));
  await recordProviderExecution('P-HEALTH', { success: false, durationMs: 120, errorKind: 'network-error', circuitBreaker: { state: 'open', failures: 3, openedAt: 12345 } }, { root: f.root });
  const store = await fs.readFile(path.join(f.root, 'contributions', 'registry', 'providers.json'), 'utf8').then(JSON.parse);
  assert.equal(store.providers[0].health.failureCount, 1);
  assert.equal(store.providers[0].health.status, 'degraded');
  assert.equal(store.providers[0].circuitBreaker.state, 'open');
});


test('provider activation requires a separate successful adapter protocol test', () => {
  const approved = {
    providerId: 'P-GATE', status: 'active', integrity: 'verified', executionAuthorized: true,
    sandbox: { approved: true }, governance: { licenseReviewed: true },
    validation: { adapterReviewed: true, adapterTested: true, outputContractVerified: true, protocolTested: false },
    security: { critical: 0, high: 0 }
  };
  const gate = canActivateProvider(approved, { root: path.resolve('test/fixtures/acie-policy-no-runtime') });
  assert.ok(gate.missing.includes('adapter-protocol-tested'));
  assert.ok(gate.missing.includes('sandbox-runtime-available'));
});

test('response normalization strips credential-bearing text and sensitive URL query fields', () => {
  const value = normalizeResponse({
    text: 'done api_key=abc123 Bearer super-secret-token',
    url: 'https://example.test/file?token=private&download=1',
    metadata: { accessToken: 'do-not-show', title: 'safe' }
  });
  assert.doesNotMatch(value.text, /abc123|super-secret-token/);
  assert.doesNotMatch(value.url, /private/);
  assert.equal(value.metadata.accessToken, undefined);
  assert.equal(value.metadata.title, 'safe');
});


test('generated plugin metadata integrates a command into existing menu conventions and protects owner commands', () => {
  const provider = { governance: { attribution: 'Developer attribution' } };
  const command = { commandId: 'ACIE-CMD-1', command: 'acie-pinterest-video', aliases: [], category: 'downloader', description: 'Download video', syntax: '.acie-pinterest-video <input>', permission: 'owner', privateOnly: false, capability: 'pinterest.download.video', rateLimit: { max: 3, windowMs: 60000 } };
  const plugin = createGeneratedCommandPlugin(command, provider);
  assert.equal(plugin.name, 'acie-pinterest-video');
  assert.equal(plugin.category, 'downloader');
  assert.equal(plugin.menu, true);
  assert.equal(plugin.ownerOnly, true);
  assert.equal(plugin.privateOnly, true);
  assert.equal(plugin.aiCallable, false);
  assert.equal(plugin.usage, '<input>');
});


test('command registry sync repairs a missing compatibility mirror from the canonical store', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const drafts = buildCommandDrafts({ contributionId: 'C-SYNC', providerId: 'P-SYNC', capabilities: [{ id: 'facebook.metadata', platform: 'facebook', action: 'metadata' }] });
  await persistCommandDrafts(drafts, { root: f.root });
  const canonicalFile = path.join(f.root, 'generated-commands', 'index.json');
  const canonical = await fs.readFile(canonicalFile, 'utf8').then(JSON.parse);
  canonical.commands[0].status = 'rejected';
  await fs.writeFile(canonicalFile, JSON.stringify(canonical));
  const staleMirror = structuredClone(canonical.commands[0]);
  staleMirror.status = 'draft-pending-validation';
  await fs.writeFile(path.join(f.root, 'contributions', 'registry', 'commands.json'), JSON.stringify({ schemaVersion: 1, commands: [staleMirror] }));
  const result = await synchronizeCommandRegistries({ root: f.root });
  const mirror = await fs.readFile(path.join(f.root, 'contributions', 'registry', 'commands.json'), 'utf8').then(JSON.parse);
  assert.equal(result.canonicalCount, 1);
  assert.equal(mirror.commands[0].commandId, drafts[0].commandId);
  assert.equal(mirror.commands[0].status, 'rejected');
});
