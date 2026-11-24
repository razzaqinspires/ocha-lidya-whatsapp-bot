import test from 'node:test';
import assert from 'node:assert/strict';
import { NUMBERED_TESTS, sendMessageTestMenu } from '../src/plugins/owner/message-test-catalog.js';

test('Message Test Lab catalog contains all 16 numbered payload suites in the supplied order', () => {
  assert.equal(NUMBERED_TESTS.length, 16);
  assert.deepEqual(NUMBERED_TESTS.map(item => item.number), Array.from({ length: 16 }, (_, index) => index + 1));
  assert.match(NUMBERED_TESTS[0].title, /Legacy buttonsMessage/i);
  assert.match(NUMBERED_TESTS[7].title, /Native Flow Core/i);
  assert.match(NUMBERED_TESTS[13].title, /Carousel/i);
  assert.match(NUMBERED_TESTS[15].title, /AIRich/i);
});

test('Message Test Lab menu uses serializer ButtonBuilder contract and two numbered pages', async () => {
  const pages = [];
  function makeBuilder() {
    const state = { sections: [] };
    const builder = {
      setTitle(v) { state.title = v; return this; },
      setSubtitle(v) { state.subtitle = v; return this; },
      setBody(v) { state.body = v; return this; },
      setFooter(v) { state.footer = v; return this; },
      addSelection(v) { state.selection = v; return this; },
      makeSection(title, highlight) { state.sections.push({ title, highlight, rows: [] }); return this; },
      makeRow(header, title, description, id) { state.sections.at(-1).rows.push({ header, title, description, id }); return this; },
      async send(chat, options) { pages.push({ state, chat, options }); return { key: { id: 'test-menu' } }; }
    };
    return builder;
  }
  const sock = { buttonBuilder: makeBuilder };
  const m = { chat: '6283193905842@s.whatsapp.net', key: { id: 'owner-command' } };
  await sendMessageTestMenu(sock, m, 1);
  await sendMessageTestMenu(sock, m, 2);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].state.sections[0].rows.length, 9);
  assert.equal(pages[1].state.sections[0].rows.length, 10);
  assert.equal(pages[0].state.sections[0].rows[0].id, '.test select 1');
  assert.equal(pages[1].state.sections[0].rows[0].id, '.test select 9');
  assert.equal(pages[1].state.sections[0].rows.at(-2).id, '.test select all');
  assert.equal(pages[0].options.quoted, m);
});
