import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function withTempProject(run) {
  const original = process.cwd();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-v162-'));
  process.chdir(temporary);
  try { await run(original, temporary); }
  finally { process.chdir(original); await fs.rm(temporary, { recursive: true, force: true }); }
}

test('master CLI is independent and legacy exec is only a CLI alias', async () => {
  await withTempProject(async original => {
    const configUrl = pathToFileURL(path.resolve(original, 'src/config.js')).href;
    const pluginUrl = pathToFileURL(path.resolve(original, 'src/plugins/owner/master.js')).href;
    const config = await import(configUrl);
    await config.loadConfig();
    const plugin = (await import(pluginUrl)).default;
    const replies = [];
    const m = { sender: '6283193905842@s.whatsapp.net', reply: async text => replies.push(text) };

    await plugin.execute({ m, args: ['cli', 'on'] });
    assert.equal(config.getConfig().security.masterCliEnabled, true);
    assert.equal(config.getConfig().security.masterExecEnabled, undefined);
    assert.match(replies.at(-1), /CLI shell: ON/);
    const masterUrl = pathToFileURL(path.resolve(original, 'src/master/dispatcher.js')).href;
    const master = await import(masterUrl);
    await master.runMasterCommand({}, m, '$ printf OCHA_CLI_DIRECT_OK');
    assert.match(replies.at(-1), /OCHA_CLI_DIRECT_OK/);
    assert.match(replies.at(-1), /Exit\s+: 0 · SUCCESS/);

    await plugin.execute({ m, args: ['exec', 'off'] });
    assert.equal(config.getConfig().security.masterCliEnabled, false);
    assert.match(replies.at(-1), /alias lama/i);

    await plugin.execute({ m, args: ['status'] });
    assert.match(replies.at(-1), /CLI shell/);
    assert.match(replies.at(-1), /Python runner/);
    assert.doesNotMatch(replies.at(-1), /exec:\s+ON/i);

    const mutePlugin = (await import(pathToFileURL(path.resolve(original, 'src/plugins/owner/mute.js')).href)).default;
    assert.equal(mutePlugin.ownerOnly, true);
    assert.equal(mutePlugin.privateOnly, true);
    await mutePlugin.execute({ m, args: ['off'] });
    assert.equal(config.getConfig().features.groupsMuted, false);
    assert.match(replies.at(-1), /GROUP MUTE: OFF/);
    await mutePlugin.execute({ m, args: ['on'] });
    assert.equal(config.getConfig().features.groupsMuted, true);
  });
});

test('schema v11 defaults all group interaction to muted and removes the global exec gate', async () => {
  await withTempProject(async (original, temporary) => {
    const databaseUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
    const configUrl = pathToFileURL(path.resolve(original, 'src/config.js')).href;
    const source = `
      const db = await import(${JSON.stringify(databaseUrl)});
      await db.initializeDatabase();
      await db.appendRecord('config.replace', { config: {
        schemaVersion: 10,
        bot: { owner: '6283193905842', expectedNumber: '6282177461231' },
        security: { masterExecEnabled: true, masterCliEnabled: true, masterEvalEnabled: false, masterPythonEnabled: false, masterGolangEnabled: false },
        features: { autoRead: false }
      } });
      const config = await import(${JSON.stringify(configUrl)});
      await config.loadConfig();
      console.log('MIGRATED:' + JSON.stringify({ schemaVersion: config.getConfig().schemaVersion, groupsMuted: config.getConfig().features.groupsMuted, masterExecEnabled: config.getConfig().security.masterExecEnabled, masterCliEnabled: config.getConfig().security.masterCliEnabled }));
    `;
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temporary, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('MIGRATED:'));
    assert.ok(line, result.stdout);
    const migrated = JSON.parse(line.slice('MIGRATED:'.length));
    assert.deepEqual(migrated, { schemaVersion: 14, groupsMuted: true, masterCliEnabled: true });
    assert.equal(migrated.masterExecEnabled, undefined);
  });
});

test('global group mute suppresses interaction dispatch without applying to private chats', async () => {
  const policyUrl = pathToFileURL(path.resolve(process.cwd(), 'src/core/group-policy.js')).href;
  const policy = await import(policyUrl);
  assert.equal(policy.shouldSuppressGroupInteraction({ isGroup: true }, { features: { groupsMuted: true } }), true);
  assert.equal(policy.shouldSuppressGroupInteraction({ isGroup: false }, { features: { groupsMuted: true } }), false);
  assert.equal(policy.shouldSuppressGroupInteraction({ isGroup: true }, { features: { groupsMuted: false } }), false);
});

test('message monitor aggregates private/group reply and receipt states', async () => {
    const monitorUrl = pathToFileURL(path.resolve(process.cwd(), 'src/core/message-monitor.js')).href;
    const monitor = await import(`${monitorUrl}?test=${Date.now()}`);
    const dmKey = { remoteJid: '6281111111111@s.whatsapp.net', id: 'incoming-dm-0001', fromMe: false };
    const originalWrite = process.stdout.write;
    let inboundLog = '';
    process.stdout.write = function (chunk, ...args) { inboundLog += String(chunk); return true; };
    try {
      monitor.observeIncomingMessage({ key: dmKey, sender: '6281111111111@s.whatsapp.net', pushName: 'Tester', chat: dmKey.remoteJid });
    } finally { process.stdout.write = originalWrite; }
    assert.equal(inboundLog, '', 'incoming user messages must not be printed to terminal');
    const sentDm = { remoteJid: dmKey.remoteJid, id: 'outgoing-dm-0001', fromMe: true };
    monitor.observeOutgoingMessage(sentDm, dmKey);
    monitor.observeMessageUpdates([{ key: sentDm, update: { status: 2 } }]);
    monitor.observeMessageUpdates([{ key: sentDm, update: { status: 3 } }]);

    const groupIncoming = { remoteJid: '12345-678@g.us', id: 'incoming-group-0001', participant: '6282222222222@s.whatsapp.net', fromMe: false };
    monitor.observeIncomingMessage({ key: groupIncoming, sender: groupIncoming.participant, pushName: 'Group member', chat: groupIncoming.remoteJid });
    const groupSent = { remoteJid: groupIncoming.remoteJid, id: 'outgoing-group-0001', fromMe: true };
    monitor.observeOutgoingMessage(groupSent, groupIncoming);
    monitor.observeGroupReceipts([{ key: groupSent, receipt: { userJid: '6282222222222@s.whatsapp.net', receiptTimestamp: 1 } }]);
    monitor.observeGroupReceipts([{ key: groupSent, receipt: { userJid: '6282222222222@s.whatsapp.net', readTimestamp: 2 } }]);

    const stats = monitor.getMessageMonitorStats();
    assert.equal(stats.trackedOutgoing, 2);
    assert.equal(stats.trackedIncoming, 2);
    const dmState = monitor.getMessageFlowState(sentDm);
    assert.equal(dmState.status, 3);
    assert.equal(dmState.botReply, true);
    assert.equal(dmState.isGroup, false);
    const groupState = monitor.getMessageFlowState(groupSent);
    assert.equal(groupState.deliveredCount, 1);
    assert.equal(groupState.readCount, 1);
    assert.equal(groupState.botReply, true);
    assert.equal(groupState.isGroup, true);
});
