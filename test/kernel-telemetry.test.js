import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-kernel-telemetry-'));
process.env.OCHA_KERNEL_TELEMETRY_FILE = path.join(tempDir, 'telemetry.json');
const telemetry = await import('../src/runtime/kernel-telemetry.js?kernel-telemetry-test');

after(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
  delete process.env.OCHA_KERNEL_TELEMETRY_FILE;
});

test('kernel telemetry records public aggregate message and AI statistics without message content', async () => {
  await telemetry.initializeKernelTelemetry();
  telemetry.setWhatsAppConnection('open');
  telemetry.recordIncomingMessage({ isGroup: false });
  telemetry.recordIncomingMessage({ isGroup: true });
  telemetry.recordBotOutputMessage({ isGroup: false, isReplyTurn: true });
  telemetry.recordBotOutputMessage({ isGroup: true, isReplyTurn: false });

  telemetry.beginAIRequest({ isGroup: false });
  telemetry.finishAIRequest({ outcome: 'response', isGroup: false, latencyMs: 123.4, provider: 'gemini', outputChars: 87 });
  telemetry.beginAIRequest({ isGroup: true });
  telemetry.finishAIRequest({ outcome: 'failure', isGroup: true, latencyMs: 800 });

  const snapshot = telemetry.getKernelTelemetrySnapshot();
  assert.equal(snapshot.counters.incomingMessages, 2);
  assert.equal(snapshot.counters.incomingPrivateMessages, 1);
  assert.equal(snapshot.counters.incomingGroupMessages, 1);
  assert.equal(snapshot.counters.botOutputMessages, 2);
  assert.equal(snapshot.counters.botRespondingTurns, 1);
  assert.equal(snapshot.counters.privateRespondingTurns, 1);
  assert.equal(snapshot.counters.aiRequests, 2);
  assert.equal(snapshot.counters.aiResponses, 1);
  assert.equal(snapshot.counters.aiFailures, 1);
  assert.equal(snapshot.counters.responseCharacters, 87);
  assert.equal(snapshot.providerCounts.gemini, 1);
  assert.equal(snapshot.latency.averageMs, 123.4);
  assert.equal(snapshot.connection.status, 'open');

  await telemetry.flushKernelTelemetry();
  const persisted = await fs.readFile(process.env.OCHA_KERNEL_TELEMETRY_FILE, 'utf8');
  assert.match(persisted, /"incomingMessages": 2/);
  assert.doesNotMatch(persisted, /message body|phone number|@s\.whatsapp\.net|private text/i);
});
