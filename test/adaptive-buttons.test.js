import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAdaptiveButtonPlan,
  getHardButtonExemptions,
  planButtonInventory,
  withCommandButtons
} from '../src/core/adaptive-buttons.js';

const enabledConfig = {
  prefix: { mode: 'single', single: '.' },
  ui: { fullButton: { enabled: true, strategy: 'adaptive', maxBodyChars: 1800, excludedCommands: [] } }
};

test('usage metadata creates quick replies only for allow-listed read-only actions', () => {
  const plugin = { name: 'project', category: 'developer', usage: '<list|status|use|history|zip|export> [target]' };
  const plan = buildAdaptiveButtonPlan({ plugin, text: 'Repository tersimpan. Pilih tindakan berikutnya.', config: enabledConfig, prefix: '.' });
  assert.equal(plan.eligible, true);
  assert.equal(plan.mode, 'quick_reply');
  assert.deepEqual(plan.actions.map(action => action.id), ['.project list', '.project status', '.project history']);
});

test('large safe option sets use one single-select list, not a crowded row of buttons', () => {
  const plugin = { name: 'rentals', category: 'owner', usage: '<status|list|pending|usage|audit|show|approve|reject>' };
  const plan = buildAdaptiveButtonPlan({ plugin, text: 'Pilih informasi yang ingin diperiksa.', config: enabledConfig });
  assert.equal(plan.mode, 'single_select');
  assert.deepEqual(plan.actions.map(action => action.command), [
    'rentals status', 'rentals list', 'rentals pending', 'rentals usage', 'rentals audit'
  ]);
});

test('plugin-defined actions override generic navigation and preserve complete subcommands', () => {
  const plugin = {
    name: 'groupadmin', category: 'general',
    ui: { fullButton: { actions: [
      { label: 'Info Grup', command: 'groupadmin info' },
      { label: 'Baca Aturan', command: 'groupadmin aturan' },
      { label: 'Menu Admin', command: 'groupadmin help' }
    ] } }
  };
  const plan = buildAdaptiveButtonPlan({ plugin, text: 'Panel admin grup siap digunakan.', config: enabledConfig });
  assert.equal(plan.mode, 'quick_reply');
  assert.deepEqual(plan.actions.map(action => action.id), ['.groupadmin info', '.groupadmin aturan', '.groupadmin help']);
});

test('permanent exceptions and owner exclusions are not affected', () => {
  const menu = buildAdaptiveButtonPlan({ plugin: { name: 'menu', aliases: ['help'] }, text: 'Menu siap.', config: enabledConfig });
  assert.equal(menu.mode, 'exempt');
  assert.match(menu.reason, /banner|navigasi/i);

  const custom = buildAdaptiveButtonPlan({
    plugin: { name: 'runtime' }, text: 'Status siap.',
    config: { ...enabledConfig, ui: { fullButton: { ...enabledConfig.ui.fullButton, excludedCommands: ['runtime'] } } }
  });
  assert.equal(custom.mode, 'exempt');
  assert.equal(custom.reason, 'owner-excluded');
  assert.ok(getHardButtonExemptions().yts);
});

test('long content, code blocks, stack traces and progress responses stay text', () => {
  const plugin = { name: 'runtime', category: 'developer' };
  for (const [text, reason] of [
    ['```js\nconsole.log(1)\n```', 'code-or-diagnostic'],
    ['TypeError: failed\n    at app.js:10:4', 'code-or-diagnostic'],
    ['Memproses permintaan. Mohon tunggu.', 'progress-message'],
    ['x'.repeat(1801), 'body-too-long']
  ]) {
    const plan = buildAdaptiveButtonPlan({ plugin, text, config: enabledConfig });
    assert.equal(plan.eligible, false);
    assert.equal(plan.reason, reason);
  }
});

test('full-button injection is scoped, passes alias invocation through canonical plugin, and restores m.reply', async () => {
  const calls = [];
  const sock = { sendInteractive: async (chat, options, quoted) => {
    calls.push({ chat, options, quoted });
    return { key: { id: 'interactive-1' } };
  } };
  const originalReply = async function (text) { return { text }; };
  const message = { chat: '6280000000000@s.whatsapp.net', reply: originalReply };
  const restore = withCommandButtons(sock, message, {
    plugin: { name: 'ping', aliases: ['speed'], category: 'general' },
    command: 'speed', prefix: '.', config: enabledConfig
  });
  const sent = await message.reply('Pong · 20 ms');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.body, 'Pong · 20 ms');
  assert.equal(calls[0].options.buttons.length, 3);
  assert.equal(calls[0].options.buttons[0].name, 'quick_reply');
  assert.equal(sent.key.id, 'interactive-1');
  restore();
  assert.equal(message.reply, originalReply);
});

test('quoted/fake replies and message options bypass automatic injection', async () => {
  let interactive = 0;
  let text = 0;
  const sock = { sendInteractive: async () => { interactive += 1; } };
  const message = { chat: '1@s.whatsapp.net', reply: async () => { text += 1; return 'plain'; } };
  const quoted = { key: { id: 'quoted-id' } };
  const restore = withCommandButtons(sock, message, { plugin: { name: 'ping' }, config: enabledConfig });
  await message.reply('fake reply', quoted, { fake: true });
  await message.reply('with options', message, { linkPreview: false });
  restore();
  assert.equal(interactive, 0);
  assert.equal(text, 2);
});

test('interactive relay failure safely falls back to the serializer text reply', async () => {
  let fallback = '';
  const sock = { sendInteractive: async () => { throw new Error('relay failed'); } };
  const message = { chat: '1@s.whatsapp.net', reply: async text => { fallback = text; return { fallback: true }; } };
  const restore = withCommandButtons(sock, message, { plugin: { name: 'ping' }, config: enabledConfig });
  const result = await message.reply('Pong · 12 ms');
  restore();
  assert.equal(fallback, 'Pong · 12 ms');
  assert.equal(result.fallback, true);
});

test('inventory audit shows canonical plugins, inherited aliases, and exception states', () => {
  const inventory = planButtonInventory([
    { name: 'ping', aliases: ['speed', 'latency'], category: 'general' },
    { name: 'yts', aliases: ['ytsearch'], category: 'general' }
  ], enabledConfig, '.');
  assert.equal(inventory[0].name, 'ping');
  assert.deepEqual(inventory[0].aliases, ['speed', 'latency']);
  assert.equal(inventory[0].mode, 'quick_reply');
  assert.equal(inventory[1].mode, 'exempt');
});
