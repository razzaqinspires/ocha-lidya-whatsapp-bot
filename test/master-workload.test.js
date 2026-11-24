import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectWorkload, shouldAutoApproveAssessment, createConfirmationCode } from '../src/master/workload-tracker.js';

test('WorkloadTracker lets ordinary owner eval through without AI review', () => {
  const result = inspectWorkload('>', 'console.log(sock.user.id); await m.reply("hello");');
  assert.equal(result.level, 'low'); assert.equal(result.suspicious, false); assert.equal(result.hardBlock, false);
});
test('WorkloadTracker requires explicit owner confirmation for every suspicious workload', () => {
  const result = inspectWorkload('=>', 'process.memoryUsage(); await sock.relayMessage(m.chat, payload, {});');
  assert.equal(result.hardBlock, false);
  assert.equal(result.suspicious, true);
  assert.equal(result.requiresConfirmation, true);
});

test('WorkloadTracker escalates scoped recursive deletion for AI and confirmation', () => {
  const result = inspectWorkload('$', 'rm -rf ./*/');
  assert.equal(result.suspicious, true); assert.equal(result.hardBlock, false); assert.equal(result.requiresConfirmation, true); assert.ok(['medium', 'high'].includes(result.level));
});
test('WorkloadTracker blocks filesystem-root deletion and disk destructive commands', () => {
  for (const source of ['rm -rf /', 'mkfs.ext4 /dev/sda1', 'dd if=/dev/zero of=/dev/sda']) {
    const result = inspectWorkload('$', source); assert.equal(result.hardBlock, true, source); assert.equal(result.level, 'critical');
  }
});
test('WorkloadTracker detects language-specific filesystem/process APIs', () => {
  assert.equal(inspectWorkload('>>', 'import shutil; shutil.rmtree("./data")').suspicious, true);
  assert.equal(inspectWorkload('>>>', 'os.RemoveAll("./data")').suspicious, true);
  assert.equal(inspectWorkload('>', 'fs.rmSync("./data", { recursive: true })').suspicious, true);
});
test('confirmation codes are short uppercase hex tokens', () => assert.match(createConfirmationCode(), /^[A-F0-9]{6}$/));
test('owner JavaScript eval exposes live sock, m, config, and db runtime references', async () => {
  const original = process.cwd(); const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-master-context-'));
  process.chdir(temporary);
  try {
    const config = await import(pathToFileURL(path.resolve(original, 'src/config.js')).href);
    await config.loadConfig(); await config.updateConfig(value => { value.security.masterEvalEnabled = true; });
    const master = await import(pathToFileURL(path.resolve(original, 'src/master/dispatcher.js')).href);
    const replies = []; const sock = { user: { id: '6282177461231@s.whatsapp.net' } };
    const m = { sender: '6283193905842@s.whatsapp.net', reply: async value => { replies.push(String(value)); return { key: { id: 'test-result' } }; } };
    await master.runMasterCommand(sock, m, '=> ({ sockId: sock.user.id, sender: m.sender, mode: config.mode, hasAppendRecord: typeof db.appendRecord })');
    assert.match(replies.at(-1), /6282177461231@s\.whatsapp\.net/);
    assert.match(replies.at(-1), /6283193905842@s\.whatsapp\.net/);
    assert.match(replies.at(-1), /hasAppendRecord/);
  } finally { process.chdir(original); await fs.rm(temporary, { recursive: true, force: true }); }
});

test('Ocha only auto-approves explicit low/medium ALLOW assessments', () => {
  assert.equal(shouldAutoApproveAssessment({ severity: 'low', recommendation: 'ALLOW' }), true);
  assert.equal(shouldAutoApproveAssessment({ severity: 'medium', recommendation: 'ALLOW' }), true);
  assert.equal(shouldAutoApproveAssessment({ severity: 'medium', recommendation: 'ALLOW' }, { requiresConfirmation: true }), false);
  assert.equal(shouldAutoApproveAssessment({ severity: 'high', recommendation: 'ALLOW' }), false);
  assert.equal(shouldAutoApproveAssessment({ severity: 'low', recommendation: 'REVIEW' }), false);
});



test('owner private-chat relayMessage to m.chat is not misclassified as a generic workload risk', () => {
  const source = 'await sock.relayMessage(m.chat, { interactiveMessage: payload }, { additionalNodes: nodes });';
  const result = inspectWorkload('=>', source, { privateChat: true });
  assert.equal(result.suspicious, false);
  assert.equal(result.requiresConfirmation, false);
  assert.equal(result.hardBlock, false);
});

test('message sending to an arbitrary target still requires review', () => {
  const source = 'await sock.relayMessage(targetJid, payload, {});';
  const result = inspectWorkload('=>', source, { privateChat: true });
  assert.equal(result.suspicious, true);
  assert.equal(result.requiresConfirmation, true);
});

test('message sending from a group context is not covered by the private-chat exception', () => {
  const source = 'await sock.sendMessage(m.chat, payload);';
  const result = inspectWorkload('=>', source, { privateChat: false });
  assert.equal(result.suspicious, true);
  assert.equal(result.requiresConfirmation, true);
});

test('owner private-chat native-flow commerce relay payload is treated as a scoped send action', () => {
  const source = `await sock.relayMessage(m.chat, {
    messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
    interactiveMessage: {
      header: { title: "Commerce & Checkout", hasMediaAttachment: false },
      body: { text: "Multi-Product Message, Review & Pay, dan Order Details." },
      footer: { text: "Ocha Lidya AI" },
      nativeFlowMessage: { buttons: [
        { name: "mpm", buttonParamsJson: JSON.stringify({ product_list_info: { title: "Katalog Lumora", product_sections: [{ title: "Aromatherapy", products: [{ product_retailer_id: "LUM-01" }] }], business_owner_jid: "6283193905842@s.whatsapp.net" } }) },
        { name: "review_and_pay", buttonParamsJson: JSON.stringify({ currency: "IDR", total_amount: { value: 7500000, offset: 100 }, reference_id: "INV-2026-01", type: "physical-goods", order: { status: "pending", items: [{ retailer_id: "LUM-01", name: "Lumora Candle", amount: { value: 7500000, offset: 100 }, quantity: 1 }], subtotal: { value: 7500000, offset: 100 } } }) },
        { name: "order_details", buttonParamsJson: JSON.stringify({ reference_id: "ORD-2026-01", type: "physical-goods", payment_type: "upi", payment_configuration: "merchant_config", currency: "IDR", total_amount: { value: 7500000, offset: 100 }, order: { status: "pending", items: [{ retailer_id: "LUM-01", name: "Lumora Candle", amount: { value: 7500000, offset: 100 }, quantity: 1 }], subtotal: { value: 7500000, offset: 100 } } }) }
      ], messageParamsJson: "{}" }
    }
  }, { additionalNodes: [{ tag: "biz", attrs: {}, content: [{ tag: "interactive", attrs: { type: "native_flow", v: "1" }, content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" } }] }] }] })`;
  const result = inspectWorkload('=>', source, { privateChat: true });
  assert.equal(result.hardBlock, false);
  assert.equal(result.suspicious, false);
  assert.equal(result.requiresConfirmation, false);
});
