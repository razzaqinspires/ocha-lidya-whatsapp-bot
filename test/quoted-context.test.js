import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuotedAIContext, shouldUseGreetingShortcut, isGenericGreetingResponse } from '../src/ai/quoted-context.js';

test('a short reply such as "ini" retains the quoted assistant message', () => {
  const context = buildQuotedAIContext({
    body: 'ini',
    quoted: { key: { id: 'quoted-1' }, type: 'extendedTextMessage', text: 'Coba lihat sirkuitmu' }
  });
  assert.equal(context.userText, 'ini');
  assert.equal(context.hasQuotedMessage, true);
  assert.match(context.quotedContext, /Coba lihat sirkuitmu/);
  assert.equal(shouldUseGreetingShortcut(context.userText, context.hasQuotedMessage), false);
});

test('a quoted-only reply becomes a contextual AI request instead of empty/greeting input', () => {
  const context = buildQuotedAIContext({
    body: '',
    quoted: { key: { id: 'quoted-2' }, type: 'conversation', text: 'Status kernel sedang aktif.' }
  });
  assert.equal(context.userText, 'Tolong tanggapi pesan yang saya kutip.');
  assert.match(context.quotedContext, /Status kernel sedang aktif/);
  assert.equal(shouldUseGreetingShortcut(context.userText, true), false);
});

test('normal greeting shortcut is retained only when there is no quoted message', () => {
  assert.equal(shouldUseGreetingShortcut('halo', false), true);
  assert.equal(shouldUseGreetingShortcut('halo', true), false);
  const empty = buildQuotedAIContext({ body: 'halo', quoted: null });
  assert.equal(empty.quotedContext, '');
});

test('generic greeting-only AI output is detected so quoted replies cannot loop on hello', () => {
  assert.equal(isGenericGreetingResponse('Hai Arifi, ada yang bisa saya bantu hari ini?'), true);
  assert.equal(isGenericGreetingResponse('Halo. Ada yang ingin kamu tanyakan?'), true);
  assert.equal(isGenericGreetingResponse('Sirkuit fisik tidak saya miliki; saya berjalan sebagai perangkat lunak.'), false);
  assert.equal(isGenericGreetingResponse('Halo, sirkuit apa yang kamu maksud? Saya perlu konteks teknisnya.'), false);
});

test('quoted generic greeting fallback handles the circuit inspection example directly', async () => {
  const { buildQuotedFallbackResponse } = await import('../src/ai/quoted-context.js');
  const response = buildQuotedFallbackResponse({ userText: 'ini', quoteText: 'Coba lihat sirkuitmu', quoteType: 'extendedTextMessage' });
  assert.match(response, /tidak memiliki sirkuit atau komponen fisik/i);
  assert.match(response, /Kernel, koneksi, modul/i);
  assert.doesNotMatch(response, /ada yang bisa saya bantu/i);
});

test('quoted generic greeting fallback retains the quote without pretending to inspect it', async () => {
  const { buildQuotedFallbackResponse } = await import('../src/ai/quoted-context.js');
  const response = buildQuotedFallbackResponse({ userText: 'ini', quoteText: 'Tolong jelaskan gambar ini', quoteType: 'imageMessage' });
  assert.match(response, /Tolong jelaskan gambar ini/);
  assert.match(response, /belum menjawab permintaanmu/i);
});
