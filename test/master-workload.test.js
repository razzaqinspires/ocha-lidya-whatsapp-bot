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
