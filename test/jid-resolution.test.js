import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMessageSenderPn } from '../src/core/jid-resolution.js';
import { isOwner } from '../src/core/identity.js';

test('private chat resolves LID using remoteJidAlt PN', async () => {
  const pn = await resolveMessageSenderPn({}, { remoteJid: '123456789@lid', remoteJidAlt: '6283193905842@s.whatsapp.net' }, false);
  assert.equal(pn, '6283193905842@s.whatsapp.net');
  assert.equal(isOwner(pn, '6283193905842'), true);
});

test('private chat also accepts the remoteJidPn compatibility field', async () => {
  const pn = await resolveMessageSenderPn({}, { remoteJid: '123456789@lid', remoteJidPn: '6283193905842@s.whatsapp.net' }, false);
  assert.equal(pn, '6283193905842@s.whatsapp.net');
});

test('group chat resolves participant LID using participantAlt or participantPn', async () => {
  const alt = await resolveMessageSenderPn({}, { remoteJid: '123@g.us', participant: '998877@lid', participantAlt: '6281234567890@s.whatsapp.net' }, true);
  const pnField = await resolveMessageSenderPn({}, { remoteJid: '123@g.us', participant: '998877@lid', participantPn: '6281234567890@s.whatsapp.net' }, true);
  assert.equal(alt, '6281234567890@s.whatsapp.net');
  assert.equal(pnField, '6281234567890@s.whatsapp.net');
});

test('senderPn is accepted as an explicit phone mapping', async () => {
  const pn = await resolveMessageSenderPn({}, { remoteJid: '123@g.us', participant: '998877@lid', senderPn: '6281234567890@s.whatsapp.net' }, true);
  assert.equal(pn, '6281234567890@s.whatsapp.net');
});

test('LID digits are never converted into a PN or used for owner verification', async () => {
  const pn = await resolveMessageSenderPn({}, { remoteJid: '6283193905842@lid' }, false);
  assert.equal(pn, null);
  assert.equal(isOwner('6283193905842@lid', '6283193905842'), false);
});

test('verified Baileys lidMapping is used only as a final fallback', async () => {
  const sock = { signalRepository: { lidMapping: { getPNForLID: async lid => lid === '998877@lid' ? '6281234567890@s.whatsapp.net' : undefined } } };
  const pn = await resolveMessageSenderPn(sock, { remoteJid: '998877@lid' }, false);
  assert.equal(pn, '6281234567890@s.whatsapp.net');
});
