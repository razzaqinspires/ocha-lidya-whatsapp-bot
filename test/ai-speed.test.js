import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('AI batches rapid adjacent messages and answers once through the fast provider route', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-ai-speed-test-'));
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GROQ_API_KEY;
  const previousOtherKeys = Object.fromEntries(['GEMINI_API_KEY', 'QWEN_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY'].map(key => [key, process.env[key]]));
  process.chdir(temp);
  process.env.GROQ_API_KEY = 'fast-test-key';
  for (const key of Object.keys(previousOtherKeys)) delete process.env[key];
  let calls = 0;
  let requestBody;
  let replies = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    requestBody = JSON.parse(options.body);
    return {
      ok: true, status: 200, statusText: 'OK', headers: { get: () => null },
      text: async () => JSON.stringify({ model: 'openai/gpt-oss-20b', choices: [{ message: { content: 'Hai, saya siap membantu.' } }] })
    };
  };
  try {
    const config = await import(pathToFileURL(path.resolve(original, 'src/config.js')).href);
    await config.loadConfig();
    const engine = await import(pathToFileURL(path.resolve(original, 'src/ai/engine.js')).href);
    await engine.initializeAIHistoryCache();
    const sock = { sendPresenceUpdate: async () => {} };
    const makeMessage = body => ({
      chat: '6283193905842@s.whatsapp.net',
      sender: '6283193905842@s.whatsapp.net',
      body,
      isGroup: false,
      reply: async () => { replies += 1; }
    });
    const first = engine.answerMessage(sock, makeMessage('Halo'));
    const second = engine.answerMessage(sock, makeMessage('Bisa bantu?'));
    const [a, b] = await Promise.all([first, second]);
    assert.equal(calls, 1, 'rapid messages are sent as one provider request');
    assert.equal(replies, 1, 'one combined turn produces one WhatsApp reply');
    assert.equal(requestBody.messages.at(-1).content, 'Halo\nBisa bantu?');
    assert.equal(a.provider, 'groq');
    assert.equal(b.provider, 'groq');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = previousKey;
    for (const [key, value] of Object.entries(previousOtherKeys)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
