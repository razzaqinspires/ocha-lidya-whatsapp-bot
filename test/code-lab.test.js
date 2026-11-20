import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCodeBlock, extractCodeBlockCandidate, isCodeExecutionIntent, isCodeGenerationIntent, normalizeCodeLanguage } from '../src/runtime/code-lab.js';
import { isWebsiteBuildIntent } from '../src/ai/website-project.js';
import { getAICapabilityStatus, invokeAICapability, registerAICapability } from '../src/ai/capability-manager.js';

test('Code Lab extracts the final fenced code block with its language tag', () => {
  const source = [
    'Contoh pertama:',
    '```python\nprint("old")\n```',
    'Versi yang diminta:',
    '```javascript\nconsole.log("new")\n```'
  ].join('\n');
  assert.deepEqual(extractCodeBlock(source), { language: 'javascript', source: 'console.log("new")' });
});


test('Code Lab extracts complete and truncated fenced blocks from quoted AI replies', () => {
  assert.deepEqual(extractCodeBlockCandidate('```python\nprint(42)\n```'), { language: 'python', source: 'print(42)', complete: true });
  assert.deepEqual(extractCodeBlockCandidate('```python\ndef divide(a, b):\n    if b == 0:'), { language: 'python', source: 'def divide(a, b):\n    if b == 0:', complete: false });
  assert.equal(extractCodeBlockCandidate('no code here'), null);
});

test('Code generation requests receive a larger task budget while ordinary questions do not', () => {
  assert.equal(isCodeGenerationIntent('buatkan implementasi kalkulator'), true);
  assert.equal(isCodeGenerationIntent('buatkan script Python untuk membaca CSV'), true);
  assert.equal(isCodeGenerationIntent('apa fungsi kalkulator?'), false);
  assert.equal(isCodeGenerationIntent('jelaskan apa itu Python'), false);
});

test('Code Lab recognizes supported language aliases and infers Python, Node, or HTML', () => {
  assert.equal(normalizeCodeLanguage('py', 'print(1)'), 'python');
  assert.equal(normalizeCodeLanguage('nodejs', 'console.log(1)'), 'node');
  assert.equal(normalizeCodeLanguage('', '<!doctype html><title>Demo</title>'), 'html');
  assert.equal(normalizeCodeLanguage('', 'def add(a, b):\n    return a + b'), 'python');
  assert.equal(normalizeCodeLanguage('', 'const value = 7;\nconsole.log(value);'), 'node');
  assert.throws(() => normalizeCodeLanguage('bash', 'echo unsafe'), /tidak didukung/);
});

test('Code Lab requires explicit execution intent', () => {
  for (const text of ['coba jalankan', 'tolong run kode ini', 'eksekusi kode tadi', 'buat preview hasilnya', 'uji script ini']) {
    assert.equal(isCodeExecutionIntent(text), true, text);
  }
  for (const text of ['buatkan implementasi kalkulator', 'apa itu Python', 'bagaimana kode ini bekerja', 'tes, suaraku terdengar?', 'uji coba percakapan']) {
    assert.equal(isCodeExecutionIntent(text), false, text);
  }
});

test('Nexora capability registry enforces capability switch before execution', async () => {
  let enabled = false;
  let calls = 0;
  const unregister = registerAICapability({
    name: 'unit-test-capability', label: 'Unit Test', description: 'test',
    isEnabled: () => enabled,
    execute: async input => { calls += 1; return input.value; }
  });
  try {
    assert.equal(getAICapabilityStatus().some(item => item.name === 'unit-test-capability' && !item.enabled), true);
    await assert.rejects(invokeAICapability('unit-test-capability', { value: 3 }, {}), /dinonaktifkan/);
    enabled = true;
    assert.equal(await invokeAICapability('unit-test-capability', { value: 3 }, {}), 3);
    assert.equal(calls, 1);
  } finally {
    unregister();
  }
});


test('Website Builder intent does not hijack ordinary explanatory questions', () => {
  assert.equal(isWebsiteBuildIntent('Buatkan website portofolio dengan halaman kontak'), true);
  assert.equal(isWebsiteBuildIntent('Tolong membuat landing page untuk produk'), true);
  assert.equal(isWebsiteBuildIntent('Apa itu website builder?'), false);
  assert.equal(isWebsiteBuildIntent('Jelaskan struktur website'), false);
});
