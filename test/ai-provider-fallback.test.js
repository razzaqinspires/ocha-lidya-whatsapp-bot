import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

test('provider account quota stops sibling-key fanout and falls back to Gemini with checkpoints', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-ai-provider-fallback-'));
  const providerUrl = pathToFileURL(path.resolve(original, 'src/ai/providers.js')).href;
  const dbUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
  const source = `
    process.env.GROQ_API_KEY = 'groq-limit-one,groq-limit-two,groq-limit-three';
    process.env.GEMINI_API_KEY = 'gemini-valid-key-123456';
    const db = await import(${JSON.stringify(dbUrl)}); await db.initializeDatabase();
    const providers = await import(${JSON.stringify(providerUrl)}); await providers.initializeProviderKeys();
    const requests = []; const checkpoints = [];
    globalThis.fetch = async (url, options) => {
      const groq = String(url).includes('groq.com');
      const key = groq ? options.headers.authorization : options.headers['x-goog-api-key'];
      requests.push({ provider: groq ? 'groq' : 'gemini', key });
      if (groq) return { ok: false, status: 429, statusText: 'Too Many Requests', headers: { get: () => null }, text: async () => JSON.stringify({ error: { message: 'daily quota exceeded' } }) };
      return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Fallback respondeu.' }] } }], usageMetadata: { totalTokenCount: 7 } }) };
    };
    const result = await providers.generateWithFallback(['groq', 'gemini', 'deepseek', 'openai'], [{ role: 'user', content: 'teste' }], {
      models: { groq: 'test-groq-model', gemini: 'test-gemini-model' }, timeoutMs: 1000,
      onProviderCheckpoint: event => checkpoints.push(event.phase + ':' + event.provider)
    });
    console.log('RESULT:' + JSON.stringify({ provider: result.provider, text: result.text, fallback: result.providerFallback, requests, checkpoints }));
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temp, encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('RESULT:'));
    assert.ok(line, result.stdout);
    const output = JSON.parse(line.slice('RESULT:'.length));
    assert.equal(output.provider, 'gemini');
    assert.equal(output.text, 'Fallback respondeu.');
    assert.deepEqual(output.requests.map(item => item.provider), ['groq', 'gemini']);
    assert.deepEqual(output.requests[0].key, 'Bearer groq-limit-one');
    assert.equal(output.fallback.fallbackUsed, true);
    assert.deepEqual(output.fallback.attemptedProviders, ['groq', 'gemini']);
    assert.ok(output.checkpoints.includes('provider_attempt:groq'));
    assert.ok(output.checkpoints.includes('provider_failed:groq'));
    assert.ok(output.checkpoints.includes('provider_attempt:gemini'));
    assert.ok(output.checkpoints.includes('provider_succeeded:gemini'));
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('provider router skips providers with no keys and continues in configured order', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-ai-provider-skip-'));
  const providerUrl = pathToFileURL(path.resolve(original, 'src/ai/providers.js')).href;
  const dbUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
  const source = `
    process.env.GEMINI_API_KEY = 'gemini-valid-key-123456';
    const db = await import(${JSON.stringify(dbUrl)}); await db.initializeDatabase();
    const providers = await import(${JSON.stringify(providerUrl)}); await providers.initializeProviderKeys();
    globalThis.fetch = async () => ({ ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) });
    const events = [];
    const result = await providers.generateWithFallback(['groq', 'gemini'], [{ role: 'user', content: 'test' }], { timeoutMs: 1000, onProviderCheckpoint: event => events.push(event.phase + ':' + event.provider) });
    console.log('RESULT:' + JSON.stringify({ provider: result.provider, events }));
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temp, encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('RESULT:'));
    assert.ok(line, result.stdout);
    const output = JSON.parse(line.slice('RESULT:'.length));
    assert.equal(output.provider, 'gemini');
    assert.ok(output.events.includes('provider_skipped:groq'));
    assert.ok(output.events.includes('provider_succeeded:gemini'));
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});


test('provider network outage stops sibling-key fanout and advances to next provider', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-ai-network-fallback-'));
  const providerUrl = pathToFileURL(path.resolve(original, 'src/ai/providers.js')).href;
  const dbUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
  const source = `
    process.env.GROQ_API_KEY = Array.from({ length: 10 }, (_, i) => 'groq-network-key-' + i + '-123456').join(',');
    process.env.GEMINI_API_KEY = 'gemini-reachable-key-123456';
    const db = await import(${JSON.stringify(dbUrl)}); await db.initializeDatabase();
    const providers = await import(${JSON.stringify(providerUrl)}); await providers.initializeProviderKeys();
    const seen = [];
    globalThis.fetch = async (url, options) => {
      if (String(url).includes('groq.com')) { seen.push('groq'); throw new TypeError('fetch failed'); }
      seen.push('gemini');
      return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'recovered' }] } }] }) };
    };
    const result = await providers.generateWithFallback(['groq', 'gemini'], [{ role: 'user', content: 'test' }], { timeoutMs: 1000 });
    console.log('NETWORK_RESULT:' + JSON.stringify({ provider: result.provider, seen }));
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temp, encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('NETWORK_RESULT:'));
    assert.ok(line, result.stdout);
    const output = JSON.parse(line.slice('NETWORK_RESULT:'.length));
    assert.equal(output.provider, 'gemini');
    assert.deepEqual(output.seen, ['groq', 'gemini']);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
