import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKernelStatus, executeKernelCommand } from '../src/plugins/general/kernel.js';

test('kernel status formats a safe public telemetry summary', () => {
  const body = buildKernelStatus({
    connection: { whatsapp: { status: 'open' }, nadi: { ready: true, ticks: 120 } },
    totals: { incomingMessages: 10, botRespondingTurns: 8, botOutputMessages: 9, aiResponses: 7, aiFailures: 1 }
  });
  assert.match(body, /WhatsApp: \*open\*/);
  assert.match(body, /NADI: \*READY\*/);
  assert.match(body, /Pesan masuk: \*10\*/);
  assert.match(body, /isi chat, nomor, JID, dan memori privat tidak dipublikasikan/i);
});

test('kernel command acknowledges before waiting for the public tunnel and then sends the WebView action', async () => {
  const events = [];
  const m = {
    chat: 'user@s.whatsapp.net',
    async reply(text) { events.push({ type: 'reply', text }); return { key: { id: 'ack-1' } }; }
  };
  const sock = {
    async sendInteractive(chat, options) {
      events.push({ type: 'interactive', chat, options });
      return { key: { id: 'interactive-1' } };
    }
  };
  const result = await executeKernelCommand({
    sock, m,
    publish: async () => {
      events.push({ type: 'publish' });
      return { url: 'https://kernel.example.test/kernel/token' };
    }
  });
  assert.equal(events[0].type, 'reply');
  assert.match(events[0].text, /menyiapkan WebView publik/);
  assert.equal(events[1].type, 'publish');
  assert.equal(events[2].type, 'interactive');
  assert.match(events[2].options.body, /https:\/\/kernel\.example\.test/);
  assert.equal(result.key.id, 'interactive-1');
});

test('kernel command replies with a useful diagnostic if the tunnel cannot start', async () => {
  const replies = [];
  const m = { chat: 'user@s.whatsapp.net', async reply(text) { replies.push(text); return { key: { id: `reply-${replies.length}` } }; } };
  const result = await executeKernelCommand({ sock: {}, m, publish: async () => { throw new Error('cloudflared missing'); } });
  assert.equal(replies.length, 2);
  assert.match(replies[0], /menyiapkan WebView publik/);
  assert.match(replies[1], /KERNEL WEBVIEW BELUM TERSEDIA/);
  assert.match(replies[1], /cloudflared missing/);
  assert.equal(result.key.id, 'reply-2');
});
