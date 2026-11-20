import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('natural-language website request generates a validated project and returns its preview URL', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-website-builder-test-'));
  const previousFetch = globalThis.fetch;
  const previousProjectRoot = process.env.OCHA_PROJECT_LIBRARY_ROOT;
  process.env.OCHA_PROJECT_LIBRARY_ROOT = path.join(temp, 'persistent-project-library');
  const previousKey = process.env.GROQ_API_KEY;
  const previousKeys = Object.fromEntries(['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY'].map(key => [key, process.env[key]]));
  process.chdir(temp);
  process.env.GROQ_API_KEY = 'website-builder-test-key';
  for (const key of Object.keys(previousKeys)) delete process.env[key];
  let capturedBody;
  let replyText = '';
  globalThis.fetch = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    const project = {
      title: 'Demo Portfolio',
      summary: 'Website frontend statis untuk pengujian.',
      files: [
        { path: 'index.html', content: '<!doctype html><html><head><link rel="stylesheet" href="assets/site.css"></head><body><h1>Portfolio</h1><script src="assets/site.js"></script></body></html>' },
        { path: 'assets/site.css', content: 'body{font-family:system-ui}' },
        { path: 'assets/site.js', content: 'console.log("ready")' }
      ]
    };
    return {
      ok: true, status: 200, statusText: 'OK', headers: { get: () => null },
      text: async () => JSON.stringify({ model: 'openai/gpt-oss-20b', choices: [{ message: { content: JSON.stringify(project) } }] })
    };
  };
  try {
    const config = await import(pathToFileURL(path.resolve(original, 'src/config.js')).href);
    await config.loadConfig();
    const engine = await import(pathToFileURL(path.resolve(original, 'src/ai/engine.js')).href);
    const capabilities = await import(pathToFileURL(path.resolve(original, 'src/ai/capability-manager.js')).href);
    const unregister = capabilities.registerAICapability({
      name: 'website_builder', label: 'Test Website Builder', description: 'mock',
      isEnabled: () => true,
      execute: async project => {
        assert.equal(project.fileCount, 3);
        assert.ok(project.files['assets/site.css']);
        return { id: 'test-session', title: project.title, summary: project.summary, fileCount: project.fileCount, totalBytes: project.totalBytes, status: 'completed', previewUrl: 'https://sample.trycloudflare.com/s/test/token', expiresAt: new Date(Date.now() + 3600000).toISOString() };
      }
    });
    await engine.initializeAIHistoryCache();
    const sock = { sendPresenceUpdate: async () => {} };
    const message = {
      chat: '6283193905842@s.whatsapp.net', sender: '6283193905842@s.whatsapp.net',
      body: 'Buatkan website portfolio profesional untuk developer', isGroup: false,
      reply: async text => { replyText = text; return { key: { id: 'website-preview-reply-0001' } }; }
    };
    const result = await engine.answerMessage(sock, message);
    assert.equal(result.capability, 'website_builder');
    assert.equal(capturedBody.max_tokens, 12288);
    assert.match(capturedBody.messages[0].content, /Nexora Website Engineer/);
    assert.match(replyText, /NEXORA PROJECT LIBRARY/);
    assert.match(replyText, /https:\/\/sample\.trycloudflare\.com/);
    assert.match(replyText, /frontend statis/);
    assert.match(replyText, /Repository: demo-portfolio/);
    assert.match(replyText, /secara permanen/);
    const projects = await (await import(pathToFileURL(path.resolve(original, 'src/ai/project-library.js')).href)).listUserProjects({ ownerId: message.sender });
    assert.equal(projects.length, 1);
    assert.equal(projects[0].slug, 'demo-portfolio');
    await new Promise(resolve => setTimeout(resolve, 100));
    unregister();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProjectRoot === undefined) delete process.env.OCHA_PROJECT_LIBRARY_ROOT; else process.env.OCHA_PROJECT_LIBRARY_ROOT = previousProjectRoot;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = previousKey;
    for (const [key, value] of Object.entries(previousKeys)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
