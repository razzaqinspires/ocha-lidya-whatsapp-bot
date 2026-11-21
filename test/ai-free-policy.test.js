import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const original = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-ai-free-policy-'));
process.chdir(temp);
const db = await import(pathToFileURL(path.resolve(original, 'src/core/database.js')).href);
await db.initializeDatabase();
const providers = await import(pathToFileURL(path.resolve(original, 'src/ai/providers.js')).href);
const oldEnv = Object.fromEntries(['GROQ_API_KEY','GEMINI_API_KEY','DEEPSEEK_API_KEY','OPENAI_API_KEY'].map(key => [key, process.env[key]]));
const oldFetch = globalThis.fetch;

test('free-tier-only fallback skips paid DeepSeek/OpenAI and reaches Gemini after Groq quota', async () => {
  process.env.GROQ_API_KEY = 'groq-free-test-key-0001';
  process.env.GEMINI_API_KEY = 'gemini-free-test-key-0001';
  process.env.DEEPSEEK_API_KEY = 'deepseek-paid-test-key-0001';
  process.env.OPENAI_API_KEY = 'openai-paid-test-key-0001';
  await providers.initializeProviderKeys();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url).includes('groq.com')) return {
      ok: false, status: 429, statusText: 'Too Many Requests',
      headers: { get: () => '3600' }, text: async () => JSON.stringify({ error: { message: 'daily quota exhausted' } })
    };
    if (String(url).includes('generativelanguage.googleapis.com')) return {
      ok: true, status: 200, statusText: 'OK', headers: { get: () => null },
      text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Gemini fallback ready' }] } }], usageMetadata: { totalTokenCount: 8 } })
    };
    throw new Error(`Unexpected paid provider request: ${url}`);
  };
  try {
    const result = await providers.generateWithFallback(['groq','gemini','deepseek','openai'], [{ role: 'user', content: 'ping' }], {
      models: { groq: 'openai/gpt-oss-20b', gemini: 'gemini-4-hydrogen' }, timeoutMs: 1000, freeTierOnly: true
    });
    assert.equal(result.provider, 'gemini');
    assert.equal(result.text, 'Gemini fallback ready');
    assert.equal(calls.length, 2);
    assert.equal(calls.some(url => url.includes('deepseek.com') || url.includes('api.openai.com')), false);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(oldEnv)) value === undefined ? delete process.env[key] : process.env[key] = value;
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
