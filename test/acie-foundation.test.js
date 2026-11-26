import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { safeSlug, safeRelativePath } from '../src/acie/core/fs-safe.js';
import { identifyLanguage } from '../src/acie/intelligence/language-discovery.js';
import { analyzeContribution } from '../src/acie/intelligence/static-analysis.js';
import { scanExistingPluginCommands } from '../src/acie/command-engine/command-generation.js';
import { assertSandboxExecutionAllowed, inspectRuntimeHost } from '../src/acie/runtime/runtime-manager.js';
import { setProviderEnabled } from '../src/acie/registry/provider-registry.js';
import plugin from '../src/plugins/owner/acie.js';
import { discoverCapabilities } from '../src/acie/intelligence/capability-discovery.js';
import { intakeContribution, verifyContribution, findContribution } from '../src/acie/core/contribution-vault.js';
import { runContributionIntake } from '../src/acie/orchestration/contribution-intake.js';
import { listProviders, inspectProvider } from '../src/acie/registry/provider-registry.js';
import {
  selectProviders,
  executeWithFallback,
  resetRoutingStateForTests,
} from '../src/acie/routing/provider-router.js';
import { classifyProviderError } from '../src/acie/routing/error-classifier.js';
import { readACIEAudit } from '../src/acie/telemetry/audit-log.js';
import { listWorkers, runWorker } from '../src/acie/workers/worker-orchestrator.js';
import { initializeACIE } from '../src/acie/index.js';
import { refreshContributionHistoryAnchors } from '../src/acie/core/contribution-vault.js';
import { sha256Buffer } from '../src/acie/core/fs-safe.js';
import { evaluateContributionGovernance } from '../src/acie/governance/governance-manager.js';

async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-acie-test-'));
  const root = path.join(base, 'bot');
  const source = path.join(base, 'contributor-source');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(source, { recursive: true });
  return { base, root, source, cleanup: () => fs.rm(base, { recursive: true, force: true }) };
}

async function writeSample(source, suffix = '') {
  const js = `// Pinterest helper${suffix}\nconst endpoint = 'https://www.pinterest.com/';\nexport async function getMetadata(url) { return { url }; }\nexport async function downloadPinterestVideo(url) { return { url }; }\n`;
  await fs.writeFile(path.join(source, 'index.mjs'), js);
  await fs.writeFile(
    path.join(source, 'package.json'),
    JSON.stringify({ name: 'contributor-module', type: 'module', dependencies: { undici: '^6.0.0' } }),
  );
  await fs.writeFile(path.join(source, 'requirements.txt'), 'requests==2.32.0\n');
  await fs.writeFile(path.join(source, 'helper.py'), 'def helper():\n    return True\n');
  return js;
}

test('governance never infers rights or activation from submitted license and attribution text', () => {
  const pending = evaluateContributionGovernance({
    contributorName: 'Developer A',
    license: 'MIT',
    attribution: 'Provided by Developer A',
  });
  assert.equal(pending.licenseProvided, true);
  assert.equal(pending.licenseReviewed, false);
  assert.equal(pending.attributionConfirmed, false);
  assert.equal(pending.activationAllowed, false);
  assert.equal(pending.sourceExecutionAllowed, false);
  assert.ok(pending.pending.includes('license-human-review'));
  assert.ok(pending.pending.includes('attribution-confirmation'));
  const missing = evaluateContributionGovernance({});
  assert.equal(missing.status, 'pending-information');
  assert.ok(missing.pending.includes('license-information'));
});

test('ACIE identifiers and archive paths reject traversal', () => {
  assert.equal(safeSlug('Friend Developer 01'), 'friend-developer-01');
  assert.throws(() => safeSlug('../root'), /path separators or traversal/);
  assert.throws(() => safeRelativePath('../secret.txt'), /Unsafe/);
  assert.throws(() => safeRelativePath('C:\\private\\x'), /Unsafe/);
  assert.throws(() => safeRelativePath('folder//file.js'), /Unsafe/);
});

test('language discovery identifies required source languages', () => {
  assert.equal(identifyLanguage('index.cjs'), 'javascript');
  assert.equal(identifyLanguage('worker.py'), 'python');
  assert.equal(identifyLanguage('main.go', 'package main\nfunc main() {}'), 'go');
  assert.equal(identifyLanguage('index.php', '<?php echo 1;'), 'php');
  assert.equal(identifyLanguage('Main.java'), 'java');
  assert.equal(identifyLanguage('lib.rs'), 'rust');
  assert.equal(identifyLanguage('run.sh'), 'bash');
  assert.equal(identifyLanguage('main.ts'), 'typescript');
});

test('multilanguage intake preserves CommonJS, ESM, TypeScript, Python, Go, PHP, Java, Rust and Bash bytes', async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const samples = {
    'index.cjs': 'module.exports = { run: () => true };\n',
    'module.mjs': 'export const run = () => true;\n',
    'legacy.js': 'const fs = require("node:fs"); module.exports = fs;\n',
    'index.ts': 'export const run: () => boolean = () => true;\n',
    'worker.py': 'def run():\n    return True\n',
    'main.go': 'package main\nfunc Run() bool { return true }\n',
    'index.php': '<?php function run() { return true; }\n',
    'Main.java': 'public class Main { public boolean run() { return true; } }\n',
    'lib.rs': 'pub fn run() -> bool { true }\n',
    'run.sh': '#!/usr/bin/env bash\nrun() { true; }\n',
  };
  for (const [name, text] of Object.entries(samples)) await fs.writeFile(path.join(f.source, name), text);
  const result = await intakeContribution({
    source: f.source,
    contributorId: 'multi-lang',
    contributionName: 'language-matrix',
    root: f.root,
  });
  const actual = new Map(result.manifest.inventory.map(item => [item.path, item.sha256]));
  for (const [name, text] of Object.entries(samples)) assert.equal(actual.get(name), sha256Buffer(Buffer.from(text)));
  assert.equal(result.manifest.originalFileCount, Object.keys(samples).length);
  assert.equal(result.manifest.languageDiscovery.primaryLanguage, 'mixed');
  assert.equal(result.manifest.languageDiscovery.moduleSystem, 'mixed');
  assert.equal((await verifyContribution(result.manifest.contributionId, { root: f.root })).status, 'verified');
});

test('capability discovery only returns candidates supported by indicators and function names', () => {
  const analysis = {
    platformIdentifiers: ['pinterest'],
    inventory: [{ path: 'src/pinterest.js' }],
    functions: [{ name: 'downloadPinterestVideo' }, { name: 'getMetadata' }, { name: 'formatTitle' }],
  };
  const result = discoverCapabilities(analysis);
  assert.deepEqual(result.map(item => item.id).sort(), ['pinterest.download.video', 'pinterest.metadata']);
  assert.ok(result.every(item => item.status === 'unverified'));
});

test('intake preserves original bytes, creates provenance and verifies immutable copy', async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const code = await writeSample(f.source);
  const result = await intakeContribution({
    source: f.source,
    contributorId: 'friend-001',
    contributionName: 'pinterest-downloader',
    projectId: 'ocha-lidya-bot',
    root: f.root,
  });
  assert.equal(result.manifest.originalFileCount, 4);
  assert.equal(result.manifest.version, 'v1');
  assert.equal(result.manifest.license, 'PENDING_INFORMATION');
  assert.equal(result.manifest.executionAuthorization, 'not-authorized');
  assert.equal(await fs.readFile(path.join(result.originalDirectory, 'index.mjs'), 'utf8'), code);
  assert.deepEqual(await verifyContribution(result.manifest.contributionId, { root: f.root }), {
    contributionId: result.manifest.contributionId,
    expectedFiles: 4,
    actualFiles: 4,
    expectedBytes: result.manifest.originalBytes,
    actualBytes: result.manifest.originalBytes,
    status: 'verified',
    mismatches: [],
  });
  const provenance = JSON.parse(await fs.readFile(path.join(result.versionRoot, 'provenance.json'), 'utf8'));
  assert.equal(provenance.preservation.originalModified, false);
  assert.equal(provenance.rights.status, 'pending-information');
});

test('intake pipeline records quarantined provider, external adapter and command drafts without activation', async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const sourceCode = await writeSample(f.source);
  const result = await runContributionIntake(
    { source: f.source, contributorId: 'friend-002', contributionName: 'pinterest-suite' },
    {
      root: f.root,
      existingPlugins: [{ name: 'pinterest-video', aliases: ['pinvideo'] }],
    },
  );
  assert.equal(result.provider.status, 'quarantined');
  assert.equal(result.provider.executionAuthorized, false);
  assert.equal(result.contribution.manifest.languageDiscovery.primaryLanguage, 'mixed');
  assert.ok(result.capabilities.some(item => item.id === 'pinterest.download.video'));
  const videoDraft = result.commandDrafts.find(item => item.preferredCommand === 'pinterest-video');
  assert.equal(videoDraft.command, 'acie-pinterest-video');
  assert.equal(videoDraft.status, 'draft-pending-validation');
  assert.equal(videoDraft.collision.detected, true);
  assert.equal(videoDraft.collision.resolved, true);
  assert.equal(videoDraft.aliases.includes('pinvideo'), false);
  const metadataDraft = result.commandDrafts.find(item => item.command === 'pinterest-info');
  assert.equal(metadataDraft.status, 'draft-pending-validation');
  assert.equal(await fs.readFile(path.join(result.contribution.originalDirectory, 'index.mjs'), 'utf8'), sourceCode);
  assert.equal(
    await fs
      .readFile(path.join(f.root, 'adapters', `${result.provider.providerId}.adapter.json`), 'utf8')
      .then(text => JSON.parse(text).execution.enabled),
    false,
  );
  const adapterDescriptor = JSON.parse(
    await fs.readFile(path.join(f.root, 'adapters', `${result.provider.providerId}.adapter.json`), 'utf8'),
  );
  assert.equal(adapterDescriptor.protocol, 'acie-json-stdio-v1');
  assert.equal(adapterDescriptor.provider.language, 'javascript');
  assert.equal(result.provider.language, 'javascript');
  assert.equal((await selectProviders('pinterest.download.video', { root: f.root })).length, 0);
  const inspect = await inspectProvider(result.provider.providerId, { root: f.root });
  assert.equal(inspect.activationGate.allowed, false);
  assert.ok(inspect.activationGate.missing.includes('sandbox-approved'));
  assert.ok(inspect.activationGate.missing.includes('sandbox-runtime-available'));
});

test('contribution versioning never overwrites older original source', async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const firstCode = await writeSample(f.source, '-v1');
  const first = await intakeContribution({
    source: f.source,
    contributorId: 'friend-003',
    contributionName: 'multi-version',
    root: f.root,
  });
  await fs.writeFile(path.join(f.source, 'index.mjs'), firstCode.replace('-v1', '-v2'));
  const second = await intakeContribution({
    source: f.source,
    contributorId: 'friend-003',
    contributionName: 'multi-version',
    root: f.root,
  });
  assert.equal(first.manifest.version, 'v1');
  assert.equal(second.manifest.version, 'v2');
  assert.equal(await fs.readFile(path.join(first.originalDirectory, 'index.mjs'), 'utf8'), firstCode);
  assert.match(await fs.readFile(path.join(second.originalDirectory, 'index.mjs'), 'utf8'), /-v2/);
});

test('routing fails closed and never invokes an injected executor without a production sandbox', async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const providers = path.join(f.root, 'contributions', 'registry', 'providers.json');
  await fs.mkdir(path.dirname(providers), { recursive: true });
  const apparentlyApproved = id => ({
    providerId: id,
    capabilities: ['pinterest.download.video'],
    status: 'active',
    integrity: 'verified',
    executionAuthorized: true,
    sandbox: { approved: true },
    governance: { licenseReviewed: true, attributionConfirmed: true },
    validation: { adapterReviewed: true, adapterTested: true, protocolTested: true, outputContractVerified: true },
    priority: id === 'provider-a' ? 1 : 2,
  });
  await fs.writeFile(
    providers,
    JSON.stringify({ providers: [apparentlyApproved('provider-a'), apparentlyApproved('provider-b')] }),
  );
  let executorCalled = false;
  const result = await executeWithFallback({
    capability: 'pinterest.download.video',
    input: { url: 'https://pinterest.example/a' },
    idempotent: true,
    root: f.root,
    executor: async () => {
      executorCalled = true;
      return { ok: true };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'provider-unavailable');
  assert.equal(executorCalled, false);
  assert.equal((await selectProviders('pinterest.download.video', { root: f.root })).length, 0);
  resetRoutingStateForTests();
});

test('static security findings never disclose the matched credential value', async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const secret = 'Bearer abcdef1234567890_super_secret';
  await fs.writeFile(path.join(f.source, 'unsafe.js'), `const token = '${secret}';\nconst result = eval('1 + 1');\n`);
  const analysis = await analyzeContribution(f.source);
  assert.ok(analysis.security.findings.some(item => item.id === 'possible-embedded-credential'));
  assert.ok(analysis.security.findings.some(item => item.id === 'dynamic-code-evaluation'));
  assert.equal(JSON.stringify(analysis).includes(secret), false);
  assert.equal(analysis.security.executionAllowed, false);
});

test('integrity verification catches edits and can verify an archived historical version', async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const firstText = await writeSample(f.source, '-first');
  const first = await intakeContribution({
    source: f.source,
    contributorId: 'friend-history',
    contributionName: 'history-module',
    root: f.root,
  });
  await fs.writeFile(path.join(f.source, 'index.mjs'), firstText.replace('-first', '-second'));
  await intakeContribution({
    source: f.source,
    contributorId: 'friend-history',
    contributionName: 'history-module',
    root: f.root,
  });
  assert.equal((await verifyContribution(first.manifest.contributionId, { root: f.root })).status, 'verified');
  const file = path.join(first.originalDirectory, 'index.mjs');
  await fs.chmod(file, 0o600);
  await fs.writeFile(file, 'tampered');
  assert.equal((await verifyContribution(first.manifest.contributionId, { root: f.root })).status, 'compromised');
});

test('intake obeys bounded owner-configured file limits', async t => {
  const f = await fixture();
  t.after(f.cleanup);
  await fs.mkdir(path.join(f.root, 'config'), { recursive: true });
  await fs.writeFile(path.join(f.root, 'config', 'acie.runtime.json'), JSON.stringify({ intakeLimits: { files: 1 } }));
  await fs.writeFile(path.join(f.source, 'one.js'), 'export const one = 1;');
  await fs.writeFile(path.join(f.source, 'two.js'), 'export const two = 2;');
  await assert.rejects(
    intakeContribution({ source: f.source, contributorId: 'limit-friend', contributionName: 'limited', root: f.root }),
    /Batas ukuran\/jumlah file kontribusi terlampaui/,
  );
});

test('intake preserves empty directories and rejects source mutation during byte verification', async t => {
  const f = await fixture();
  t.after(f.cleanup);
  await writeSample(f.source);
  await fs.mkdir(path.join(f.source, 'empty', 'nested'), { recursive: true });
  await fs.writeFile(path.join(f.source, 'binary.bin'), Buffer.from([0, 1, 2, 255, 0, 13]));
  const result = await intakeContribution({
    source: f.source,
    contributorId: 'friend-tree',
    contributionName: 'tree-preservation',
    root: f.root,
  });
  assert.deepEqual(result.manifest.originalDirectories, ['empty', 'empty/nested']);
  assert.deepEqual(
    await fs.readFile(path.join(result.originalDirectory, 'binary.bin')),
    Buffer.from([0, 1, 2, 255, 0, 13]),
  );
  assert.equal((await verifyContribution(result.manifest.contributionId, { root: f.root })).status, 'verified');
});

test('history anchors cover final manifest and provenance after intake analysis', async t => {
  const f = await fixture();
  t.after(f.cleanup);
  await writeSample(f.source);
  const result = await runContributionIntake(
    { source: f.source, contributorId: 'friend-anchor', contributionName: 'anchor-module' },
    { root: f.root },
  );
  assert.equal(
    (await verifyContribution(result.contribution.manifest.contributionId, { root: f.root })).status,
    'verified',
  );
  const manifestPath = path.join(result.contribution.versionRoot, 'manifest.json');
  const original = await fs.readFile(manifestPath, 'utf8');
  await fs.chmod(manifestPath, 0o600);
  await fs.writeFile(manifestPath, original.replace('PENDING_INFORMATION', 'TAMPERED'));
  const report = await verifyContribution(result.contribution.manifest.contributionId, { root: f.root });
  assert.equal(report.status, 'compromised');
  assert.ok(report.mismatches.some(item => item.path === 'manifest.json'));
});

test('integrity verification detects a modified preserved source archive', async t => {
  const f = await fixture();
  t.after(f.cleanup);
  await fs.writeFile(path.join(f.source, 'index.js'), 'export const value = 1;\n');
  const contribution = await intakeContribution({
    source: f.source,
    contributorId: 'friend-archive',
    contributionName: 'archive-integrity',
    root: f.root,
  });
  const archiveBytes = Buffer.from('immutable-original-zip-payload');
  const archivePath = path.join(contribution.versionRoot, 'source-archive.zip');
  await fs.writeFile(archivePath, archiveBytes, { mode: 0o400 });
  const manifestPath = path.join(contribution.versionRoot, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.sourceArchive = {
    path: 'source-archive.zip',
    bytes: archiveBytes.length,
    sha256: sha256Buffer(archiveBytes),
  };
  await fs.chmod(manifestPath, 0o600);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await refreshContributionHistoryAnchors(contribution.manifest.contributionId, { root: f.root });
  assert.equal((await verifyContribution(contribution.manifest.contributionId, { root: f.root })).status, 'verified');
  await fs.chmod(archivePath, 0o600);
  await fs.writeFile(archivePath, 'tampered zip archive');
  const report = await verifyContribution(contribution.manifest.contributionId, { root: f.root });
  assert.equal(report.status, 'compromised');
  assert.ok(report.mismatches.some(item => item.path === 'source-archive.zip'));
});

test('static credential discovery scans env and key files without returning secret values', async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const secretA = 'ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
  const secretB = 'private_value_9a8b7c6d5e4f';
  await fs.writeFile(path.join(f.source, '.env'), `PUBLIC=hello\nGITHUB_TOKEN=${secretA}\nAPI_KEY=your_api_key_here\n`);
  await fs.writeFile(
    path.join(f.source, 'id_rsa.pem'),
    `-----BEGIN ${'PRIVATE KEY'}-----\n${secretB}\n-----END ${'PRIVATE KEY'}-----\n`,
  );
  const analysis = await analyzeContribution(f.source);
  const findings = analysis.security.findings;
  assert.ok(findings.some(item => item.id === 'github-token'));
  assert.ok(findings.some(item => item.id === 'private-key-marker'));
  assert.equal(JSON.stringify(analysis).includes(secretA), false);
  assert.equal(JSON.stringify(analysis).includes(secretB), false);
});

test('static analysis enforces file and byte budgets and marks partial coverage', async t => {
  const f = await fixture();
  t.after(f.cleanup);
  await fs.writeFile(path.join(f.source, 'one.js'), 'export function first() {}\n');
  await fs.writeFile(path.join(f.source, 'two.js'), 'export function second() {}\n');
  const analysis = await analyzeContribution(f.source, { maxAnalyzedFiles: 1 });
  assert.equal(analysis.analysisCoverage.scannedFiles, 1);
  assert.equal(analysis.analysisCoverage.complete, false);
  assert.equal(analysis.analysisCoverage.skipped.budget, 1);
});

test('worker error summaries never retain exception messages that may contain credentials', async () => {
  await assert.rejects(
    runWorker('integrity-guardian', {}, async () => {
      throw new Error('API_KEY=topsecretvalue');
    }),
  );
  const worker = listWorkers().find(item => item.role === 'integrity-guardian');
  assert.equal(worker.status, 'failed');
  assert.equal(worker.lastError.includes('topsecretvalue'), false);
  assert.equal(worker.lastError.includes('API_KEY'), false);
});

test('static plugin registry scan includes existing aliases to prevent command collisions', async () => {
  const commands = await scanExistingPluginCommands();
  const youtube = commands.find(item => item.name === 'yts');
  assert.ok(youtube);
  assert.ok(youtube.aliases.includes('ytmp3'));
  assert.ok(commands.some(item => item.name === 'acie'));
});

test('ACIE console is private and owner-only; sandbox is fail-closed', () => {
  assert.equal(plugin.name, 'acie');
  assert.equal(plugin.ownerOnly, true);
  assert.equal(plugin.privateOnly, true);
  assert.equal(inspectRuntimeHost().sandbox.available, false);
  assert.throws(
    () => assertSandboxExecutionAllowed({ executionAuthorized: true, sandbox: { approved: true } }),
    /no production sandbox runner/,
  );
});

test('ACIE startup creates private runtime directories and defaults source execution to deny', async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const result = await initializeACIE({ root: f.root });
  assert.equal(result.active, true);
  assert.equal(result.executionEnabled, false);
  const config = JSON.parse(await fs.readFile(path.join(f.root, 'config', 'acie.runtime.json'), 'utf8'));
  assert.equal(config.defaultExecution, 'deny');
  assert.equal(config.intakeLimits.archiveBytes, 1073741824);
  assert.equal(config.analysisLimits.maxAnalyzedFiles, 5000);
  assert.equal(
    (await readACIEAudit({ root: f.root })).some(item => item.event === 'acie.initialized'),
    true,
  );
  const stat = await fs.stat(path.join(f.root, 'contributions', 'vault'));
  assert.ok((stat.mode & 0o077) === 0);
});

test('provider activation remains blocked until every governance and sandbox gate passes', async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const registry = path.join(f.root, 'contributions', 'registry', 'providers.json');
  await fs.mkdir(path.dirname(registry), { recursive: true });
  await fs.writeFile(
    registry,
    JSON.stringify({
      providers: [
        {
          providerId: 'pending-provider',
          status: 'quarantined',
          integrity: 'verified',
          executionAuthorized: false,
          sandbox: { approved: false },
          governance: { licenseReviewed: false },
          validation: { adapterTested: false, outputContractVerified: false },
        },
      ],
    }),
  );
  await assert.rejects(setProviderEnabled('pending-provider', true, { root: f.root }), /belum memenuhi aktivasi/);
  const unchanged = await inspectProvider('pending-provider', { root: f.root });
  assert.equal(unchanged.status, 'quarantined');
  assert.equal(unchanged.activationGate.allowed, false);
  const apparentlyReady = path.join(f.root, 'contributions', 'registry', 'providers.json');
  const store = JSON.parse(await fs.readFile(apparentlyReady, 'utf8'));
  store.providers[0] = {
    ...store.providers[0],
    integrity: 'verified',
    executionAuthorized: true,
    sandbox: { approved: true },
    governance: { licenseReviewed: true, attributionConfirmed: true },
    validation: { adapterReviewed: true, adapterTested: true, protocolTested: true, outputContractVerified: true },
  };
  await fs.writeFile(apparentlyReady, JSON.stringify(store));
  await assert.rejects(setProviderEnabled('pending-provider', true, { root: f.root }), /sandbox-runtime-available/);
});

test('provider error classifier distinguishes permanent and temporary errors', () => {
  assert.equal(classifyProviderError(new Error('HTTP 429 rate limit')).kind, 'rate-limit');
  assert.equal(classifyProviderError(new Error('401 unauthorized')).retryable, false);
  assert.equal(classifyProviderError(new Error('ETIMEDOUT network timeout')).retryable, true);
  assert.equal(classifyProviderError(new Error('invalid input')).kind, 'invalid-input');
});
