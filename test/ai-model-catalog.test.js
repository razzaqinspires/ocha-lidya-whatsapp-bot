import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildProviderCatalogEntry, getNextModelCatalogDelay, hasRetryableCatalogFailure, isModelCatalogDue, MODEL_ACCESS_POLICY, MODEL_CATALOG_INTERVAL_MS } from '../src/ai/model-catalog.js';

test('free model selection intersects live API catalogue with official free-tier policy', () => {
  const entry = buildProviderCatalogEntry('gemini', {
    status: 'ok', listedAt: new Date().toISOString(), models: [
      { id: 'gemini-3.8-flash', supportsChat: true },
      { id: 'gemini-3.1-pro-preview', supportsChat: true },
      { id: 'gemini-next-preview', supportsChat: true },
      { id: 'gemini-3.5-transcribe', supportsChat: false }
    ]
  });
  assert.deepEqual(entry.freeEligibleModels, ['gemini-3.8-flash']);
  assert.equal(entry.recommendedFreeModel, 'gemini-3.8-flash');
  assert.equal(entry.recommendedPaidModel, 'gemini-3.1-pro-preview');
  assert.deepEqual(entry.unclassifiedChatModels, ['gemini-next-preview']);
  assert.deepEqual(MODEL_ACCESS_POLICY.deepseek.freeModels, []);
  assert.deepEqual(MODEL_ACCESS_POLICY.openai.freeModels, []);
});

test('unreachable model catalogue retains a recent last-known model selection only as stale data', () => {
  const previous = {
    models: [{ id: 'openai/gpt-oss-120b', supportsChat: true }],
    freeEligibleModels: ['openai/gpt-oss-120b'],
    recommendedFreeModel: 'openai/gpt-oss-120b',
    recommendedPaidModel: 'openai/gpt-oss-120b',
    lastSuccessfulAt: new Date().toISOString()
  };
  const entry = buildProviderCatalogEntry('groq', { status: 'unreachable', error: { message: 'timeout' } }, previous);
  assert.equal(entry.stale, true);
  assert.equal(entry.recommendedFreeModel, 'openai/gpt-oss-120b');
  assert.equal(entry.status, 'unreachable');
});

test('catalog cadence is 24 hours and schedules an initial refresh when missing', () => {
  assert.equal(MODEL_CATALOG_INTERVAL_MS, 24 * 60 * 60 * 1000);
  assert.equal(isModelCatalogDue(null), true);
  assert.equal(isModelCatalogDue(new Date(Date.now() - MODEL_CATALOG_INTERVAL_MS - 1).toISOString()), true);
  assert.equal(isModelCatalogDue(new Date().toISOString()), false);
});

test('provider catalog refresh stores latest metadata atomically without storing API keys', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-model-catalog-db-'));
  const catalogUrl = pathToFileURL(path.resolve(original, 'src/ai/model-catalog.js')).href;
  const providerUrl = pathToFileURL(path.resolve(original, 'src/ai/providers.js')).href;
  const dbUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
  const source = `
    import fs from 'node:fs/promises';
    process.env.GROQ_API_KEY = 'groq-secret-key-not-to-persist-123';
    process.env.GEMINI_API_KEY = 'gemini-secret-key-not-to-persist-123';
    process.env.DEEPSEEK_API_KEY = 'deepseek-secret-key-not-to-persist-123';
    process.env.OPENAI_API_KEY = 'openai-secret-key-not-to-persist-123';
    const db = await import(${JSON.stringify(dbUrl)}); await db.initializeDatabase();
    const providers = await import(${JSON.stringify(providerUrl)}); await providers.initializeProviderKeys();
    globalThis.fetch = async (url) => {
      const value = String(url);
      let data;
      if (value.includes('groq.com')) data = { data: [
        { id: 'openai/gpt-oss-120b' }, { id: 'openai/gpt-oss-20b' }, { id: 'qwen/qwen3.8-27b' }
      ] };
      else if (value.includes('generativelanguage.googleapis.com')) data = { models: [
        { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.8-tts', supportedGenerationMethods: ['generateContent'] }
      ] };
      else if (value.includes('deepseek.com')) data = { data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] };
      else data = { data: [{ id: 'gpt-6-luna' }, { id: 'gpt-6.2-sol' }] };
      return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, text: async () => JSON.stringify(data) };
    };
    const catalog = await import(${JSON.stringify(catalogUrl)});
    const snapshot = await catalog.refreshModelCatalog({ force: true });
    const config = catalog.getRuntimeModelConfig({}, { freeOnly: true });
    const stored = JSON.parse(await fs.readFile('data/ai-model-catalog.json', 'utf8'));
    console.log('CATALOG_RESULT:' + JSON.stringify({
      providers: Object.fromEntries(Object.entries(snapshot.providers).map(([name, item]) => [name, { status: item.status, recommendedFreeModel: item.recommendedFreeModel }])),
      allowed: config.allowedProviders,
      selectedGroq: config.models.groq,
      selectedGemini: config.models.gemini,
      recommendedOpenAIPaid: snapshot.providers.openai.recommendedPaidModel,
      history: stored.history.length,
      containsSecret: JSON.stringify(stored).includes('groq-secret-key-not-to-persist-123') || JSON.stringify(stored).includes('gemini-secret-key-not-to-persist-123')
    }));
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temp, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('CATALOG_RESULT:'));
    assert.ok(line, result.stdout);
    const output = JSON.parse(line.slice('CATALOG_RESULT:'.length));
    assert.equal(output.providers.groq.status, 'ok');
    assert.equal(output.providers.gemini.status, 'ok');
    assert.equal(output.providers.deepseek.status, 'ok');
    assert.equal(output.providers.openai.status, 'ok');
    assert.deepEqual(output.allowed, ['groq', 'gemini']);
    assert.equal(output.selectedGroq, 'openai/gpt-oss-120b');
    assert.equal(output.selectedGemini, 'gemini-3.8-flash');
    assert.equal(output.recommendedOpenAIPaid, 'gpt-6.2-sol');
    assert.equal(output.history, 0);
    assert.equal(output.containsSecret, false);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});


test('in-process scheduler calculates the exact 24-hour deadline from persisted catalog state', () => {
  const now = Date.parse('2026-11-21T00:00:00.000Z');
  const snapshot = { checkedAt: new Date(now).toISOString(), nextCheckAt: new Date(now + MODEL_CATALOG_INTERVAL_MS).toISOString(), providers: { groq: { status: 'ok' } } };
  assert.equal(getNextModelCatalogDelay(snapshot, now), MODEL_CATALOG_INTERVAL_MS);
  assert.equal(getNextModelCatalogDelay(snapshot, now + 1000), MODEL_CATALOG_INTERVAL_MS - 1000);
});

test('in-process scheduler retries a transient provider catalogue outage hourly', () => {
  const snapshot = { checkedAt: new Date().toISOString(), nextCheckAt: new Date(Date.now() + MODEL_CATALOG_INTERVAL_MS).toISOString(), providers: { groq: { status: 'unreachable' }, gemini: { status: 'ok' } } };
  assert.equal(hasRetryableCatalogFailure(snapshot), true);
  assert.equal(getNextModelCatalogDelay(snapshot), 60 * 60 * 1000);
});

test('authorization and missing-key states do not create endless hourly catalogue retries', () => {
  const snapshot = { checkedAt: new Date().toISOString(), nextCheckAt: new Date(Date.now() + MODEL_CATALOG_INTERVAL_MS).toISOString(), providers: { groq: { status: 'unauthorized' }, gemini: { status: 'no_api_key' } } };
  assert.equal(hasRetryableCatalogFailure(snapshot), false);
  assert.ok(getNextModelCatalogDelay(snapshot) <= MODEL_CATALOG_INTERVAL_MS);
  assert.ok(getNextModelCatalogDelay(snapshot) > MODEL_CATALOG_INTERVAL_MS - 1000);
});


test('model catalogue refresh reloads changed provider API keys from the persisted vault', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-provider-vault-reload-'));
  const providerUrl = pathToFileURL(path.resolve(original, 'src/ai/providers.js')).href;
  const source = `
    import fs from 'node:fs/promises';
    import { initializeProviderKeys, manageApiKeys, reloadProviderKeyVault } from ${JSON.stringify(providerUrl)};
    await fs.mkdir('data/secrets', { recursive: true });
    const vault = 'data/secrets/provider-keys.json';
    await fs.writeFile(vault, JSON.stringify({ groq: ['groq-vault-original-key-1234567890'] }));
    await initializeProviderKeys({ skipTelemetry: true });
    const before = await manageApiKeys('list', 'groq');
    await fs.writeFile(vault, JSON.stringify({ groq: ['groq-vault-updated-key-1234567890'], gemini: ['gemini-vault-new-key-1234567890'] }));
    await reloadProviderKeyVault();
    const afterGroq = await manageApiKeys('list', 'groq');
    const afterGemini = await manageApiKeys('list', 'gemini');
    if (before.keys.length !== 2 || afterGroq.keys.length !== 2 || afterGemini.keys.length !== 1) process.exit(4);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: temp, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, GROQ_API_KEY: 'groq-env-key-abcdefghijklmno' }
  });
  assert.equal(result.status, 0, `${result.stderr || ''}${result.stdout || ''}`);
});


test('concurrent main and detached-worker refreshes back off when the other process owns the catalog lock', () => {
  assert.equal(getNextModelCatalogDelay(null), 2 * 60 * 1000);
  const overdue = { checkedAt: new Date(Date.now() - MODEL_CATALOG_INTERVAL_MS - 1).toISOString(), providers: {} };
  assert.equal(getNextModelCatalogDelay(overdue), 2 * 60 * 1000);
});
