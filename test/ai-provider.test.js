import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const original = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-ai-provider-test-'));
process.chdir(temp);
const database = await import(pathToFileURL(path.resolve(original, 'src/core/database.js')).href);
await database.initializeDatabase();
const providers = await import(pathToFileURL(path.resolve(original, 'src/ai/providers.js')).href);

test('Groq adapter records usage and reports Nexora public identity', async () => {
  const previousKey = process.env.GROQ_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = 'invalid-test-key-a,valid-test-key-b';
  await providers.initializeProviderKeys();
  const seen = [];
  globalThis.fetch = async (_url, options) => {
    seen.push(options.headers.authorization);
    if (seen.length === 1)
      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: { get: () => null },
        text: async () => '{"error":{"message":"invalid API key"}}',
      };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          model: 'openai/gpt-oss-20b',
          choices: [{ message: { content: '  Ocha siap membantu.  ' } }],
          usage: { total_tokens: 10 },
        }),
    };
  };
  try {
    const result = await providers.generateWithProvider('groq', [{ role: 'user', content: 'Halo' }], {
      timeoutMs: 1000,
      publicModel: 'Nexora-2.0-Flash',
    });
    assert.equal(result.text, 'Ocha siap membantu.');
    assert.equal(result.provider, 'groq');
    assert.equal(result.model, 'Nexora-2.0-Flash');
    assert.equal(seen.length, 2);
    assert.deepEqual(seen, ['Bearer invalid-test-key-a', 'Bearer valid-test-key-b']);
    const inventory = providers
      .getProviderInventory({ models: { groq: 'openai/gpt-oss-20b' } })
      .find(item => item.name === 'groq');
    assert.ok(Number.isInteger(inventory.lastLatencyMs));
    assert.ok(inventory.totalHits >= 1);
    assert.ok(inventory.totalSuccesses >= 1);
    assert.ok(inventory.totalTokens >= 10);

    const added = await providers.manageApiKeys('add', 'deepseek', ['sk-' + 'test-deepseek-key-123456']);
    assert.equal(added.added, 1);
    const listed = await providers.manageApiKeys('list', 'deepseek');
    assert.equal(listed.keys.length, 1);
    assert.equal(listed.keys[0].masked.includes('sk-' + 'test-deepseek-key-123456'), false);
    const detail = await providers.manageApiKeys('get', 'deepseek', [listed.keys[0].fingerprint]);
    assert.equal(detail.key.fingerprint, listed.keys[0].fingerprint);
    const deleted = await providers.manageApiKeys('delete', 'deepseek', [listed.keys[0].fingerprint]);
    assert.equal(deleted.removed, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
