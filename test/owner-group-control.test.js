import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const groupId = '120363123456789012-1234567890@g.us';

test('owner .joingc joins only official invite links, starts muted, and .mute off enables only that group', async () => {
  const original = process.cwd();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-owner-joingc-'));
  process.chdir(temporary);
  try {
    const source = name => pathToFileURL(path.resolve(original, `src/${name}`)).href;
    const config = await import(source('config.js'));
    await config.loadConfig();
    const contacts = await import(source('core/contacts.js'));
    await contacts.initializeContacts();
    const groupMetadata = await import(source('core/group-metadata.js'));
    await groupMetadata.initializeGroupMetadata();
    const control = await import(source('core/group-control.js'));
    const policy = await import(source('core/group-policy.js'));
    const joingc = (await import(source('plugins/owner/joingc.js'))).default;
    const mute = (await import(source('plugins/owner/mute.js'))).default;

    assert.equal(joingc.ownerOnly, true);
    assert.equal(joingc.privateOnly, true);
    assert.equal(mute.ownerOnly, true);
    assert.equal(mute.privateOnly, true);

    const preview = { id: groupId, subject: 'Ocha Community', creation: 1700000000, desc: 'Test group' };
    let acceptedCode = '';
    const sock = {
      groupGetInviteInfo: async code => ({ ...preview }),
      groupAcceptInvite: async code => { acceptedCode = code; return groupId; },
      groupMetadata: async id => ({ ...preview, participants: [{ id: '6281111111111@s.whatsapp.net' }] })
    };
    const replies = [];
    const m = { sender: '6283193905842@s.whatsapp.net', reply: async text => replies.push(text) };

    await joingc.execute({ sock, m, args: ['https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv'] , text: 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv' });
    assert.equal(acceptedCode, 'AbCdEfGhIjKlMnOpQrStUv');
    assert.equal(config.getConfig().features.lastJoinedGroupId, groupId);
    assert.equal(control.getGroupInteractionState(groupId).muted, true, 'newly joined group is muted by default');
    assert.ok(groupMetadata.getGroupMetadata(groupId));
    assert.match(replies.at(-1), /BERHASIL BERGABUNG KE GRUP/);

    await mute.execute({ m, args: ['off'] });
    assert.equal(config.getConfig().features.groupsMuted, true, 'global default remains unchanged');
    assert.equal(control.getGroupInteractionState(groupId).muted, false);
    assert.equal(policy.shouldSuppressGroupInteraction({ isGroup: true, chat: groupId }, config.getConfig()), false);
    const groupInfo = (await import(source('plugins/general/groupinfo.js'))).default;
    let groupList = '';
    const unauthorizedReplies = [];
    await groupInfo.execute({
      sock,
      m: { isGroup: false, isOwner: false, reply: async text => unauthorizedReplies.push(text) },
      args: []
    });
    assert.match(unauthorizedReplies.at(-1), /hanya tersedia untuk owner terverifikasi/);
    await groupInfo.execute({
      sock,
      m: { isGroup: false, isOwner: true, reply: async () => {}, replyWithSession: async text => { groupList = text; } },
      args: []
    });
    assert.match(groupList, /Status seluruh grup: 1 aktif · 0 mute/);
    assert.match(groupList, /Ocha Community.*AKTIF/);
    const otherGroup = '120363999999999999-9876543210@g.us';
    assert.equal(policy.shouldSuppressGroupInteraction({ isGroup: true, chat: otherGroup }, config.getConfig()), true, 'other groups stay muted');
    assert.match(replies.at(-1), /Ocha aktif di grup ini/);

    await mute.execute({ m, args: ['on'] });
    assert.equal(control.getGroupInteractionState(groupId).muted, true);
    await groupInfo.execute({
      sock,
      m: { isGroup: false, isOwner: true, reply: async () => {}, replyWithSession: async text => { groupList = text; } },
      args: []
    });
    assert.match(groupList, /Status seluruh grup: 0 aktif · 1 mute/);
    assert.match(groupList, /Ocha Community.*MUTE/);
    await groupMetadata.upsertGroupMetadata({ id: otherGroup, subject: 'Private Elsewhere', participants: [] });
    let nonOwnerGroupDetail = '';
    await groupInfo.execute({
      sock,
      m: { isGroup: true, isOwner: false, chat: groupId, reply: async text => { nonOwnerGroupDetail = text; } },
      args: [otherGroup]
    });
    assert.match(nonOwnerGroupDetail, /Ocha Community/, 'non-owner sees only the current group even if another Group JID is supplied');
    assert.doesNotMatch(nonOwnerGroupDetail, /Private Elsewhere/);
    await mute.execute({ m, args: ['off', 'all'] });
    assert.equal(config.getConfig().features.groupsMuted, false);
    assert.deepEqual(config.getConfig().features.groupMuteOverrides, {});
    assert.equal(policy.shouldSuppressGroupInteraction({ isGroup: true, chat: otherGroup }, config.getConfig()), false);
  } finally {
    process.chdir(original);
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test('joingc rejects non-WhatsApp invite URLs before making protocol calls', async () => {
  const original = process.cwd();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-owner-joingc-invalid-'));
  process.chdir(temporary);
  try {
    const source = name => pathToFileURL(path.resolve(original, `src/${name}`)).href;
    const plugin = (await import(source('plugins/owner/joingc.js'))).default;
    let called = false;
    const replies = [];
    await plugin.execute({
      sock: { groupAcceptInvite: async () => { called = true; return groupId; } },
      m: { sender: '6283193905842@s.whatsapp.net', reply: async text => replies.push(text) },
      args: ['https://evil.example/AbCdEfGhIjKlMnOpQrStUv'],
      text: 'https://evil.example/AbCdEfGhIjKlMnOpQrStUv'
    });
    assert.equal(called, false);
    assert.match(replies.at(-1), /Hanya tautan resmi/);
    await assert.rejects(() => import(source('core/group-control.js')).then(module => module.setGroupInteractionMuted('not-a-group', false)), /Group ID tidak valid/);
  } finally {
    process.chdir(original);
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
