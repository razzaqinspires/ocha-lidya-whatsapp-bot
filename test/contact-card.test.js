import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContactMessage, normalizeContactNumber } from '../src/lib/contact-card.js';

test('normalizes contact numbers to international digits only', () => {
  assert.equal(normalizeContactNumber('+62 831-9390-5842'), '6283193905842');
  assert.throws(() => normalizeContactNumber('123'), /8-15 digit/);
});

test('builds a Baileys contact payload with displayName inside contact item and structured N', () => {
  const payload = buildContactMessage({
    number: '6283193905842',
    displayName: 'Owner Ocha Lidya',
    organization: 'Razzaq Ventures'
  });
  const [contact] = payload.contacts.contacts;
  assert.equal(contact.displayName, 'Owner Ocha Lidya');
  assert.match(contact.vcard, /N:Owner;Ocha Lidya;;;/);
  assert.match(contact.vcard, /FN:Owner Ocha Lidya/);
  assert.match(contact.vcard, /waid=6283193905842:\+6283193905842/);
  assert.match(contact.vcard, /ORG:Razzaq Ventures;/);
  assert.equal(payload.contacts.displayName, undefined);
});

test('escapes vCard control characters in user-facing fields', () => {
  const payload = buildContactMessage({ number: '6283193905842', displayName: 'Owner; Test, Inc' });
  assert.match(payload.contacts.contacts[0].vcard, /FN:Owner\\; Test\\, Inc/);
});
