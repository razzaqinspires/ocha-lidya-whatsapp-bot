import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PROJECT_ROOT = process.cwd();

test('owner master warning controls, CTA Copy and silent-off policy', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-master-controls-'));
  const original = process.cwd();
  try {
    process.chdir(temporary);
    const config = await import(pathToFileURL(path.join(PROJECT_ROOT, 'src/config.js')).href);
    await config.loadConfig();

    const masterPluginModule = await import(pathToFileURL(path.join(PROJECT_ROOT, 'src/plugins/owner/master.js')).href);
    const replies = [];
    const ownerMessage = {
      sender: '6283193905842@s.whatsapp.net',
      reply: async value => { replies.push(String(value)); return { key: { id: 'reply' } }; }
    };
    await masterPluginModule.default.execute({ m: ownerMessage, args: ['warning', 'detailed'] });
    await masterPluginModule.default.execute({ m: ownerMessage, args: ['review', 'false'] });
    assert.equal(config.getConfig().security.masterWorkloadWarningMode, 'detailed');
    assert.equal(config.getConfig().security.masterWorkloadReviewEnabled, false);
    assert.equal(config.getConfig().schemaVersion, 37);
    await masterPluginModule.default.execute({ m: ownerMessage, args: ['warning', 'off'] });
    assert.equal(config.getConfig().security.masterWorkloadWarningMode, 'off');
    assert.match(replies.at(-1), /diblokir tanpa balasan/i);

    // Re-enable compact notices and request a suspicious, arbitrary-recipient send.
    await config.updateConfig(value => { value.security.masterWorkloadWarningMode = 'compact'; }, { actor: ownerMessage.sender, reason: 'test warning UI' });
    await config.updateConfig(value => { value.security.masterEvalEnabled = true; }, { actor: ownerMessage.sender, reason: 'test runner enable' });
    const dispatcher = await import(pathToFileURL(path.join(PROJECT_ROOT, 'src/master/dispatcher.js')).href);

    let scopedSendCount = 0;
    const scopedSock = { relayMessage: async jid => { scopedSendCount++; assert.equal(jid, '6283193905842@s.whatsapp.net'); } };
    const safeReplies = [];
    const safeMessage = {
      chat: '6283193905842@s.whatsapp.net',
      sender: '6283193905842@s.whatsapp.net',
      isGroup: false,
      reply: async value => { safeReplies.push(String(value)); return { key: { id: 'safe-result' } }; }
    };
    await dispatcher.runMasterCommand(scopedSock, safeMessage, '=> await sock.relayMessage(m.chat, { interactiveMessage: { body: { text: "owner test" } } }, { additionalNodes: [] });');
    assert.equal(scopedSendCount, 1);
    assert.match(safeReplies.at(-1), /OCHA MASTER CONSOLE/);

    let interactive;
    const sock = {
      sendInteractive: async (jid, options) => { interactive = { jid, options }; return { key: { id: 'warning-001' } }; }
    };
    const message = {
      chat: '6283193905842@s.whatsapp.net',
      sender: '6283193905842@s.whatsapp.net',
      isGroup: false,
      reply: async value => { replies.push(String(value)); return { key: { id: 'fallback' } }; }
    };
    await dispatcher.runMasterCommand(sock, message, '=> await sock.relayMessage(targetJid, payload, {});');
    assert.ok(interactive);
    assert.equal(interactive.options.buttons[0].name, 'cta_copy');
    const copy = JSON.parse(interactive.options.buttons[0].buttonParamsJson);
    assert.equal(copy.display_text, 'Salin Konfirmasi');
    assert.match(copy.copy_code, /^CONFIRM [A-F0-9]{6}$/);
    assert.deepEqual(interactive.options.buttons.slice(1).map(button => button.name), ['quick_reply', 'quick_reply']);
    assert.equal(interactive.options.buttons.length, 3);

    // Warning OFF suppresses the UI but does not execute a flagged command.
    await config.updateConfig(value => { value.security.masterWorkloadWarningMode = 'off'; }, { actor: ownerMessage.sender, reason: 'test silent warning mode' });
    let replyCount = 0;
    let interactiveCount = 0;
    const silentSock = { sendInteractive: async () => { interactiveCount++; return { key: { id: 'unexpected' } }; } };
    const silentMessage = { ...message, reply: async () => { replyCount++; return { key: { id: 'unexpected-reply' } }; } };
    await dispatcher.runMasterCommand(silentSock, silentMessage, '=> await sock.relayMessage(targetJid, payload, {});');
    assert.equal(replyCount, 0);
    assert.equal(interactiveCount, 0);

    const database = await import(pathToFileURL(path.join(PROJECT_ROOT, 'src/core/database.js')).href);
    const events = await database.getRecords({ type: 'master.workload.suppressed' });
    assert.ok(events.length >= 1);
    assert.equal(events.at(-1).payload.action, 'blocked-silently');
  } finally {
    process.chdir(original);
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
