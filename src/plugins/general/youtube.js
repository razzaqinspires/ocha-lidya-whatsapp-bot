import { randomBytes } from 'node:crypto';
import {
  searchYouTube,
  searchYouTubePage,
  getYouTubeVideoInfo,
  downloadYouTubeMp3,
  downloadYouTubeMp4,
  buildYouTubeDownloadRows,
  formatDuration,
  formatViewCount,
  youtubeLimits
} from '../../lib/youtube-service.js';

const FOOTER = 'Ocha Lidya AI · Razzaq Ventures';
const PAGE_SIZE = 5;
const SESSION_TTL_MS = 15 * 60_000;
const MAX_SEARCH_SESSIONS = 1000;
const searchSessions = new Map();

function cleanCaption(value, max = 120) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function videoSummary(video) {
  return [
    `Kanal: ${cleanCaption(video.channel, 80) || 'Tidak diketahui'}`,
    `Durasi: ${formatDuration(video.duration)}`,
    `Penayangan: ${formatViewCount(video.views)}`,
    video.uploadDate ? `Tanggal unggah: ${video.uploadDate}` : ''
  ].filter(Boolean).join('\n');
}

function nativeListButton(video) {
  const rows = buildYouTubeDownloadRows(video);
  return {
    name: 'single_select',
    buttonParamsJson: JSON.stringify({
      title: 'MP3 / MP4 · Pilih kualitas',
      sections: [{ title: 'Pilih format unduhan', rows }]
    })
  };
}

function nextPageButton(token) {
  return {
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: 'Hasil berikutnya',
      id: `.yts next ${token}`
    })
  };
}

function pruneSearchSessions(now = Date.now()) {
  for (const [token, session] of searchSessions) {
    if (!session || session.expiresAt <= now) searchSessions.delete(token);
  }
  while (searchSessions.size > MAX_SEARCH_SESSIONS) {
    searchSessions.delete(searchSessions.keys().next().value);
  }
}

function createSearchSession(m, query, nextOffset) {
  pruneSearchSessions();
  const token = randomBytes(9).toString('base64url');
  searchSessions.set(token, {
    chat: String(m.chat || ''),
    sender: String(m.sender || ''),
    query: String(query),
    nextOffset: Number(nextOffset) || PAGE_SIZE,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return token;
}

function getSearchSession(token, m) {
  pruneSearchSessions();
  const session = searchSessions.get(String(token || ''));
  if (!session) return null;
  if (session.chat !== String(m.chat || '') || session.sender !== String(m.sender || '')) return null;
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function buildVideoCard(video, index, pageNumber) {
  return {
    header: {
      title: cleanCaption(video.title, 60) || `Video ${index + 1}`,
      subtitle: cleanCaption(video.channel, 50)
    },
    body: {
      text: `${videoSummary(video)}\n\nPilih MP3 atau resolusi MP4 dari daftar.`
    },
    footer: { text: `Hasil ${index + 1} · Halaman ${pageNumber}` },
    nativeFlowMessage: {
      buttons: [nativeListButton(video)],
      messageParamsJson: '{}',
      messageVersion: 1
    }
  };
}

function buildNextPageCard(query, token, pageNumber) {
  return {
    header: {
      title: 'HASIL BERIKUTNYA',
      subtitle: `Pencarian: ${cleanCaption(query, 60)}`
    },
    body: {
      text: `Halaman ${pageNumber} selesai. Pilih tombol di bawah untuk memuat lima hasil berikutnya.`
    },
    footer: { text: FOOTER },
    nativeFlowMessage: {
      buttons: [nextPageButton(token)],
      messageParamsJson: '{}',
      messageVersion: 1
    }
  };
}

async function sendVideoCarousel(sock, m, videos, query, { nextToken = null, pageNumber = 1 } = {}) {
  const nextButton = nextToken ? nextPageButton(nextToken) : null;
  if (videos.length === 1) {
    const video = videos[0];
    if (typeof sock.sendInteractive === 'function') {
      const buttons = [nativeListButton(video)];
      if (nextButton) buttons.push(nextButton);
      return sock.sendInteractive(m.chat, {
        title: cleanCaption(video.title, 70),
        subtitle: cleanCaption(video.channel, 70),
        body: `${videoSummary(video)}\n\nPilih MP3 atau salah satu resolusi MP4 yang tersedia.${nextToken ? '\n\nTersedia hasil pencarian berikutnya.' : ''}`,
        footer: FOOTER,
        buttons
      }, m);
    }
    return m.reply(`${video.title}\n${videoSummary(video)}\n${buildYouTubeDownloadRows(video).map(row => `${row.title}: ${row.id}`).join('\n')}${nextToken ? `\n\nHasil berikutnya: .yts next ${nextToken}` : ''}`);
  }

  if (typeof sock.carouselBuilder !== 'function') {
    const compact = videos.map((video, index) => `${index + 1}. ${video.title}\n${videoSummary(video)}\n${buildYouTubeDownloadRows(video).map(row => `${row.title}: ${row.id}`).join('\n')}`).join('\n\n');
    return m.reply(`${compact}${nextToken ? `\n\nHasil berikutnya: .yts next ${nextToken}` : ''}`);
  }

  const cards = videos.map((video, index) => buildVideoCard(video, index + 1, pageNumber));
  if (nextToken) cards.push(buildNextPageCard(query, nextToken, pageNumber + 1));

  try {
    return await sock.carouselBuilder()
      .setTitle('HASIL PENCARIAN YOUTUBE')
      .setSubtitle(cleanCaption(query, 80))
      .setBody(`Menampilkan ${videos.length} hasil · Halaman ${pageNumber}. Geser kartu, lalu buka daftar MP3 / MP4 pada video yang dipilih.`)
      .setFooter(FOOTER)
      .addCard(cards)
      .send(m.chat, { quoted: m });
  } catch (error) {
    const compact = videos.map((video, index) => `${index + 1}. ${video.title}\n${video.url}\n${videoSummary(video)}\n${buildYouTubeDownloadRows(video).map(row => `${row.title}: ${row.id}`).join('\n')}`).join('\n\n');
    await m.reply(`Carousel YouTube gagal dikirim.\n\n${compact}${nextToken ? `\n\nHasil berikutnya: .yts next ${nextToken}` : ''}`);
    return null;
  }
}

async function deliverMp3(sock, m, videoOrUrl) {
  const result = await downloadYouTubeMp3(videoOrUrl);
  await sock.sendMessage(m.chat, {
    audio: result.buffer,
    mimetype: 'audio/mpeg',
    ptt: false,
    fileName: result.fileName
  }, { quoted: m });
  return null;
}

async function deliverMp4(sock, m, url, resolution) {
  const result = await downloadYouTubeMp4(url, resolution);
  await sock.sendMessage(m.chat, {
    video: result.buffer,
    mimetype: 'video/mp4',
    fileName: result.fileName,
    caption: `${result.title}\n${result.height ? `Resolusi: ${result.height}p\n` : ''}Sumber: ${result.url}`
  }, { quoted: m });
  return null;
}

async function renderSearchPage(sock, m, query, offset, session = null) {
  const page = await searchYouTubePage(query, { limit: PAGE_SIZE, offset });
  if (!page.videos.length) {
    if (session) searchSessions.delete(session.token);
    return m.reply(offset > 0 ? 'Tidak ada hasil berikutnya yang tersedia untuk pencarian ini.' : 'Tidak ada hasil video yang dapat dibaca. Coba kata kunci lain.');
  }

  let nextToken = null;
  if (page.hasMore && page.nextOffset <= 35) {
    if (session?.token) searchSessions.delete(session.token);
    nextToken = createSearchSession(m, query, page.nextOffset);
  } else if (session?.token) {
    searchSessions.delete(session.token);
  }

  return sendVideoCarousel(sock, m, page.videos, query, {
    nextToken,
    pageNumber: Math.floor(offset / PAGE_SIZE) + 1
  });
}

async function handleCommand(sock, m, command, args) {
  const first = String(args[0] || '').trim();
  switch (command) {
    case 'yts':
    case 'ytsearch': {
      if (first.toLowerCase() === 'next') {
        const token = String(args[1] || '').trim();
        const session = getSearchSession(token, m);
        if (!session) return m.reply('Sesi hasil pencarian sudah kedaluwarsa atau bukan milik akun ini. Jalankan `.yts <kata kunci>` untuk mencari ulang.');
        session.token = token;
        return renderSearchPage(sock, m, session.query, session.nextOffset, session);
      }
      const query = args.join(' ').trim();
      if (query.length < 2) return m.reply('Gunakan *.yts <kata kunci>* untuk mencari video YouTube.');
      return renderSearchPage(sock, m, query, 0);
    }

    case 'ytmp3': {
      if (!first) return m.reply('Gunakan *.ytmp3 <url-video-youtube>* untuk mengunduh audio MP3.');
      return deliverMp3(sock, m, first);
    }

    case 'ytmp4': {
      if (!first) return m.reply('Gunakan *.ytmp4 <url-video-youtube>* untuk melihat resolusi MP4, atau *.ytmp4 <url> <resolusi>* untuk mengunduh langsung.');
      const resolutionArg = String(args[1] || '').toLowerCase();
      const resolution = resolutionArg === 'best' ? 'best' : resolutionArg.match(/^(\d{2,4})p?$/)?.[1];
      if (!resolution) {
        const video = await getYouTubeVideoInfo(first);
        const buttons = [nativeListButton(video)];
        if (typeof sock.sendInteractive === 'function') {
          return sock.sendInteractive(m.chat, {
            title: cleanCaption(video.title, 70),
            subtitle: cleanCaption(video.channel, 70),
            body: `${videoSummary(video)}\n\nPilih salah satu format MP3 atau resolusi MP4 yang tersedia.`,
            footer: FOOTER,
            buttons
          }, m);
        }
        return m.reply(`Format tersedia untuk ${video.title}:\n${buildYouTubeDownloadRows(video).map(row => `${row.title}: ${row.id}`).join('\n')}`);
      }
      return deliverMp4(sock, m, first, resolution);
    }

    case 'ytm':
    case 'ytmusic':
    case 'ytplay': {
      const query = args.join(' ').trim();
      if (query.length < 2) return m.reply('Gunakan *.ytm <judul lagu / artis>* untuk mencari dan mengirim audio saja.');
      const [video] = await searchYouTube(`${query} official audio`, 1);
      if (!video) return m.reply('Lagu tidak ditemukan. Coba judul dan nama artis yang lebih spesifik.');
      await m.reply(`Memproses audio: *${video.title}*\n${video.channel} · ${formatDuration(video.duration)}`);
      return deliverMp3(sock, m, video.url);
    }

    default:
      return false;
  }
}

export default {
  name: 'yts',
  aliases: ['ytsearch', 'ytmp3', 'ytmp4', 'ytm', 'ytmusic', 'ytplay'],
  preserveAlias: true,
  fullButton: false,
  category: 'general',
  description: 'Pencarian YouTube lima hasil per halaman, pilihan resolusi MP4, unduhan MP3, dan musik audio-only terisolasi.',
  usage: '.yts <query> | .ytmp3 <url> | .ytmp4 <url> [resolusi] | .ytm <judul lagu>',
  cooldown: 8,
  async execute({ sock, m, command, args }) {
    try {
      return await handleCommand(sock, m, String(command || '').toLowerCase(), Array.isArray(args) ? args : []);
    } catch (error) {
      const message = String(error?.message || error || 'Kesalahan tidak diketahui');
      return m.reply(`YouTube: ${message}\n\nBatas bot: ${youtubeLimits.maxDownloadMb} MB per file, maksimal ${Math.floor(youtubeLimits.maxDurationSeconds / 60)} menit. Untuk server, pasang yt-dlp dan FFmpeg/ffprobe.`);
    }
  }
};

export const youtubeSearchSessionTestHooks = Object.freeze({
  createSearchSession,
  getSearchSession,
  pruneSearchSessions,
  sendVideoCarousel,
  nativeListButton,
  nextPageButton,
  buildVideoCard,
  clear: () => searchSessions.clear()
});
