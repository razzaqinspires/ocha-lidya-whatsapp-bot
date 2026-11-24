import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PROJECT_ROOT = process.cwd();

test('master warning OFF skips prompts for non-hardblocked workloads, preserves hard blocks, and uses ButtonBuilder when enabled', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-master-controls-'));
  const original = process.cwd();
  try {
    process.chdir(temporary);
    const config = await import(pathToFileURL(path.join(PROJECT_ROOT, 'src/config.js')).href);
    await config.loadConfig();
    await config.updateConfig(value => {
      value.security.masterWorkloadWarningMode = 'off';
      value.security.masterWorkloadReviewEnabled = false;
      value.security.masterEvalEnabled = true;
    }, { actor: 'test-owner', reason: 'warning off regression' });

    const dispatcher = await import(pathToFileURL(path.join(PROJECT_ROOT, 'src/master/dispatcher.js')).href);
    let sent = 0;
    let replies = 0;
    const sock = { relayMessage: async jid => { sent++; assert.equal(jid, '6283193905842@s.whatsapp.net'); return { messageId: 'relay-ok' }; } };
    const m = {
      chat: '6283193905842@s.whatsapp.net', sender: '6283193905842@s.whatsapp.net', isGroup: false,
      reply: async () => { replies++; return { key: { id: 'execution-result' } }; }
    };
    await dispatcher.runMasterCommand(sock, m, '=> await sock.relayMessage(m.chat + "", { test: true }, {});');
    assert.equal(sent, 1, 'non-hardblocked command should continue when warning is OFF');
    assert.equal(replies, 1, 'only the normal execution result is replied, no confirmation prompt');

    let dangerousExecuted = false;
    const dangerousSock = { relayMessage: async () => { dangerousExecuted = true; } };
    await dispatcher.runMasterCommand(dangerousSock, m, '$ rm -rf /');
    assert.equal(dangerousExecuted, false, 'hard-block remains active even when warning is OFF');

    await config.updateConfig(value => { value.security.masterWorkloadWarningMode = 'compact'; }, { actor: m.sender, reason: 'confirm builder test' });
    const captured = { buttons: [] };
    const builder = {
      setTitle(value) { captured.title = value; return this; },
      setBody(value) { captured.body = value; return this; },
      setFooter(value) { captured.footer = value; return this; },
      addCopy(label, value) { captured.buttons.push({ kind: 'copy', label, value }); return this; },
      addReply(label, value) { captured.buttons.push({ kind: 'reply', label, value }); return this; },
      async send(chat, options) { captured.chat = chat; captured.options = options; return { key: { id: 'warning-builder-001' } }; }
    };
    const warningSock = { buttonBuilder: () => builder, sendInteractive: async () => { throw new Error('raw sendInteractive must not be used'); } };
    await dispatcher.runMasterCommand(warningSock, m, '=> await sock.relayMessage(targetJid, payload, {});');
    assert.equal(captured.buttons.length, 3);
    assert.equal(captured.buttons[0].kind, 'copy');
    assert.equal(captured.buttons[1].value.startsWith('CONFIRM '), true);
    assert.equal(captured.buttons[2].value, 'CANCEL');
    assert.equal(captured.chat, m.chat);
    assert.equal(captured.options.quoted, m);
  } finally {
    process.chdir(original);
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
