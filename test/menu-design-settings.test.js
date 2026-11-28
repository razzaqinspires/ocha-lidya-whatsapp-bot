import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MENU_FONTS,
  MENU_TEMPLATES,
  applyMenuFont,
  buildMenuText,
  getMenuTemplate,
  getMenuPageCount,
} from '../src/core/menu-renderer.js';
import setmenu, { setMenuTestHooks } from '../src/plugins/owner/setmenu.js';
import { menuButtonTestHooks } from '../src/plugins/general/menu.js';
import { configDefaults } from '../src/config.js';

const plugins = [
  { name: 'zeta', category: 'general', description: 'Last command' },
  { name: 'alpha', category: 'general', description: 'First command' },
  { name: 'profile', category: 'general', aliases: ['me'], usage: '[show]', description: 'User profile' },
  { name: 'kernel', category: 'developer', description: 'Kernel telemetry' },
];

function config(menu = {}) {
  return {
    bot: { name: 'Ocha Lidya' },
    mode: 'public',
    menu: {
      ...structuredClone(configDefaults.menu),
      ...menu,
      pagination: { ...configDefaults.menu.pagination, ...(menu.pagination || {}) },
    },
  };
}

test('menu design presets and safe font transforms are exposed and deterministic', () => {
  assert.ok(Object.keys(MENU_TEMPLATES).length >= 12);
  assert.ok(Object.keys(MENU_FONTS).length >= 10);
  assert.notEqual(applyMenuFont('Ocha Lidya', 'bold'), 'Ocha Lidya');
  assert.equal(applyMenuFont('Ocha Lidya', 'normal'), 'Ocha Lidya');
  assert.equal(getMenuTemplate(config({ template: 'sakura' })).top, MENU_TEMPLATES.sakura.top);
  assert.equal(getMenuTemplate(config({ template: 'unknown-theme' })).top, MENU_TEMPLATES.corporate.top);
});

test('menu renderer honors theme, font, ordering, spacing, descriptions and borders', () => {
  const body = buildMenuText({
    plugins,
    config: config({
      template: 'terminal',
      font: 'bold',
      order: 'az',
      spacing: 1,
      showDescriptions: true,
      topBorder: false,
      bottomBorder: false,
    }),
    prefixes: ['.'],
  });
  assert.ok(body.includes(applyMenuFont('COMMAND DIRECTORY', 'bold')));
  assert.ok(body.includes(applyMenuFont('ALL COMMANDS', 'bold')));
  assert.ok(body.indexOf('.alpha') < body.indexOf('.kernel'));
  assert.ok(body.indexOf('.kernel') < body.indexOf('.me'));
  assert.match(body, /First command/);
  assert.doesNotMatch(body, /╔══\[/, 'top border is disabled');
  assert.doesNotMatch(body, /╚════════════/, 'bottom border is disabled');
});

test('menu renderer supports reverse ordering and bounded pagination', () => {
  const menuConfig = config({ order: 'za', pagination: { enabled: true, pageSize: 10 } });
  const manyPlugins = [
    ...plugins,
    ...Array.from({ length: 14 }, (_, i) => ({ name: `cmd${String(i).padStart(2, '0')}`, category: 'general' })),
  ];
  const body = buildMenuText({
    plugins: manyPlugins,
    config: menuConfig,
    prefixes: ['.'],
    masterEnabled: false,
    page: 99,
  });
  const firstPage = buildMenuText({
    plugins: manyPlugins,
    config: menuConfig,
    prefixes: ['.'],
    masterEnabled: false,
    page: 1,
  });
  assert.equal(getMenuPageCount(manyPlugins, menuConfig, false), 2);
  assert.match(body, /PAGE 2\/2/);
  assert.ok(firstPage.indexOf('.zeta') < firstPage.indexOf('.profile'));
});

test('setmenu remains owner-private and its interactive directory reflects actual supported settings', () => {
  assert.equal(setmenu.name, 'setmenu');
  assert.equal(setmenu.ownerOnly, true);
  assert.equal(setmenu.privateOnly, true);
  const menu = config().menu;
  const sections = setMenuTestHooks.buildSettingsSections(menu, '.');
  const rows = sections.flatMap(section => section.rows);
  assert.ok(rows.some(item => item.id === '.setmenu template sakura'));
  assert.ok(rows.some(item => item.id === '.setmenu font mono'));
  assert.ok(rows.some(item => item.id === '.setmenu order az'));
  assert.ok(rows.some(item => item.id === '.setmenu spacing 3'));
  assert.ok(rows.some(item => item.id === '.setmenu limit 200'));
  assert.ok(sections.every(section => section.rows.length <= 10));
});

test('native-flow menu follows description visibility and keeps executable IDs unchanged', () => {
  const hidden = menuButtonTestHooks.buildMenuButtonModel({
    plugins,
    prefixes: ['.'],
    category: 'general',
    config: config({ showDescriptions: false }),
  });
  const visible = menuButtonTestHooks.buildMenuButtonModel({
    plugins,
    prefixes: ['.'],
    category: 'general',
    config: config({ showDescriptions: true }),
  });
  const hiddenAlpha = hidden.buttons[0].buttonParamsJson;
  const visibleAlpha = visible.buttons[0].buttonParamsJson;
  assert.doesNotMatch(hiddenAlpha, /First command/);
  assert.match(visibleAlpha, /First command/);
  assert.match(visibleAlpha, /\"id\":\"\.alpha\"/);
});
