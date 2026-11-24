import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMenuButtonModel } from '../src/plugins/general/menu.js';

const plugins = [
  { name: 'menu', category: 'general', description: 'Menu' },
  { name: 'profile', category: 'general', description: 'Profil akun' },
  { name: 'kernel', category: 'general', description: 'Dashboard kernel' },
  { name: 'website', category: 'general', description: 'Website builder' },
  { name: 'yts', aliases: ['ytsearch', 'ytmp3', 'ytmp4', 'ytm', 'ytmusic', 'ytplay'], category: 'general', usage: '.yts <query> | .ytmp3 <url> | .ytmp4 <url> [resolusi] | .ytm <judul lagu>', description: 'Pencarian dan unduhan YouTube' },
  { name: 'run', category: 'developer', description: 'Run code' },
  { name: 'jid', category: 'developer', ownerOnly: true, description: 'Inspect JID' },
  { name: 'rentals', category: 'owner', ownerOnly: true, description: 'Rental administration' },
  { name: 'config', category: 'owner', ownerOnly: true, description: 'Bot configuration' }
];

function rows(model) {
  return JSON.parse(model.buttons[0].buttonParamsJson).sections[0].rows;
}

test('main command menu builds a native-flow category selector and hides owner-only entries', () => {
  const model = buildMenuButtonModel({ plugins, prefixes: ['.'], isOwner: false });
  assert.equal(model.kind, 'categories');
  const list = rows(model);
  assert.ok(list.some(row => row.id === '.menu general 1'));
  assert.ok(list.some(row => row.id === '.menu developer 1'));
  assert.ok(list.some(row => row.id === '.profile'));
  assert.ok(list.some(row => row.id === '.website'));
  assert.ok(list.some(row => row.id === '.yts'), 'YouTube search should be directly visible in the main menu');
  assert.ok(!list.some(row => row.id.includes('owner')));
});

test('category menu emits executable command IDs and bounded pagination rows', () => {
  const manyPlugins = Array.from({ length: 25 }, (_, index) => ({
    name: `command${index + 1}`, category: 'general', usage: '<action>', description: `Command ${index + 1}`
  }));
  const model = buildMenuButtonModel({ plugins: manyPlugins, prefixes: ['!'], category: 'general', page: 2 });
  const list = rows(model);
  assert.equal(model.currentPage, 2);
  assert.ok(list.length <= 10);
  assert.equal(list[0].id, '!command8');
  assert.ok(list.some(row => row.id === '!menu general 1'));
  assert.ok(list.some(row => row.id === '!menu general 3'));
  assert.ok(!list[0].id.includes('<action>'));
});

test('owner category is available only to verified owners and no-prefix mode emits plain commands', () => {
  const publicModel = buildMenuButtonModel({ plugins, prefixes: [], isOwner: false });
  const ownerModel = buildMenuButtonModel({ plugins, prefixes: [], isOwner: true });
  assert.ok(!rows(publicModel).some(row => row.id.startsWith('menu owner')));
  const ownerRows = rows(ownerModel);
  assert.ok(ownerRows.some(row => row.id === 'menu owner 1'));
  assert.ok(ownerRows.some(row => row.id === 'test'), 'owner menu should expose Message Test Lab');
  assert.ok(ownerRows.some(row => row.id === 'master status'), 'owner menu should expose Master Console status');
  const category = buildMenuButtonModel({ plugins, prefixes: [], isOwner: true, category: 'owner' });
  assert.ok(rows(category).some(row => row.id === 'rentals'));
});


test('YouTube canonical command and every registered alias are visible in the general menu', () => {
  const first = buildMenuButtonModel({ plugins, prefixes: ['.'], category: 'general', isOwner: false, page: 1 });
  const commands = [...first.body];
  for (let page = 2; page <= first.totalPages; page += 1) {
    commands.push(...buildMenuButtonModel({ plugins, prefixes: ['.'], category: 'general', isOwner: false, page }).body);
  }
  const names = commands.map(item => item.name);
  for (const name of ['yts', 'ytsearch', 'ytmp3', 'ytmp4', 'ytm', 'ytmusic', 'ytplay']) assert.ok(names.includes(name), `${name} should be visible`);
  const mp3 = commands.find(item => item.name === 'ytmp3');
  assert.equal(mp3.canonical, 'yts');
  assert.equal(mp3.alias, true);
});
