import test from 'node:test';
import assert from 'node:assert/strict';
import { menuButtonTestHooks } from '../src/plugins/general/menu.js';

test('command menu serializes list rows through Ocha ButtonBuilder, not raw sendInteractive payloads', async () => {
  const calls = { selection: [], sections: [], rows: [], sent: null };
  const builder = {
    setTitle(value) { calls.title = value; return this; },
    setSubtitle(value) { calls.subtitle = value; return this; },
    setBody(value) { calls.body = value; return this; },
    setFooter(value) { calls.footer = value; return this; },
    setImage(value) { calls.image = value; return this; },
    addSelection(value) { calls.selection.push(value); return this; },
    makeSection(title, highlight) { calls.sections.push({ title, highlight }); return this; },
    makeRow(header, title, description, id) { calls.rows.push({ header, title, description, id }); return this; },
    async send(chat, options) { calls.sent = { chat, options }; return { key: { id: 'builder-menu-ok' } }; }
  };
  const sock = { buttonBuilder: () => builder, sendInteractive: async () => { throw new Error('must not call raw sendInteractive'); } };
  const quoted = { chat: '628111111111@s.whatsapp.net', key: { id: 'quoted-menu' } };
  const options = {
    title: 'OCHA MENU', subtitle: 'NEXORA', body: 'Choose category', footer: 'Footer',
    buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: 'Select category', sections: [{ title: 'Commands', rows: [{ id: '.menu general 1', title: 'General', description: 'Open general' }] }] }) }]
  };
  const result = await menuButtonTestHooks.sendInteractiveMenu(sock, quoted, options);
  assert.equal(result.key.id, 'builder-menu-ok');
  assert.deepEqual(calls.selection, ['Select category']);
  assert.deepEqual(calls.sections, [{ title: 'Commands', highlight: '' }]);
  assert.equal(calls.rows[0].id, '.menu general 1');
  assert.equal(calls.sent.chat, quoted.chat);
  assert.equal(calls.sent.options.quoted, quoted);
});
