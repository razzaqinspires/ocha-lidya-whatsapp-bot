import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCodeBlock, isCodeExecutionIntent, normalizeCodeLanguage } from '../src/runtime/code-lab.js';
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
