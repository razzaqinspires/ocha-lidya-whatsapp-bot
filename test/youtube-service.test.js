import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeYouTubeUrl,
  getYouTubeVideoId,
  getAvailableMp4Resolutions,
  buildYouTubeDownloadRows,
  formatDuration,
  formatViewCount
} from '../src/lib/youtube-service.js';

const videoUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test('normalizes supported YouTube video URL forms', () => {
  assert.equal(normalizeYouTubeUrl(videoUrl), videoUrl);
  assert.equal(normalizeYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=10'), videoUrl);
  assert.equal(normalizeYouTubeUrl('https://youtube.com/shorts/dQw4w9WgXcQ'), videoUrl);
  assert.equal(normalizeYouTubeUrl('https://m.youtube.com/embed/dQw4w9WgXcQ'), videoUrl);
  assert.equal(normalizeYouTubeUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), videoUrl);
  assert.equal(getYouTubeVideoId(videoUrl), 'dQw4w9WgXcQ');
});

test('rejects unrelated hosts, invalid IDs, and playlist-only URLs', () => {
  assert.throws(() => normalizeYouTubeUrl('https://example.com/watch?v=dQw4w9WgXcQ'), /Hanya URL video/);
  assert.throws(() => normalizeYouTubeUrl('https://youtube.com/watch?v=invalid'), /ID valid/);
  assert.throws(() => normalizeYouTubeUrl('https://youtube.com/playlist?list=PL123'), /bukan playlist/);
  assert.throws(() => normalizeYouTubeUrl('not a URL'), /tidak valid/);
});

test('collects unique available MP4 heights and ignores audio-only formats', () => {
  const formats = getAvailableMp4Resolutions({ formats: [
    { ext: 'mp4', height: 720, vcodec: 'avc1', acodec: 'none', fps: 30, format_id: '137' },
    { ext: 'mp4', height: 720, vcodec: 'avc1', acodec: 'mp4a', fps: 60, format_id: '22' },
    { ext: 'mp4', height: 1080, vcodec: 'avc1', acodec: 'none', fps: 30, format_id: '248' },
    { ext: 'm4a', height: null, vcodec: 'none', acodec: 'mp4a', format_id: '140' },
    { ext: 'webm', height: 2160, vcodec: 'vp9', acodec: 'none', format_id: '313' }
  ] });
  assert.deepEqual(formats.map(item => item.height), [1080, 720]);
  assert.equal(formats[1].fps, 60);
});

test('builds separate MP3 and every MP4 resolution selection', () => {
  const rows = buildYouTubeDownloadRows({
    url: videoUrl,
    resolutions: [{ height: 1080, fps: 30 }, { height: 720, fps: 60 }, { height: 480, fps: 30 }]
  });
  assert.equal(rows.length, 4);
  assert.match(rows[0].id, /^\.ytmp3 /);
  assert.deepEqual(rows.slice(1).map(row => row.id), [
    `.ytmp4 ${videoUrl} 1080`,
    `.ytmp4 ${videoUrl} 720`,
    `.ytmp4 ${videoUrl} 480`
  ]);
});

test('uses a best MP4 fallback when format metadata has no MP4 resolutions', () => {
  const rows = buildYouTubeDownloadRows({ url: videoUrl, resolutions: [] });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].id, `.ytmp4 ${videoUrl} best`);
});

test('formats duration and view counts consistently', () => {
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3661), '1:01:01');
  assert.equal(formatDuration(null), 'Durasi tidak diketahui');
  assert.equal(formatViewCount(1200), '1,2 rb');
  assert.equal(formatViewCount(null), '—');
});
