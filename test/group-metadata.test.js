import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('group metadata is persisted separately; participant removal never removes contacts', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-group-cache-test-'));
  process.chdir(temp);
  try {
    const contactsUrl = pathToFileURL(path.resolve(original, 'src/core/contacts.js')).href;
    const groupsUrl = pathToFileURL(path.resolve(original, 'src/core/group-metadata.js')).href;
    const contacts = await import(contactsUrl);
    const groups = await import(groupsUrl);
    await contacts.initializeContacts();
    await groups.initializeGroupMetadata();

    await groups.upsertGroupMetadata({
      id: '123456789-123@g.us', subject: 'Test Group', creation: 1700000000,
      participants: [
        { id: '111111@lid', phoneNumber: '6281111111111@s.whatsapp.net', lid: '111111@lid', admin: 'admin' },
        { id: '6282222222222@s.whatsapp.net' }
      ]
    });
    assert.equal(groups.getGroupMetadata('123456789-123@g.us').participants.length, 2);
    assert.equal(contacts.getContactCount(), 2);

    await groups.applyGroupParticipantsUpdate({
      id: '123456789-123@g.us', action: 'add',
      participants: [{ id: '333333@lid', phoneNumber: '6283333333333@s.whatsapp.net', lid: '333333@lid' }]
    });
    assert.equal(groups.getGroupMetadata('123456789-123@g.us').participants.length, 3);
    assert.equal(contacts.getContactCount(), 3);

    await groups.applyGroupParticipantsUpdate({
      id: '123456789-123@g.us', action: 'remove', participants: [{ id: '333333@lid', phoneNumber: '6283333333333@s.whatsapp.net' }]
    });
    assert.equal(groups.getGroupMetadata('123456789-123@g.us').participants.length, 2);
    assert.equal(contacts.hasContact('6283333333333'), true);

    await groups.deleteGroupMetadata('123456789-123@g.us');
    assert.equal(groups.getGroupMetadata('123456789-123@g.us'), null);
    assert.equal(contacts.getContactCount(), 3);
    assert.ok((await fs.readFile(path.join(temp, 'data/contact.jsonl'), 'utf8')).includes('6283333333333'));
    assert.ok((await fs.readFile(path.join(temp, 'data/group-metadata.jsonl'), 'utf8')).includes('group.delete'));
  } finally {
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
