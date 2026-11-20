import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

test('provider network TypeError with getter-only code is wrapped without mutation failure', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-provider-readonly-code-'));
  const providerUrl = pathToFileURL(path.resolve(original, 'src/ai/providers.js')).href;
  const dbUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
  const source = `
    process.env.GROQ_API_KEY = 'network-test-key';
    const db = await import(${JSON.stringify(dbUrl)}); await db.initializeDatabase();
    const providers = await import(${JSON.stringify(providerUrl)}); await providers.initializeProviderKeys();
    globalThis.fetch = async () => { const error = new TypeError('fetch failed'); Object.defineProperty(error, 'code', { get() { return 'UND_ERR_CONNECT_TIMEOUT'; } }); throw error; };
    try { await providers.generateWithProvider('groq', [{ role: 'user', content: 'test' }], { timeoutMs: 1000, maxKeyAttempts: 1 }); }
    catch (error) { console.log(JSON.stringify({ name: error.name, code: error.code, provider: error.provider, message: error.message })); }
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temp, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('{"name"'));
    assert.ok(line, result.stdout);
    const output = JSON.parse(line);
    assert.equal(output.code, 'NETWORK_ERROR');
    assert.equal(output.provider, 'groq');
    assert.match(output.message, /fetch failed/);
    assert.doesNotMatch(result.stderr + result.stdout, /Cannot set property code/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('provider keys rotate fairly between successful requests', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-provider-key-rotation-'));
  const providerUrl = pathToFileURL(path.resolve(original, 'src/ai/providers.js')).href;
  const dbUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
  const source = `
    process.env.GROQ_API_KEY = 'rotate-key-one,rotate-key-two,rotate-key-three';
    const db = await import(${JSON.stringify(dbUrl)}); await db.initializeDatabase();
    const providers = await import(${JSON.stringify(providerUrl)}); await providers.initializeProviderKeys();
    const seen = []; globalThis.fetch = async (_url, options) => { seen.push(options.headers.authorization); return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) }; };
    for (let index = 0; index < 4; index++) await providers.generateWithProvider('groq', [{ role: 'user', content: String(index) }], { timeoutMs: 1000, maxKeyAttempts: 3 });
    console.log(JSON.stringify(seen));
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temp, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('["Bearer'));
    assert.ok(line, result.stdout);
    assert.deepEqual(JSON.parse(line), ['Bearer rotate-key-one', 'Bearer rotate-key-two', 'Bearer rotate-key-three', 'Bearer rotate-key-one']);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
