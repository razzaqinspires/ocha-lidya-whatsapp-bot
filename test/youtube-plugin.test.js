import test from 'node:test';
import assert from 'node:assert/strict';
import youtubePlugin from '../src/plugins/general/youtube.js';

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
