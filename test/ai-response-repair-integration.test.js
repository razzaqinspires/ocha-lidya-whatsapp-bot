import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const projectRoot = process.cwd();
const urls = Object.fromEntries(['src/config.js', 'src/core/database.js', 'src/ai/providers.js', 'src/ai/engine.js'].map(file => [file, pathToFileURL(path.resolve(projectRoot, file)).href]));

async function runScenario(responses) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-ai-response-repair-'));
  const source = `
    const config = await import(${JSON.stringify(urls['src/config.js'])});
    await config.loadConfig();
    const db = await import(${JSON.stringify(urls['src/core/database.js'])});
    await db.initializeDatabase();
    const providers = await import(${JSON.stringify(urls['src/ai/providers.js'])});
    await providers.initializeProviderKeys();
    const engine = await import(${JSON.stringify(urls['src/ai/engine.js'])});
    await engine.initializeAIHistoryCache();
    const responses = ${JSON.stringify(responses)};
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push(JSON.parse(options.body));
      const text = responses[Math.min(requests.length - 1, responses.length - 1)];
      return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }) };
    };
    const sent = [];
    const sock = { sendPresenceUpdate: async () => {} };
    const message = {
      chat: '6283193905842@s.whatsapp.net', sender: '6283193905842@s.whatsapp.net',
      body: 'Bagaimana keadaan Gaza hari ini?', isGroup: false, id: 'gaza-test', key: { id: 'gaza-test' },
      reply: async text => { sent.push(text); return { key: { id: 'reply-' + sent.length } }; }
    };
    const result = await engine.answerMessage(sock, message);
    await engine.flushAIPersistenceWrites();
    console.log(JSON.stringify({ sent, calls: requests.length, lastPrompt: requests.at(-1)?.messages?.at(-1)?.content || '', provider: result?.provider || null }));
  `;
  try {
    const env = { ...process.env, GROQ_API_KEY: 'response-repair-test-key' };
    for (const key of ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY']) delete env[key];
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temp, encoding: 'utf8', timeout: 25_000, env });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('{"sent"'));
    assert.ok(line, result.stdout);
    return JSON.parse(line);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

test('generic AI answer is corrected once before WhatsApp delivery', async () => {
  const outcome = await runScenario([
    'Apa yang ingin kamu lakukan hari ini?',
    'Saya belum memiliki sumber berita langsung pada giliran ini untuk memverifikasi keadaan Gaza hari ini. Saya tidak akan mengarang perkembangan terbaru.'
  ]);
  assert.equal(outcome.calls, 2, 'one repair attempt is made after the generic response');
  assert.match(outcome.lastPrompt, /KOREKSI JAWABAN/);
  assert.equal(outcome.sent.length, 1);
  assert.match(outcome.sent[0], /memverifikasi keadaan Gaza hari ini/);
  assert.doesNotMatch(outcome.sent[0], /Apa yang ingin kamu lakukan hari ini/);
});

test('persistent generic output is replaced with a truthful topic-preserving fallback', async () => {
  const outcome = await runScenario([
    'Apa yang ingin kamu lakukan hari ini?',
    'Apa yang ingin kamu lakukan hari ini?'
  ]);
  assert.equal(outcome.calls, 2, 'repair is bounded to one attempt');
  assert.equal(outcome.sent.length, 1);
  assert.match(outcome.sent[0], /Gaza/);
  assert.match(outcome.sent[0], /real-time/);
  assert.doesNotMatch(outcome.sent[0], /Apa yang ingin kamu lakukan hari ini/);
});
