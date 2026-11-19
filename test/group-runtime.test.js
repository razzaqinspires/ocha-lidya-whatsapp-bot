import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('group metadata bootstraps once, tracks participants by event, and never deletes contacts when group is removed', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-group-runtime-test-'));
  process.chdir(temp);
  try {
    const source = name => pathToFileURL(path.resolve(original, `src/${name}`)).href;
    const config = await import(source('config.js'));
    await config.loadConfig();
    const contacts = await import(source('core/contacts.js'));
    await contacts.initializeContacts();
    const metadata = await import(source('core/group-metadata.js'));
    await metadata.initializeGroupMetadata();
    const runtime = await import(source('core/group-runtime.js'));

    let batchCalls = 0;
    const sock = {
      user: { id: '6282177461231@s.whatsapp.net', lid: 'bot-lid@lid' },
      signalRepository: { lidMapping: { getPNForLID: async lid => ({
        '111@lid': '6281111111111@s.whatsapp.net',
        '222@lid': '6282222222222@s.whatsapp.net',
        '333@lid': '6283333333333@s.whatsapp.net',
        '6282177461231@lid': '6282177461231@s.whatsapp.net'
      })[lid] } },
      groupFetchAllParticipating: async () => {
        batchCalls += 1;
        return {
          '12345-678@g.us': {
            id: '12345-678@g.us', subject: 'Ocha Group', creation: 1700000000, size: 2,
            participants: [
              { id: '111@lid', lid: '111@lid', admin: 'admin' },
              { id: '6282177461231@lid', lid: '6282177461231@lid' }
            ]
          }
        };
      },
      groupMetadata: async () => { throw new Error('existing cache should prevent per-group fetch'); }
    };

    await Promise.all([
      runtime.hydrateParticipatingGroupsOnce(sock),
      runtime.hydrateParticipatingGroupsOnce(sock),
      runtime.hydrateParticipatingGroupsOnce(sock)
    ]);
    assert.equal(batchCalls, 1, 'initial group list is fetched once across reconnect-style calls');
    assert.equal(metadata.getGroupMetadata('12345-678@g.us').participants.length, 2);
    assert.equal(metadata.getGroupMetadata('12345-678@g.us').participants[0].phoneNumber, '6281111111111@s.whatsapp.net');
    assert.equal(contacts.getContactCount(), 2);


    await runtime.handleGroupParticipantsUpdate(sock, {
      id: '12345-678@g.us', action: 'add',
      participants: [{ id: '222@lid', lid: '222@lid' }]
    });
    assert.equal(metadata.getGroupMetadata('12345-678@g.us').participants.length, 3);
    assert.equal(contacts.hasContact('6282222222222'), true);

    await runtime.handleGroupParticipantsUpdate(sock, {
      id: '12345-678@g.us', action: 'remove',
      participants: [{ id: '222@lid', lid: '222@lid' }]
    });
    assert.equal(metadata.getGroupMetadata('12345-678@g.us').participants.length, 2);
    assert.equal(contacts.hasContact('6282222222222'), true, 'participant removal keeps permanent contact history');

    // If the first time a PN is exposed is on the removal event, it is still
    // captured before group membership is changed.
    await runtime.handleGroupParticipantsUpdate(sock, {
      id: '12345-678@g.us', action: 'remove',
      participants: [{ id: '333@lid', lid: '333@lid' }]
    });
    assert.equal(contacts.hasContact('6283333333333'), true, 'remove events can still contribute verified PN contacts');

    await runtime.handleGroupParticipantsUpdate(sock, {
      id: '12345-678@g.us', action: 'remove',
      participants: [{ id: '6282177461231@lid', lid: '6282177461231@lid' }]
    });
    assert.equal(metadata.getGroupMetadata('12345-678@g.us'), null, 'bot removal deletes only group metadata');
    assert.equal(contacts.hasContact('6281111111111'), true);
    assert.equal(contacts.hasContact('6282222222222'), true);
    assert.equal(contacts.hasContact('6283333333333'), true);
    assert.ok((await fs.readFile(path.join(temp, 'data/group-metadata.jsonl'), 'utf8')).includes('group.delete'));
  } finally {
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
