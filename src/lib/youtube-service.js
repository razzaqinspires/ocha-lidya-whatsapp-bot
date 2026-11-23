import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const YT_DLP_BIN = String(process.env.YT_DLP_BIN || 'yt-dlp').trim() || 'yt-dlp';
const FFMPEG_LOCATION = String(process.env.FFMPEG_LOCATION || '').trim();
const DEFAULT_TIMEOUT_MS = 90_000;
const DOWNLOAD_TIMEOUT_MS = 180_000;
const MAX_JSON_BYTES = 12 * 1024 * 1024;
const MAX_DOWNLOAD_MB = clampNumber(process.env.YOUTUBE_MAX_DOWNLOAD_MB, 48, 8, 128);
const MAX_DURATION_SECONDS = clampNumber(process.env.YOUTUBE_MAX_DURATION_SECONDS, 1800, 30, 7200);
const SEARCH_RESULTS = clampNumber(process.env.YOUTUBE_SEARCH_RESULTS, 5, 2, 8);

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

function cleanText(value, max = 180) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function normalizeYouTubeUrl(input) {
  let url;
  try { url = new URL(String(input || '').trim()); }
  catch { throw new Error('URL YouTube tidak valid.'); }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const allowedHosts = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com']);
  if (!allowedHosts.has(host)) throw new Error('Hanya URL video dari youtube.com atau youtu.be yang diterima.');

  let id = '';
  if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || '';
  else if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
  else {
    const parts = url.pathname.split('/').filter(Boolean);
    if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1] || '';
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('URL harus menunjuk ke satu video YouTube yang memiliki ID valid, bukan playlist/channel.');
  return `https://www.youtube.com/watch?v=${id}`;
}

export function getYouTubeVideoId(input) {
  const canonical = normalizeYouTubeUrl(input);
  return new URL(canonical).searchParams.get('v');
}

function runYtDlp(args, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, maxOutputBytes = MAX_JSON_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(YT_DLP_BIN, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      const forceKill = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2500);
      forceKill.unref?.();
      finish(new Error(`yt-dlp melewati batas waktu ${Math.round(timeoutMs / 1000)} detik.`));
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
      if (Buffer.byteLength(stdout) > maxOutputBytes) {
        try { child.kill('SIGTERM'); } catch {}
        finish(new Error('Output yt-dlp melebihi batas aman.'));
      }
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 24_000) stderr = stderr.slice(-24_000);
    });
    child.once('error', error => {
      if (error.code === 'ENOENT') {
        finish(new Error(`yt-dlp tidak ditemukan. Pasang yt-dlp di server atau atur YT_DLP_BIN. (${YT_DLP_BIN})`));
      } else finish(error);
    });
    child.once('close', (code, signal) => {
      if (code === 0) finish(null, { stdout, stderr });
      else {
        const detail = cleanText(stderr || stdout || `exit ${code ?? signal}`, 700);
        finish(new Error(`yt-dlp gagal (${code ?? signal}): ${detail}`));
      }
    });
  });
}

function parseJsonOutput(stdout) {
  const value = String(stdout || '').trim();
  try { return JSON.parse(value); }
  catch {
    const first = value.indexOf('{');
    const last = value.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(value.slice(first, last + 1)); } catch {}
    }
    throw new Error('Metadata YouTube tidak dapat dibaca dari keluaran yt-dlp.');
  }
}

function canonicalUrlFromEntry(entry) {
  const id = String(entry?.id || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  const raw = entry?.webpage_url || entry?.original_url || entry?.url;
  try { return normalizeYouTubeUrl(raw); } catch { return ''; }
}

function normalizeResult(entry, detail = null) {
  const source = detail || entry || {};
  const url = canonicalUrlFromEntry(entry) || canonicalUrlFromEntry(source);
  if (!url) return null;
  const id = getYouTubeVideoId(url);
  return {
    id,
    url,
    title: cleanText(source.title || entry.title || 'YouTube video', 180),
    channel: cleanText(source.channel || source.uploader || entry.channel || entry.uploader || 'Kanal tidak diketahui', 100),
    duration: Number.isFinite(Number(source.duration ?? entry.duration)) ? Number(source.duration ?? entry.duration) : null,
    views: Number.isFinite(Number(source.view_count ?? entry.view_count)) ? Number(source.view_count ?? entry.view_count) : null,
    uploadDate: cleanText(source.upload_date || entry.upload_date || '', 16),
    thumbnail: source.thumbnail || entry.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    resolutions: getAvailableMp4Resolutions(source)
  };
}

export function getAvailableMp4Resolutions(info) {
  const unique = new Map();
  for (const format of Array.isArray(info?.formats) ? info.formats : []) {
    const height = Number(format?.height);
    const hasVideo = format?.vcodec && format.vcodec !== 'none';
    if (!Number.isInteger(height) || height <= 0 || !hasVideo || format.ext !== 'mp4') continue;
    const previous = unique.get(height);
    const score = Number(format.fps || 0) * 10 + (format.acodec && format.acodec !== 'none' ? 1 : 0);
    if (!previous || score > previous.score) {
      unique.set(height, { height, fps: Number(format.fps || 0), formatId: String(format.format_id || ''), score });
    }
  }
  if (!unique.size && info?.ext === 'mp4' && Number.isInteger(Number(info.height))) {
    const height = Number(info.height);
    unique.set(height, { height, fps: Number(info.fps || 0), formatId: String(info.format_id || ''), score: 0 });
  }
  return [...unique.values()]
    .sort((a, b) => b.height - a.height)
    .map(({ height, fps, formatId }) => ({ height, fps, formatId }));
}

async function mapLimit(values, limit, handler) {
  const results = new Array(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await handler(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function getVideoInfo(canonicalUrl) {
  const result = await runYtDlp([
    '--dump-single-json', '--skip-download', '--no-warnings', '--no-progress', '--no-playlist', '--no-cache-dir', canonicalUrl
  ], { timeoutMs: DEFAULT_TIMEOUT_MS });
  return parseJsonOutput(result.stdout);
}

/** Fetch one video's metadata and available formats without downloading media. */
export async function getYouTubeVideoInfo(input) {
  const url = normalizeYouTubeUrl(input);
  const info = await getVideoInfo(url);
  validateDuration(info);
  const result = normalizeResult({ id: getYouTubeVideoId(url), webpage_url: url }, info);
  if (!result) throw new Error('Metadata video YouTube tidak lengkap.');
  return result;
}

export async function searchYouTube(query, limit = SEARCH_RESULTS) {
  const cleanQuery = cleanText(query, 120);
  if (cleanQuery.length < 2) throw new Error('Masukkan kata kunci YouTube minimal 2 karakter.');
  const count = clampNumber(limit, SEARCH_RESULTS, 1, 8);
  const result = await runYtDlp([
    '--dump-single-json', '--flat-playlist', '--skip-download', '--no-warnings', '--no-progress', '--no-cache-dir', `ytsearch${count}:${cleanQuery}`
  ], { timeoutMs: DEFAULT_TIMEOUT_MS });
  const data = parseJsonOutput(result.stdout);
  const entries = Array.isArray(data.entries) ? data.entries : [data];
  const validEntries = entries.map(entry => ({ entry, url: canonicalUrlFromEntry(entry) })).filter(item => item.url).slice(0, count);
  const detailed = await mapLimit(validEntries, 2, async ({ entry, url }) => {
    try {
      const info = await getVideoInfo(url);
      return normalizeResult(entry, info);
    } catch {
      return normalizeResult(entry, null);
    }
  });
  return detailed.filter(Boolean);
}

function validateDuration(info) {
  const duration = Number(info?.duration);
  if (Number.isFinite(duration) && duration > MAX_DURATION_SECONDS) {
    throw new Error(`Video terlalu panjang. Batas bot saat ini ${Math.floor(MAX_DURATION_SECONDS / 60)} menit.`);
  }
}

function sanitizeFileStem(value) {
  const stem = cleanText(value, 80)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return stem || 'youtube-media';
}

async function createWorkdir(kind) {
  return fs.mkdtemp(path.join(os.tmpdir(), `ocha-youtube-${kind}-`));
}

async function locateOutput(directory, extension) {
  const files = await fs.readdir(directory, { withFileTypes: true });
  const matches = [];
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(extension)) continue;
    const fullPath = path.join(directory, entry.name);
    const stat = await fs.stat(fullPath);
    if (stat.size > 0) matches.push({ path: fullPath, size: stat.size });
  }
  matches.sort((a, b) => b.size - a.size);
  return matches[0] || null;
}

async function readBoundedOutput(directory, extension) {
  const output = await locateOutput(directory, extension);
  if (!output) throw new Error(`File ${extension.toUpperCase()} tidak dihasilkan. Periksa ketersediaan FFmpeg/ffprobe dan dukungan format sumber.`);
  const maxBytes = MAX_DOWNLOAD_MB * 1024 * 1024;
  if (output.size > maxBytes) throw new Error(`Ukuran file melebihi batas ${MAX_DOWNLOAD_MB} MB. Pilih resolusi lebih rendah.`);
  return fs.readFile(output.path);
}

export async function downloadYouTubeMp3(inputUrl) {
  const url = normalizeYouTubeUrl(inputUrl);
  const info = await getVideoInfo(url);
  validateDuration(info);
  const directory = await createWorkdir('audio');
  try {
    await runYtDlp([
      '--no-warnings', '--no-progress', '--no-part', '--no-mtime', '--no-cache-dir', '--no-playlist',
      '--max-filesize', `${MAX_DOWNLOAD_MB}M`, '--match-filter', `duration <= ${MAX_DURATION_SECONDS}`,
      ...(FFMPEG_LOCATION ? ['--ffmpeg-location', FFMPEG_LOCATION] : []),
      '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '192K',
      '--output', 'audio.%(ext)s', url
    ], { cwd: directory, timeoutMs: DOWNLOAD_TIMEOUT_MS, maxOutputBytes: 2 * 1024 * 1024 });
    const buffer = await readBoundedOutput(directory, '.mp3');
    return {
      buffer,
      fileName: `${sanitizeFileStem(info.title)}.mp3`,
      title: cleanText(info.title || 'YouTube audio', 180),
      channel: cleanText(info.channel || info.uploader || '', 100),
      duration: Number.isFinite(Number(info.duration)) ? Number(info.duration) : null,
      size: buffer.length,
      url
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

export async function downloadYouTubeMp4(inputUrl, resolution = 'best') {
  const url = normalizeYouTubeUrl(inputUrl);
  const quality = String(resolution || 'best').toLowerCase();
  if (quality !== 'best' && !/^\d{2,4}$/.test(quality)) throw new Error('Resolusi harus berupa angka seperti 360, 720, 1080 atau best.');
  const info = await getVideoInfo(url);
  validateDuration(info);
  const available = getAvailableMp4Resolutions(info);
  const maxHeight = quality === 'best' ? null : Number(quality);
  if (maxHeight && available.length && !available.some(item => item.height <= maxHeight)) {
    throw new Error(`Resolusi ${maxHeight}p tidak tersedia. Resolusi MP4 tersedia: ${available.map(item => `${item.height}p`).join(', ')}.`);
  }
  if (maxHeight && available.length && !available.some(item => item.height === maxHeight) && available.every(item => item.height > maxHeight)) {
    throw new Error(`Tidak ada format MP4 pada atau di bawah ${maxHeight}p.`);
  }

  const format = maxHeight
    ? `bestvideo[ext=mp4][height<=${maxHeight}]+bestaudio[ext=m4a]/best[ext=mp4][height<=${maxHeight}]`
    : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]';
  const detectedHeight = available[0]?.height || (Number.isInteger(Number(info.height)) && Number(info.height) > 0 ? Number(info.height) : null);
  const selectedHeight = maxHeight
    ? (available.find(item => item.height <= maxHeight)?.height || (detectedHeight && detectedHeight <= maxHeight ? detectedHeight : null))
    : detectedHeight;
  const directory = await createWorkdir('video');
  try {
    await runYtDlp([
      '--no-warnings', '--no-progress', '--no-part', '--no-mtime', '--no-cache-dir', '--no-playlist',
      '--max-filesize', `${MAX_DOWNLOAD_MB}M`, '--match-filter', `duration <= ${MAX_DURATION_SECONDS}`,
      ...(FFMPEG_LOCATION ? ['--ffmpeg-location', FFMPEG_LOCATION] : []),
      '--format', format, '--merge-output-format', 'mp4', '--output', 'video.%(ext)s', url
    ], { cwd: directory, timeoutMs: DOWNLOAD_TIMEOUT_MS, maxOutputBytes: 2 * 1024 * 1024 });
    const buffer = await readBoundedOutput(directory, '.mp4');
    return {
      buffer,
      fileName: `${sanitizeFileStem(info.title)}.mp4`,
      title: cleanText(info.title || 'YouTube video', 180),
      channel: cleanText(info.channel || info.uploader || '', 100),
      duration: Number.isFinite(Number(info.duration)) ? Number(info.duration) : null,
      height: selectedHeight,
      size: buffer.length,
      url
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

export function buildYouTubeDownloadRows(video) {
  const rows = [{
    header: 'Audio',
    title: 'Unduh MP3',
    description: 'Audio saja · format MP3',
    id: `.ytmp3 ${video.url}`
  }];
  const resolutions = Array.isArray(video.resolutions) ? video.resolutions : [];
  if (resolutions.length) {
    for (const item of resolutions) {
      rows.push({
        title: `MP4 ${item.height}p${item.fps >= 50 ? ` · ${Math.round(item.fps)} fps` : ''}`,
        description: `Video MP4 · resolusi ${item.height}p`,
        id: `.ytmp4 ${video.url} ${item.height}`
      });
    }
  } else {
    rows.push({ title: 'MP4 kualitas tertinggi', description: 'Pilih format MP4 terbaik yang tersedia', id: `.ytmp4 ${video.url} best` });
  }
  return rows;
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || seconds === '') return 'Durasi tidak diketahui';
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return 'Durasi tidak diketahui';
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function formatViewCount(value) {
  if (value === null || value === undefined || value === '') return '—';
  const count = Number(value);
  return Number.isFinite(count) && count >= 0
    ? new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(count).replace(/[\u00a0\u202f]/g, ' ')
    : '—';
}

export const youtubeLimits = Object.freeze({ maxDownloadMb: MAX_DOWNLOAD_MB, maxDurationSeconds: MAX_DURATION_SECONDS, searchResults: SEARCH_RESULTS });
