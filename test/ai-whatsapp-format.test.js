import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAITextForWhatsApp, splitWhatsAppText, inspectAICompletion } from '../src/ai/whatsapp-format.js';

test('AI renderer converts Markdown emphasis and headings to WhatsApp syntax', () => {
  const output = formatAITextForWhatsApp('**Tebal** _miring_ ~~coret~~\n# Judul\n__tebal lain__');
  assert.match(output, /\*Tebal\*/);
  assert.match(output, /_miring_/);
  assert.match(output, /~coret~/);
  assert.match(output, /\*Judul\*/);
  assert.match(output, /\*tebal lain\*/);
  assert.doesNotMatch(output, /\*\*/);
  assert.doesNotMatch(output, /__/);
});

test('AI renderer turns Markdown links and tables into readable WhatsApp text', () => {
  const output = formatAITextForWhatsApp('[Repository](https://github.com/razzaqinspires)\n\n| Nama | Status |\n| --- | --- |\n| Ocha | Aktif |');
  assert.match(output, /Repository: https:\/\/github\.com\/razzaqinspires/);
  assert.match(output, /Nama\s+·\s+Status/);
  assert.match(output, /Ocha\s+·\s+Aktif/);
  assert.doesNotMatch(output, /\]\(https:/);
});

test('code blocks are protected from emphasis conversion and are closed when model output is incomplete', () => {
  const output = formatAITextForWhatsApp('```js\nconst marker = "**literal**";');
  assert.match(output, /```\nconst marker = "\*\*literal\*\*";\n```/);
  assert.equal((output.match(/```/g) || []).length % 2, 0);
});

test('long AI messages split below WhatsApp chunk limit and code fences remain balanced', () => {
  const source = `Intro\n\n\`\`\`js\n${'const value = 42;\n'.repeat(110)}\`\`\`\n\nOutro`;
  const parts = splitWhatsAppText(source, 600);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => part.length <= 600));
  assert.ok(parts.every(part => (part.match(/```/g) || []).length % 2 === 0));
  assert.match(parts.at(-1), /Outro/);
});

test('completion inspector detects provider cap and unclosed structured output', () => {
  assert.equal(inspectAICompletion('Jawaban selesai.', 'stop').truncated, false);
  assert.equal(inspectAICompletion('```js\nconst x = 1;', 'stop').truncated, true);
  assert.equal(inspectAICompletion('{"ok": true', 'stop').truncated, true);
  assert.equal(inspectAICompletion('Jawaban apa pun', 'length').truncated, true);
});
