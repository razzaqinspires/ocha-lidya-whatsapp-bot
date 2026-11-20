import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCodeExecutionIntent } from '../src/ai/code-execution.js';
import { registerAICapability } from '../src/ai/capability-manager.js';

function createMessage(quotedText) {
  const replies = [];
  return {
    sender: '6280000000000@s.whatsapp.net',
    chat: '6280000000000@s.whatsapp.net',
    quoted: { text: quotedText, key: { id: 'quoted-ai-message' } },
    replies,
    async reply(text) { replies.push(text); }
  };
}

test('execution resolves code from the exact WhatsApp quoted message before history', async () => {
  let captured;
  const unregister = registerAICapability({
    name: 'code_execution', label: 'test runner', description: 'test', isEnabled: () => true,
    execute: async ({ language, source }) => {
      captured = { language, source };
      return { language, status: 'queued', id: '12345678-test', previewUrl: 'https://preview.example/s/test/token', expiresAt: Date.now() + 60_000 };
    }
  });
  try {
    const message = createMessage('Berikut kalkulatornya:\n```python\ndef add(a, b):\n    return a + b\n```');
    const result = await handleCodeExecutionIntent({ message, userText: 'jalankan kode nya', history: [{ role: 'assistant', content: '```node\nconsole.log("wrong")\n```' }] });
    assert.equal(result.handled, true);
    assert.deepEqual(captured, { language: 'python', source: 'def add(a, b):\n    return a + b' });
    assert.match(message.replies[0], /preview\.example/);
  } finally { unregister(); }
});

test('execution completes a truncated code block quoted from the AI reply before invoking worker', async () => {
  let captured;
  let completionInput;
  const unregister = registerAICapability({
    name: 'code_execution', label: 'test runner', description: 'test', isEnabled: () => true,
    execute: async ({ language, source }) => {
      captured = { language, source };
      return { language, status: 'queued', id: '12345678-test', previewUrl: 'https://preview.example/s/test/token', expiresAt: Date.now() + 60_000 };
    }
  });
  try {
    const message = createMessage('```python\ndef divide(a, b):\n    if b == 0:');
    const result = await handleCodeExecutionIntent({
      message, userText: 'jalankan kode nya', history: [],
      completeCode: async input => {
        completionInput = input;
        return '```python\ndef divide(a, b):\n    if b == 0:\n        raise ValueError("division by zero")\n    return a / b\n```';
      }
    });
    assert.equal(result.handled, true);
    assert.match(completionInput.source, /if b == 0:/);
    assert.equal(captured.language, 'python');
    assert.match(captured.source, /return a \/ b/);
  } finally { unregister(); }
});
