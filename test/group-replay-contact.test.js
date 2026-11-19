import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('replaying cached group metadata restores its PN contacts without any WhatsApp metadata query', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-group-replay-test-'));
  process.chdir(temp);
  try {
    await fs.mkdir(path.join(temp, 'data'), { recursive: true });
    const event = {
      ts: new Date().toISOString(),
      type: 'group.upsert',
      payload: { group: {
        id: '123-456@g.us', subject: 'Cached group', ownerPn: '6283111111111@s.whatsapp.net',
        participants: [
          { id: '6283222222222@s.whatsapp.net', phoneNumber: '6283222222222@s.whatsapp.net' },
          { id: 'lid-3@lid', lid: 'lid-3@lid', phoneNumber: '6283333333333@s.whatsapp.net' }
        ]
      } }
    };
    await fs.writeFile(path.join(temp, 'data/group-metadata.jsonl'), `${JSON.stringify(event)}\n`);
    const contacts = await import(pathToFileURL(path.resolve(original, 'src/core/contacts.js')).href);
    await contacts.initializeContacts();
    const metadata = await import(pathToFileURL(path.resolve(original, 'src/core/group-metadata.js')).href);
    await metadata.initializeGroupMetadata();
    assert.equal(contacts.getContactCount(), 3);
    assert.equal(contacts.hasContact('6283111111111'), true, 'group owner PN is indexed');
    assert.equal(contacts.hasContact('6283222222222'), true);
    assert.equal(contacts.hasContact('6283333333333'), true);
    assert.deepEqual(contacts.listContacts().map(row => row.name), ['', '', '']);
  } finally {
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
