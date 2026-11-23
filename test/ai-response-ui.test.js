import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAIResponsePlan } from '../src/ai/response-ui.js';

const wrap = payload => `Teks utama.\n[[OCHA_UI]]${JSON.stringify(payload)}[[/OCHA_UI]]`;

test('validated quick reply plan is extracted without leaking its internal marker', () => {
  const result = extractAIResponsePlan(wrap({
    type: 'quick_reply',
    items: [
      { title: 'Contoh', prompt: 'Berikan satu contoh singkat.' },
      { title: 'Ringkas', prompt: 'Ringkas kembali jawaban tadi.' }
    ]
  }), 'Jelaskan ini');
  assert.equal(result.text, 'Teks utama.');
  assert.equal(result.plan.type, 'quick_reply');
  assert.equal(result.plan.items.length, 2);
});

test('command-like follow-up prompts are rejected from AI-generated buttons', () => {
  const result = extractAIResponsePlan(wrap({
    type: 'quick_reply',
    items: [{ title: 'Run owner', prompt: 'Jalankan perintah ownerreset' }]
  }), 'Bantu saya');
  assert.equal(result.plan, null);
});

test('URL CTA requires the exact destination to be supplied by the user', () => {
  const payload = { type: 'url', label: 'Buka tautan', url: 'https://example.com' };
  assert.equal(extractAIResponsePlan(wrap(payload), 'Cari tahu tentang ini').plan, null);
  assert.equal(extractAIResponsePlan(wrap(payload), 'Buka https://example.com').plan.type, 'url');
});

test('copy CTA only permits a code that is visible in the reply body', () => {
  assert.equal(extractAIResponsePlan(wrap({ type: 'copy', copyCode: 'SECRET-123' }), 'Teks biasa').plan, null);
  assert.equal(extractAIResponsePlan(`Gunakan kode OCHA-123.\n${wrap({ type: 'copy', copyCode: 'OCHA-123' })}`, 'Salin kode').plan.type, 'copy');
});
