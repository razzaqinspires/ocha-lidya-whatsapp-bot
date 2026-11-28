import test from 'node:test';
import assert from 'node:assert/strict';
import { getLlamaRuntimeStatus, checkLlamaInstallation } from '../src/ai/llama-runtime.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('local Llama runtime remains dormant when its module is loaded', () => {
  const status = getLlamaRuntimeStatus();
  assert.equal(status.serverRunning, false);
  assert.equal(status.modelAvailable, false);
  assert.equal(status.baseUrl, 'http://127.0.0.1:11434');
  assert.equal(status.model, 'llama3.2:3b');
});

test('Llama preflight only checks the binary and never starts the model server', async () => {
  const before = getLlamaRuntimeStatus();
  const checked = await checkLlamaInstallation();
  const after = getLlamaRuntimeStatus();
  assert.equal(typeof checked.installed, 'boolean');
  assert.equal(after.serverRunning, false);
  assert.equal(after.modelAvailable, false);
  assert.equal(after.startedAt, before.startedAt);
});

test('Llama is ordered after ChatNivo and startup bootstrap does not start or pull a model', () => {
  const providers = fs.readFileSync(path.join(root, 'src/ai/providers.js'), 'utf8');
  assert.ok(providers.indexOf('generateWithChatNivo(messages') < providers.indexOf('generateWithLlama(messages'));
  const bootstrap = fs.readFileSync(path.join(root, 'scripts/bootstrap/llama-runtime.js'), 'utf8');
  assert.doesNotMatch(bootstrap, /spawn\([^\n]*\[\s*['"]serve['"]/);
  assert.doesNotMatch(bootstrap, /ollama['"],\s*\[['"]pull['"]/);
});

test('final local Llama activation starts only on generation, pulls the model lazily, and notifies owner', async t => {
  const { generateWithLlama, setLlamaOwnerNotifier } = await import('../src/ai/llama-runtime.js');
  const temp = fs.mkdtempSync(path.join(root, 'data', 'llama-test-'));
  const fakeBin = path.join(temp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  const executable = path.join(fakeBin, 'ollama');
  const logFile = path.join(temp, 'ollama-args.log');
  fs.writeFileSync(
    executable,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(logFile)}\ncase "$1" in --version) echo 'ollama version test'; exit 0 ;; serve) exit 0 ;; pull) exit 0 ;; *) exit 0 ;; esac\n`,
    { mode: 0o700 },
  );
  fs.chmodSync(executable, 0o700);
  const previousPath = process.env.PATH;
  const previousFetch = globalThis.fetch;
  const notifications = [];
  let tagCalls = 0;
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath || ''}`;
  setLlamaOwnerNotifier(async message => notifications.push(message));
  globalThis.fetch = async url => {
    if (String(url).endsWith('/api/tags')) {
      tagCalls += 1;
      if (tagCalls <= 3) throw new TypeError('Ollama server is not running yet');
      const models = tagCalls === 4 ? [] : [{ name: 'llama3.2:3b', model: 'llama3.2:3b' }];
      return new Response(JSON.stringify({ models }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).endsWith('/api/chat')) {
      return new Response(
        JSON.stringify({ message: { content: 'Jawaban dari Llama lokal.' }, prompt_eval_count: 12, eval_count: 8 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`Unexpected Ollama URL: ${url}`);
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    setLlamaOwnerNotifier(null);
    fs.rmSync(temp, { recursive: true, force: true });
  });

  const result = await generateWithLlama([{ role: 'user', content: 'Halo' }], { timeoutMs: 5000 });
  assert.equal(result.content, 'Jawaban dari Llama lokal.');
  assert.equal(result.provider, 'llama-local');
  assert.ok(tagCalls >= 5, 'server readiness and model catalogue are checked before and after lazy pull');
  assert.ok(notifications.some(message => message.includes('OCHA LLAMA AI DIAKTIFKAN')));
  const args = fs.readFileSync(logFile, 'utf8');
  assert.match(args, /--version/);
  assert.match(args, /serve/);
  assert.match(args, /pull llama3\.2:3b/);
});
