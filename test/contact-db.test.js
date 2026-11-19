import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('contact.jsonl stores each verified PN once with empty name and gender', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-contact-test-'));
  process.chdir(temp);
  try {
    const url = pathToFileURL(path.resolve(original, 'src/core/contacts.js')).href;
    await fs.mkdir(path.join(temp, 'data'), { recursive: true });
    await fs.writeFile(path.join(temp, 'data/contact.jsonl'), [
      JSON.stringify({ number: '6281111111111', name: '', gender: '' }),
      JSON.stringify({ number: '6281111111111', name: 'duplicate', gender: '' }),
      '{invalid-json'
    ].join('\n') + '\n');
    const db = await import(`${url}?contacts=${Date.now()}`);
    await db.initializeContacts();
    assert.equal(db.getContactCount(), 1, 'legacy duplicates are removed during startup');
    assert.ok((await fs.readdir(path.join(temp, 'data/quarantine'))).some(name => name.startsWith('contact.jsonl.')));
    assert.equal((await db.addContactFromPnJid('6283193905842@s.whatsapp.net')).added, true);
    assert.equal((await db.addContactFromPnJid('6283193905842@s.whatsapp.net')).added, false);
    assert.equal((await db.addContactFromPnJid('999999999@lid')).added, false);
    await db.addContactsFromPnJids(['6281234567890@s.whatsapp.net', '6283193905842@s.whatsapp.net']);
    assert.equal(db.getContactCount(), 3);
    const lines = (await fs.readFile(path.join(temp, 'data/contact.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(lines, [
      { number: '6281111111111', name: '', gender: '' },
      { number: '6283193905842', name: '', gender: '' },
      { number: '6281234567890', name: '', gender: '' }
    ]);
  } finally {
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
