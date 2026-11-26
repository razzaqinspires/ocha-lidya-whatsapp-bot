import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVAL_TEXT_FILE_THRESHOLD,
  shouldSendEvalAsTextFile,
  renderEvalConsoleOutput,
  deliverEvalOutput,
} from '../src/master/eval-output.js';

test('eval console template is visible by default', () => {
  const result = renderEvalConsoleOutput('menu');
  assert.match(result, /^╭─ OCHA MASTER CONSOLE · JAVASCRIPT/);
  assert.match(result, /\nmenu\n/);
  assert.match(result, /╰──────────────────────────────────────────$/);
});

test('eval console template can be hidden without changing output', () => {
  assert.equal(renderEvalConsoleOutput('menu', false), 'menu');
});

test('eval output at or below 30,000 characters stays inline', () => {
  assert.equal(shouldSendEvalAsTextFile('x'.repeat(EVAL_TEXT_FILE_THRESHOLD)), false);
  assert.equal(shouldSendEvalAsTextFile('x'.repeat(EVAL_TEXT_FILE_THRESHOLD - 1)), false);
});

test('eval output above 30,000 characters is routed to TXT', () => {
  assert.equal(shouldSendEvalAsTextFile('x'.repeat(EVAL_TEXT_FILE_THRESHOLD + 1)), true);
});

test('eval output below threshold is replied inline', async () => {
  const replies = [];
  let sent = false;
  const result = await deliverEvalOutput({
    sock: {
      async sendMessage() {
        sent = true;
      },
    },
    message: {
      chat: 'owner@s.whatsapp.net',
      async reply(value) {
        replies.push(value);
      },
    },
    text: 'menu',
  });
  assert.equal(result.mode, 'inline');
  assert.deepEqual(replies, ['menu']);
  assert.equal(sent, false);
});

test('eval output above threshold is sent as a complete quoted TXT document', async () => {
  const output = 'x'.repeat(EVAL_TEXT_FILE_THRESHOLD + 1);
  const quoted = { key: { id: 'original-eval-message' } };
  let payload;
  let options;
  const replies = [];
  const result = await deliverEvalOutput({
    sock: {
      async sendMessage(chat, content, sendOptions) {
        payload = { chat, content };
        options = sendOptions;
      },
    },
    message: {
      chat: 'owner@s.whatsapp.net',
      raw: quoted,
      async reply(value) {
        replies.push(value);
      },
    },
    text: output,
  });
  assert.equal(result.mode, 'text-file');
  assert.equal(payload.chat, 'owner@s.whatsapp.net');
  assert.equal(payload.content.mimetype, 'text/plain');
  assert.equal(payload.content.document.toString('utf8'), output);
  assert.match(payload.content.fileName, /^ocha-eval-output-.*\.txt$/);
  assert.equal(options.quoted, quoted);
  assert.equal(replies.length, 0);
});
