import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('YouTube settings are read dynamically from app config and ignore legacy env overrides', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-youtube-config-test-'));
  try {
    const configUrl = pathToFileURL(path.resolve(original, 'src/config.js')).href;
    const serviceUrl = pathToFileURL(path.resolve(original, 'src/lib/youtube-service.js')).href;
    const pluginUrl = pathToFileURL(path.resolve(original, 'src/plugins/owner/ytconfig.js')).href;
    const source = `
      const config = await import(${JSON.stringify(configUrl)});
      await config.loadConfig();
      const service = await import(${JSON.stringify(serviceUrl)});
      const plugin = (await import(${JSON.stringify(pluginUrl)})).default;
      if (service.youtubeLimits.maxDownloadMb !== 48 || service.youtubeLimits.maxDurationSeconds !== 1800 || service.youtubeLimits.searchResults !== 5) throw new Error('default settings mismatch');
      const replies = [];
      const m = { sender: '628123456789@s.whatsapp.net', reply: async value => { replies.push(value); return value; } };
      await plugin.execute({ m, args: ['maxsize', '72'] });
      await plugin.execute({ m, args: ['maxduration', '2700'] });
      await plugin.execute({ m, args: ['results', '7'] });
      await plugin.execute({ m, args: ['binary', '/usr/local/bin/yt-dlp'] });
      await plugin.execute({ m, args: ['ffmpeg', '/usr/bin'] });
      const active = config.getConfig().youtube;
      if (active.maxDownloadMb !== 72 || active.maxDurationSeconds !== 2700 || active.searchResults !== 7) throw new Error('persisted values mismatch');
      if (active.ytDlpBin !== '/usr/local/bin/yt-dlp' || active.ffmpegLocation !== '/usr/bin') throw new Error('path values mismatch');
      if (service.youtubeLimits.maxDownloadMb !== 72 || service.youtubeLimits.maxDurationSeconds !== 2700 || service.youtubeLimits.searchResults !== 7) throw new Error('service did not observe live updates');
      console.log('YOUTUBE_CONFIG_OK');
    `;
    const env = { ...process.env, YT_DLP_BIN: '/ignored/from-env', FFMPEG_LOCATION: '/ignored/from-env', YOUTUBE_MAX_DOWNLOAD_MB: '120', YOUTUBE_MAX_DURATION_SECONDS: '7200', YOUTUBE_SEARCH_RESULTS: '8' };
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temp, encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /YOUTUBE_CONFIG_OK/);
  } finally {
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
