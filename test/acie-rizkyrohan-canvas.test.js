import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { analyzeContribution } from '../src/acie/intelligence/static-analysis.js';
import { discoverCapabilities } from '../src/acie/intelligence/capability-discovery.js';
import { discoverImports } from '../src/acie/intelligence/interface-discovery.js';
import { detectModuleSystem } from '../src/acie/intelligence/language-discovery.js';
import { buildCommandDrafts } from '../src/acie/command-engine/command-generation.js';
import { buildLegacyWhatsAppBridgeDraft } from '../src/acie/adapters/legacy-whatsapp-bridge.js';
import { runContributionIntake } from '../src/acie/orchestration/contribution-intake.js';

const FIXTURE_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.private/contributions/rizkyrohan-text-canvas-v1',
);
const SOURCE_PATH = path.join(FIXTURE_ROOT, 'original/index.mjs');
const RECEIPT_PATH = path.join(FIXTURE_ROOT, 'ACIE_RECEIPT.json');
const SOURCE_BUFFER = await fs.readFile(SOURCE_PATH);
const SOURCE = SOURCE_BUFFER.toString('utf8');
const RECEIPT = JSON.parse(await fs.readFile(RECEIPT_PATH, 'utf8'));
const SOURCE_SHA256 = crypto.createHash('sha256').update(SOURCE_BUFFER).digest('hex');

assert.equal(SOURCE_BUFFER.length, RECEIPT.bytes, 'Preserved fixture byte length must match the receipt.');
assert.equal(SOURCE_SHA256, RECEIPT.sha256, 'Preserved fixture SHA-256 must match the receipt.');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'acie-rizky-canvas-'));
  const original = path.join(root, 'original');
  await fs.mkdir(original);
  const sourceFile = path.join(original, 'index.mjs');
  await fs.writeFile(sourceFile, SOURCE_BUFFER);
  const hash = crypto
    .createHash('sha256')
    .update(await fs.readFile(sourceFile))
    .digest('hex');
  assert.equal(hash, SOURCE_SHA256);
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  return { root, original, sourceFile, hash };
}

test('dynamic ESM import is discovered as an undeclared dependency', () => {
  const imports = discoverImports('javascript', "const canvas = await import('@napi-rs/canvas')", 'index.mjs');
  assert.ok(imports.some(item => item.module === '@napi-rs/canvas'));
});

test('.mjs is correctly identified as ESM without package.json', () => {
  assert.equal(detectModuleSystem(['index.mjs'], ["const x = await import('pkg')"]), 'esm');
});

test('Rizkyrohan canvas source discovers only an unverified fixed-text image capability', async t => {
  const f = await fixture(t);
  const analysis = await analyzeContribution(f.original);
  assert.equal(analysis.primaryLanguage, 'javascript');
  assert.equal(analysis.runtime, 'node');
  assert.equal(analysis.moduleSystem, 'esm');
  assert.ok(analysis.dependencies.some(item => item.name === '@napi-rs/canvas' && item.version === 'UNSPECIFIED'));
  assert.equal(analysis.capabilitySignals[0]?.id, 'image-canvas.render.text');
  assert.equal(analysis.capabilitySignals[0]?.inputContract, 'fixed-content-in-source');
  assert.equal(analysis.capabilitySignals[0]?.integration, 'legacy-whatsapp-inline');
  assert.ok(analysis.externalAssetReferences.some(item => item.url.includes('arialnarrow.ttf')));
  const capabilities = discoverCapabilities(analysis);
  assert.equal(capabilities.length, 1);
  assert.equal(capabilities[0].status, 'unverified');
  assert.equal(capabilities[0].dynamicTextInput, false);
});

test('command draft for fixed-text canvas has no invented input parameter', () => {
  const [draft] = buildCommandDrafts({
    contributionId: 'OCHA-CONTRIB-98D54D809967',
    providerId: 'rizkyrohan-text-canvas-generator-v1',
    capabilities: [
      {
        id: 'image-canvas.render.text',
        platform: 'image-canvas',
        action: 'render.text',
        status: 'unverified',
        adapterProtocol: 'legacy-whatsapp-inline-bridge-draft-v1',
      },
    ],
    existingPlugins: [],
  });
  assert.equal(draft.command, 'textimage');
  assert.deepEqual(draft.aliases, ['timg']);
  assert.equal(draft.inputMode, 'none');
  assert.deepEqual(draft.parameters, []);
  assert.equal(draft.status, 'draft-pending-validation');
  assert.equal(draft.outputContract, 'legacy-whatsapp-inline-bridge-draft-v1');
  assert.equal(draft.activation.visibleInUserMenu, false);
});

test('exact contributed source fixture matches the immutable intake receipt', () => {
  assert.equal(SOURCE_BUFFER.length, 3460);
  assert.equal(SOURCE_SHA256, '30e451e96eedfa9c755b5f23f7825e19ea059749707cfd8b5878f72f7b4f4a43');
  assert.ok(SOURCE.includes('const width = 1594'));
  assert.ok(SOURCE.includes('const height = 3200'));
  assert.ok(SOURCE.includes("const content = 'mark tidur, besok ban grup lagi'"));
  assert.ok(SOURCE.includes("GlobalFonts.registerFromPath('./Library/arialnarrow.ttf', 'Arial Narrow')"));
  assert.ok(SOURCE.includes('await conn.sendMessage(m.chat'));
});

test('static analysis does not alter contribution source bytes', async t => {
  const f = await fixture(t);
  await analyzeContribution(f.original);
  const after = crypto
    .createHash('sha256')
    .update(await fs.readFile(f.sourceFile))
    .digest('hex');
  assert.equal(after, f.hash);
});

test('legacy WhatsApp bridge is review-only and never imports or executes original source', () => {
  const draft = buildLegacyWhatsAppBridgeDraft({
    providerId: 'rizkyrohan-text-canvas-generator-v1',
    contributionId: 'OCHA-CONTRIB-98D54D809967',
    analysis: {
      imports: [],
      externalServices: ['whatsapp.com'],
      capabilitySignals: [{ id: 'image-canvas.render.text', evidence: ['createCanvas'] }],
    },
    capability: {
      id: 'image-canvas.render.text',
      integration: 'legacy-whatsapp-inline',
      inputContract: 'fixed-content-in-source',
      outputMimeType: 'image/jpeg',
    },
  });
  assert.equal(draft.status, 'draft-only');
  assert.equal(draft.invocation.mode, 'not-executable');
  assert.deepEqual(draft.invocation.requiredGlobals, ['conn', 'm']);
  assert.equal(draft.security.execute, false);
  assert.ok(draft.blockers.length >= 4);
});

test('full ACIE intake creates a legacy bridge draft and hidden textimage command without executing source', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'acie-rizky-full-intake-'));
  const root = path.join(base, 'project');
  const incoming = path.join(base, 'incoming');
  await fs.mkdir(root);
  await fs.mkdir(incoming);
  await fs.writeFile(path.join(incoming, 'index.mjs'), SOURCE_BUFFER);
  t.after(async () => fs.rm(base, { recursive: true, force: true }));
  const result = await runContributionIntake(
    {
      source: incoming,
      contributorId: 'rizkyrohan',
      contributorName: 'Rizkyrohan',
      contributionName: 'text-canvas-generator',
      projectId: 'ocha-lidya-bot',
      attribution: 'Original implementation credited to Rizkyrohan',
    },
    { root },
  );
  assert.equal(result.activation, 'quarantined-pending-license-sandbox-and-owner-authorization');
  assert.equal(result.capabilities[0]?.id, 'image-canvas.render.text');
  assert.equal(result.provider.status, 'quarantined');
  assert.equal(result.adapter.protocol, 'legacy-whatsapp-inline-bridge-draft-v1');
  assert.equal(result.adapter.status, 'draft-only');
  assert.ok(result.adapter.dependencyCandidates.some(item => item.name === '@napi-rs/canvas'));
  assert.ok(result.adapter.assetReferences.some(item => item.url.includes('arialnarrow.ttf')));
  assert.equal(result.commandDrafts[0]?.command, 'textimage');
  assert.equal(result.commandDrafts[0]?.status, 'draft-pending-validation');
  assert.equal(result.commandDrafts[0]?.activation.visibleInUserMenu, false);
  const preserved = path.join(
    root,
    'contributions',
    'vault',
    'rizkyrohan',
    'text-canvas-generator',
    'versions',
    'v1',
    'original',
    'index.mjs',
  );
  assert.equal(
    crypto
      .createHash('sha256')
      .update(await fs.readFile(preserved))
      .digest('hex'),
    crypto.createHash('sha256').update(SOURCE).digest('hex'),
  );
});
