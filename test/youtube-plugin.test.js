import test from 'node:test';
import assert from 'node:assert/strict';
import youtubePlugin, { youtubeSearchSessionTestHooks } from '../src/plugins/general/youtube.js';
import { resolvePluginExecutionCommand } from '../src/core/plugin-execution.js';
import { parseNativeFlowResponse } from '../src/lib/message-text.js';

function mockMessage() {
  const replies = [];
  return {
    replies,
    async reply(text) { replies.push(String(text)); return text; }
  };
}

test('YouTube plugin registers all expected commands and aliases', () => {
  assert.equal(youtubePlugin.name, 'yts');
  for (const alias of ['ytsearch', 'ytmp3', 'ytmp4', 'ytm', 'ytmusic', 'ytplay']) {
    assert.ok(youtubePlugin.aliases.includes(alias));
  }
  assert.match(youtubePlugin.usage, /\.ytm/);
  assert.equal(youtubePlugin.preserveAlias, true);
  assert.equal(resolvePluginExecutionCommand(youtubePlugin, { command: 'yts', matchedCommand: 'ytmp3' }), 'ytmp3');
  assert.equal(resolvePluginExecutionCommand(youtubePlugin, { command: 'yts', matchedCommand: 'ytmp4' }), 'ytmp4');
});

test('YouTube commands explain required arguments before starting a download', async () => {
  const m = mockMessage();
  await youtubePlugin.execute({ sock: {}, m, command: 'ytmp3', args: [] });
  assert.match(m.replies.at(-1), /\.ytmp3 <url-video-youtube>/);

  await youtubePlugin.execute({ sock: {}, m, command: 'ytmp4', args: [] });
  assert.match(m.replies.at(-1), /\.ytmp4 <url-video-youtube>/);

  await youtubePlugin.execute({ sock: {}, m, command: 'ytm', args: [] });
  assert.match(m.replies.at(-1), /\.ytm <judul lagu \/ artis>/);

  await youtubePlugin.execute({ sock: {}, m, command: 'yts', args: [] });
  assert.match(m.replies.at(-1), /\.yts <kata kunci>/);
});

test('YouTube download commands reject non-YouTube URLs before invoking media tools', async () => {
  const m = mockMessage();
  await youtubePlugin.execute({ sock: {}, m, command: 'ytmp3', args: ['https://example.com/video'] });
  assert.match(m.replies.at(-1), /Hanya URL video dari youtube.com/);

  await youtubePlugin.execute({ sock: {}, m, command: 'ytmp4', args: ['https://example.com/video', '720'] });
  assert.match(m.replies.at(-1), /Hanya URL video dari youtube.com/);
});


test('YouTube search sessions are private to the original chat and sender', () => {
  youtubeSearchSessionTestHooks.clear();
  const ownerMessage = { chat: '120363000000@g.us', sender: '628111111111@s.whatsapp.net' };
  const token = youtubeSearchSessionTestHooks.createSearchSession(ownerMessage, 'man ana', 5);
  const session = youtubeSearchSessionTestHooks.getSearchSession(token, ownerMessage);
  assert.equal(session.query, 'man ana');
  assert.equal(session.nextOffset, 5);
  assert.equal(youtubeSearchSessionTestHooks.getSearchSession(token, { ...ownerMessage, sender: '628222222222@s.whatsapp.net' }), null);
  assert.equal(youtubeSearchSessionTestHooks.getSearchSession(token, { ...ownerMessage, chat: '628111111111@s.whatsapp.net' }), null);
  youtubeSearchSessionTestHooks.pruneSearchSessions(Date.now() + 16 * 60_000);
  assert.equal(youtubeSearchSessionTestHooks.getSearchSession(token, ownerMessage), null);
});

test('YouTube carousel has five text-only video cards and one final next-page quick reply', async () => {
  const captured = {};
  const sock = {
    carouselBuilder() {
      const builder = {
        setTitle(value) { captured.title = value; return this; },
        setSubtitle(value) { captured.subtitle = value; return this; },
        setBody(value) { captured.body = value; return this; },
        setFooter(value) { captured.footer = value; return this; },
        addCard(cards) { captured.cards = cards; return this; },
        async send(chat) { captured.chat = chat; return { key: { id: 'carousel-test' } }; }
      };
      return builder;
    }
  };
  const videos = Array.from({ length: 5 }, (_, index) => ({
    url: `https://www.youtube.com/watch?v=${String(index).padStart(11, '0')}`,
    title: `Video ${index + 1}`, channel: 'Test channel', duration: 100, views: 1000,
    resolutions: [{ height: 720, fps: 30 }], thumbnail: 'https://example.com/should-not-be-used.jpg'
  }));
  await youtubeSearchSessionTestHooks.sendVideoCarousel(sock, { chat: 'chat', key: { id: 'quoted' } }, videos, 'man ana', { nextToken: 'nextToken123', pageNumber: 1 });
  assert.equal(captured.cards.length, 6);
  assert.ok(captured.cards.slice(0, 5).every(card => !card.header.imageUrl && !card.header.image));
  const firstParams = JSON.parse(captured.cards[0].nativeFlowMessage.buttons[0].buttonParamsJson);
  assert.match(firstParams.sections[0].rows[0].id, /^\.ytmp3 https:\/\/www\.youtube\.com\/watch\?v=/);
  const last = captured.cards[5];
  assert.equal(last.header.title, 'HASIL BERIKUTNYA');
  const nextParams = JSON.parse(last.nativeFlowMessage.buttons[0].buttonParamsJson);
  assert.equal(nextParams.display_text, 'Hasil berikutnya');
  assert.equal(nextParams.id, '.yts next nextToken123');
});


test('native-flow MP3 row ID survives response parsing and is routed as the ytmp3 alias', () => {
  const selected = '.ytmp3 https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const response = parseNativeFlowResponse({
    nativeFlowResponseMessage: {
      name: 'single_select',
      paramsJson: JSON.stringify({ id: selected, row_id: selected })
    }
  });
  assert.equal(response.selectedId, selected);
  const [command, ...args] = response.selectedId.replace(/^\./, '').split(/\s+/);
  assert.equal(command, 'ytmp3');
  assert.deepEqual(args, ['https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
  assert.equal(resolvePluginExecutionCommand(youtubePlugin, { command: 'yts', matchedCommand: command }), 'ytmp3');
});
