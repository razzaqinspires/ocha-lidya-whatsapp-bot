import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('queued provider checkpoints preserve the original job payload for restart recovery', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-ai-checkpoint-recovery-'));
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GROQ_API_KEY;
  const previousOtherKeys = Object.fromEntries(['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY'].map(key => [key, process.env[key]]));
  process.chdir(temp);
  process.env.GROQ_API_KEY = 'checkpoint-test-groq-key';
  for (const key of Object.keys(previousOtherKeys)) delete process.env[key];
  globalThis.fetch = async () => ({
    ok: true, status: 200, statusText: 'OK', headers: { get: () => null },
    text: async () => JSON.stringify({ choices: [{ message: { content: 'Recovered response.' } }] })
  });
  try {
    const database = await import(pathToFileURL(path.resolve(original, 'src/core/database.js')).href);
    await database.initializeDatabase();
    const config = await import(pathToFileURL(path.resolve(original, 'src/config.js')).href);
    await config.loadConfig();
    const job = {
      id: 'job-checkpoint-recovery-1',
      key: '6283193905842@s.whatsapp.net|6283193905842@s.whatsapp.net',
      chat: '6283193905842@s.whatsapp.net',
      sender: '6283193905842@s.whatsapp.net',
      userText: 'test recovery',
      messages: [{ role: 'user', content: 'test recovery' }],
      parentJobId: null, threadId: 'job-checkpoint-recovery-1', depth: 0
    };
    await database.appendRecord('ai.job.checkpoint', { jobId: job.id, status: 'queued', job });
    await database.appendRecord('ai.job.checkpoint', { jobId: job.id, status: 'queued', phase: 'provider_attempt', provider: 'groq' });
    const engine = await import(pathToFileURL(path.resolve(original, 'src/ai/engine.js')).href);
    const deliveries = [];
    await engine.resumePendingAI({ sendMessage: async (chat, payload) => {
      deliveries.push({ chat, text: payload.text });
      return { key: { id: 'recovered-message-id' } };
    } });
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].chat, job.chat);
    assert.match(deliveries[0].text, /Recovered response\./);
    const rows = await database.getRecords({ type: 'ai.job.checkpoint' });
    const latest = rows.filter(row => row.payload.jobId === job.id).at(-1)?.payload;
    assert.equal(latest.status, 'delivered');
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
