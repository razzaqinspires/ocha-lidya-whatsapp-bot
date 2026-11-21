import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModelJson, validateCommandDraft, validatePluginSource, buildCommandAuthorPrompt } from '../src/ai/command-author.js';

test('command author parses JSON output with optional code fence', () => {
  assert.deepEqual(parseModelJson('```json\n{"name":"calc"}\n```'), { name: 'calc' });
});
test('command author only accepts existing plugin folders and complete metadata', () => {
  const draft = validateCommandDraft({ name: 'calc', folder: 'general', category: 'general', aliases: ['math'], usage: '<a> <b>', description: 'Calculator', source: "export default { name: 'calc', aliases: ['math'], category: 'general', usage: '<a> <b>', description: 'Calculator', async execute() {} };" }, ['general', 'owner']);
  assert.equal(draft.name, 'calc');
  assert.throws(() => validateCommandDraft({ name: 'calc', folder: 'new-folder', category: 'general', source: "export default { name: 'calc', aliases: ['math'], category: 'general', usage: '<a> <b>', description: 'Calculator', async execute() {} };" }, ['general', 'owner']), /Folder plugin/);
});
test('command author rejects unsafe dynamic execution primitives and unapproved imports', () => {
  assert.throws(() => validatePluginSource("export default { name: 'x', async execute(){ process.exit(1) } }"), /primitive/);
  assert.throws(() => validatePluginSource("import fs from 'some-package'; export default { name: 'x', async execute(){} }"), /allowlist/);
  assert.equal(validatePluginSource("export default { name: 'x', async execute(){} } ").valid, true);
});
test('command author prompt explicitly preserves supplied code and forbids new folders', () => {
  const prompt = buildCommandAuthorPrompt({ instruction: 'polish only', suppliedCode: 'sock.relayMessage(m.chat, payload, {})', plugins: [{ name: 'ping' }], folders: ['general', 'owner'] });
  assert.match(prompt, /jangan memperbaiki atau menulis ulang sintaks/i);
  assert.match(prompt, /DILARANG MEMBUAT FOLDER BARU/);
});
