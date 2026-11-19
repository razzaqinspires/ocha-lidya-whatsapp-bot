import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWithProvider, getProviderInventory } from '../src/ai/providers.js';

test('Groq adapter normalizes OpenAI-compatible response and rotates configured keys', async () => {
  const previousKey = process.env.GROQ_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = 'test-key-a,test-key-b';
  const seen = [];
  globalThis.fetch = async (_url, options) => {
    seen.push(options.headers.authorization);
    return {
      ok: true, status: 200, statusText: 'OK', headers: { get: () => null },
      text: async () => JSON.stringify({ model: 'openai/gpt-oss-120b', choices: [{ message: { content: '  Ocha siap membantu.  ' } }], usage: { total_tokens: 10 } })
    };
  };
  try {
    const result = await generateWithProvider('groq', [{ role: 'user', content: 'Halo' }], { timeoutMs: 1000 });
    assert.equal(result.text, 'Ocha siap membantu.');
    assert.equal(result.provider, 'groq');
    assert.equal(seen.length, 1);
    assert.match(seen[0], /^Bearer test-key-/);
    const inventory = getProviderInventory({ models: { groq: 'openai/gpt-oss-20b' } }).find(item => item.name === 'groq');
    assert.ok(Number.isInteger(inventory.lastLatencyMs));
    assert.ok(inventory.successes >= 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = previousKey;
  }
});

test('provider retries with the next key after an authentication rejection', async () => {
  const previousKey = process.env.QWEN_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.QWEN_API_KEY = 'invalid-key,valid-key';
  const seen = [];
  globalThis.fetch = async (_url, options) => {
    seen.push(options.headers.authorization);
    if (seen.length === 1) return { ok: false, status: 401, statusText: 'Unauthorized', headers: { get: () => null }, text: async () => '{"error":{"message":"bad key"}}' };
    return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, text: async () => '{"choices":[{"message":{"content":"ok"}}]}' };
  };
  try {
    const result = await generateWithProvider('qwen', [{ role: 'user', content: 'test' }], { timeoutMs: 1000, keyAttempts: 2 });
    assert.equal(result.text, 'ok');
    assert.deepEqual(seen, ['Bearer invalid-key', 'Bearer valid-key']);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.QWEN_API_KEY; else process.env.QWEN_API_KEY = previousKey;
  }
});
