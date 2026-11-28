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
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: temp,
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('RESULT:'));
    assert.ok(line, result.stdout);
    const output = JSON.parse(line.slice('RESULT:'.length));
    assert.equal(output.provider, 'gemini');
    assert.equal(output.text, 'Fallback respondeu.');
    assert.deepEqual(
      output.requests.map(item => item.provider),
      ['groq', 'gemini'],
    );
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
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: temp,
      encoding: 'utf8',
      timeout: 20000,
    });
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
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: temp,
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('NETWORK_RESULT:'));
    assert.ok(line, result.stdout);
    const output = JSON.parse(line.slice('NETWORK_RESULT:'.length));
    assert.equal(output.provider, 'gemini');
    assert.deepEqual(output.seen, ['groq', 'gemini']);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('provider router respects a shared total generation deadline', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-ai-budget-test-'));
  const providerUrl = pathToFileURL(path.resolve(original, 'src/ai/providers.js')).href;
  const dbUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
  const source = `
    process.env.GEMINI_API_KEY = 'gemini-budget-key-123456';
    const db = await import(${JSON.stringify(dbUrl)}); await db.initializeDatabase();
    const providers = await import(${JSON.stringify(providerUrl)}); await providers.initializeProviderKeys();
    let requests = 0; globalThis.fetch = async () => { requests++; return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'unexpected' }] } }] }) }; };
    let errorCode = '';
    try { await providers.generateWithFallback(['gemini'], [{ role: 'user', content: 'test' }], { timeoutMs: 1000, deadlineAt: Date.now() - 1000 }); }
    catch (error) { errorCode = error.code; }
    console.log('BUDGET_RESULT:' + JSON.stringify({ requests, errorCode }));
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: temp,
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('BUDGET_RESULT:'));
    assert.ok(line, result.stdout);
    const output = JSON.parse(line.slice('BUDGET_RESULT:'.length));
    assert.equal(output.requests, 0);
    assert.equal(output.errorCode, 'ALL_PROVIDERS_EXHAUSTED');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('ChatNivo is invoked only as the final fallback after every Ocha provider is unavailable', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-chatnivo-final-fallback-'));
  const providerUrl = pathToFileURL(path.resolve(original, 'src/ai/providers.js')).href;
  const dbUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
  const source = `
    process.env.CHATNIVO_EMAIL = 'owner@example.test';
    process.env.CHATNIVO_PASSWORD = 'test-only-password';
    delete process.env.GROQ_API_KEY; delete process.env.GEMINI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY; delete process.env.OPENAI_API_KEY;
    const db = await import(${JSON.stringify(dbUrl)}); await db.initializeDatabase();
    const providers = await import(${JSON.stringify(providerUrl)}); await providers.initializeProviderKeys();
    const requests = []; const checkpoints = [];
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      requests.push({ path, method: options.method || 'GET', hasBearer: Boolean(options.headers?.authorization) });
      if (path === '/api/v1/auths/signin') return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ token: 'session-token-test-only' }) };
      if (path === '/api/v1/models') return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: [{ id: 'chatnivo-fixture-model', name: 'Fixture model' }] }) };
      if (path === '/api/chat/completions') return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { content: 'ChatNivo final fallback berhasil.' }, finish_reason: 'stop' }], usage: { total_tokens: 9 } }) };
      throw new Error('Unexpected ChatNivo route: ' + path);
    };
    const result = await providers.generateWithFallback(['groq', 'gemini', 'deepseek', 'openai'], [{ role: 'user', content: 'uji fallback terakhir' }], {
      timeoutMs: 3000,
      onProviderCheckpoint: event => checkpoints.push(event.phase + ':' + event.provider)
    });
    console.log('CHATNIVO_RESULT:' + JSON.stringify({ provider: result.provider, text: result.text, fallback: result.providerFallback, requests, checkpoints }));
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: temp,
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('CHATNIVO_RESULT:'));
    assert.ok(line, result.stdout);
    const output = JSON.parse(line.slice('CHATNIVO_RESULT:'.length));
    assert.equal(output.provider, 'chatnivo');
    assert.equal(output.text, 'ChatNivo final fallback berhasil.');
    assert.equal(output.fallback.fallbackUsed, true);
    assert.equal(output.fallback.fallbackReason, 'all_primary_providers_exhausted');
    assert.deepEqual(output.fallback.attemptedProviders, ['groq', 'gemini', 'deepseek', 'openai', 'chatnivo']);
    assert.deepEqual(
      output.requests.map(item => item.path),
      ['/api/v1/auths/signin', '/api/v1/models', '/api/chat/completions'],
    );
    assert.ok(output.requests.every(item => item.hasBearer || item.path === '/api/v1/auths/signin'));
    assert.ok(output.checkpoints.includes('provider_attempt:chatnivo'));
    assert.ok(output.checkpoints.includes('provider_succeeded:chatnivo'));
    assert.doesNotMatch(result.stdout, /session-token-test-only|test-only-password/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('ChatNivo catches the final route after cross-provider quota exhaustion', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-chatnivo-quota-fallback-'));
  const providerUrl = pathToFileURL(path.resolve(original, 'src/ai/providers.js')).href;
  const dbUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
  const source = `
    process.env.GROQ_API_KEY = 'groq-quota-fixture-key-123456';
    process.env.GEMINI_API_KEY = 'gemini-quota-fixture-key-123456';
    process.env.CHATNIVO_EMAIL = 'owner@example.test';
    process.env.CHATNIVO_PASSWORD = 'test-only-password';
    const db = await import(${JSON.stringify(dbUrl)}); await db.initializeDatabase();
    const providers = await import(${JSON.stringify(providerUrl)}); await providers.initializeProviderKeys();
    const requests = []; const checkpoints = [];
    globalThis.fetch = async (url, options = {}) => {
      const parsed = new URL(url); requests.push(parsed.hostname + parsed.pathname);
      if (parsed.hostname === 'api.groq.com') return { ok: false, status: 429, statusText: 'Too Many Requests', headers: { get: () => '2' }, text: async () => JSON.stringify({ error: { message: 'rate limit quota exceeded' } }) };
      if (parsed.hostname === 'generativelanguage.googleapis.com') return { ok: false, status: 429, statusText: 'Too Many Requests', headers: { get: () => '2' }, text: async () => JSON.stringify({ error: { message: 'resource exhausted quota exceeded' } }) };
      if (parsed.pathname === '/api/v1/auths/signin') return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ token: 'session-token-test-only' }) };
      if (parsed.pathname === '/api/v1/models') return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: [{ id: 'chatnivo-quota-fixture-model' }] }) };
      if (parsed.pathname === '/api/chat/completions') return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { content: 'Recovered after provider quotas.' } }] }) };
      throw new Error('Unexpected route: ' + parsed.href);
    };
    const result = await providers.generateWithFallback(['groq', 'gemini', 'deepseek', 'openai'], [{ role: 'user', content: 'rate-limit fallback test' }], {
      timeoutMs: 5000,
      onProviderCheckpoint: event => checkpoints.push(event.phase + ':' + event.provider)
    });
    console.log('QUOTA_RESULT:' + JSON.stringify({ provider: result.provider, fallback: result.providerFallback, requests, checkpoints }));
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: temp,
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('QUOTA_RESULT:'));
    assert.ok(line, result.stdout);
    const output = JSON.parse(line.slice('QUOTA_RESULT:'.length));
    assert.equal(output.provider, 'chatnivo');
    assert.equal(output.fallback.fallbackReason, 'all_primary_providers_exhausted');
    assert.deepEqual(output.fallback.attemptedProviders, ['groq', 'gemini', 'deepseek', 'openai', 'chatnivo']);
    assert.ok(output.requests.some(value => value.startsWith('api.groq.com/')));
    assert.ok(output.requests.some(value => value.startsWith('generativelanguage.googleapis.com/')));
    assert.ok(output.requests.includes('app.chatnivo.com/api/chat/completions'));
    assert.ok(output.checkpoints.includes('provider_failed:groq'));
    assert.ok(output.checkpoints.includes('provider_failed:gemini'));
    assert.ok(output.checkpoints.includes('provider_succeeded:chatnivo'));
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
