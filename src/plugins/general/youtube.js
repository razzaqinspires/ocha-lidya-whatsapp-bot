import {
  searchYouTube,
  getYouTubeVideoInfo,
  downloadYouTubeMp3,
  downloadYouTubeMp4,
  buildYouTubeDownloadRows,
  formatDuration,
  formatViewCount,
  youtubeLimits
} from '../../lib/youtube-service.js';

const FOOTER = 'Ocha Lidya AI · Razzaq Ventures';
const LIST_LIMIT = 30;

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
  const rows = buildYouTubeDownloadRows(video).slice(0, LIST_LIMIT);
  const sections = [{ title: 'Pilih format unduhan', rows }];
  return {
    name: 'single_select',
    buttonParamsJson: JSON.stringify({
      title: 'MP3 / MP4 · Pilih kualitas',
      sections
    })
  };
}

async function sendVideoCarousel(sock, m, videos, query) {
  if (videos.length === 1) {
    const video = videos[0];
    if (typeof sock.sendInteractive === 'function') {
      return sock.sendInteractive(m.chat, {
        title: cleanCaption(video.title, 70),
        subtitle: cleanCaption(video.channel, 70),
        body: `${videoSummary(video)}\n\nPilih MP3 atau salah satu resolusi MP4 yang tersedia.`,
        footer: FOOTER,
        ...(video.thumbnail ? { image: video.thumbnail } : {}),
        buttons: [nativeListButton(video)]
      }, m);
    }
    return m.reply(`${video.title}\n${videoSummary(video)}\n\n${buildYouTubeDownloadRows(video).map(row => `${row.title}: ${row.id}`).join('\n')}`);
  }

  if (typeof sock.carouselBuilder !== 'function') {
    return m.reply(videos.map((video, index) => `${index + 1}. ${video.title}\n${videoSummary(video)}\n${buildYouTubeDownloadRows(video).map(row => `${row.title}: ${row.id}`).join('\n')}`).join('\n\n'));
  }

  const cards = videos.map((video, index) => ({
    header: {
      title: cleanCaption(video.title, 60) || `Video ${index + 1}`,
      subtitle: cleanCaption(video.channel, 50),
      ...(video.thumbnail ? { imageUrl: video.thumbnail } : {})
    },
    body: {
      text: `${videoSummary(video)}\n\nPilih MP3 atau resolusi MP4 dari tombol di bawah.`
    },
    footer: { text: `Hasil ${index + 1}/${videos.length}` },
    nativeFlowMessage: {
      buttons: [nativeListButton(video)],
      messageParamsJson: '{}',
      messageVersion: 1
    }
  }));

  try {
    return await sock.carouselBuilder()
      .setTitle('HASIL PENCARIAN YOUTUBE')
      .setSubtitle(cleanCaption(query, 80))
      .setBody('Geser kartu untuk memilih video. Buka daftar untuk melihat MP3 dan seluruh resolusi MP4 yang tersedia.')
      .setFooter(FOOTER)
      .addCard(cards)
      .send(m.chat, { quoted: m });
  } catch (error) {
    const compact = videos.map((video, index) => `${index + 1}. ${video.title}\n${video.url}\n${buildYouTubeDownloadRows(video).map(row => `${row.title}: ${row.id}`).join('\n')}`).join('\n\n');
    await m.reply(`Carousel tidak dapat dikirim (${cleanCaption(error.message, 150)}). Berikut tautan hasil pencarian:\n\n${compact}`);
    return null;
  }
}

async function sendResolutionMenu(sock, m, video) {
  const button = nativeListButton(video);
  if (typeof sock.sendInteractive === 'function') {
    return sock.sendInteractive(m.chat, {
      title: cleanCaption(video.title, 70),
      subtitle: cleanCaption(video.channel, 70),
      body: `${videoSummary(video)}\n\nPilih resolusi yang tersedia. Daftar MP4 berasal dari metadata format video; opsi MP3 tersedia terpisah.`,
      footer: FOOTER,
      buttons: [button]
    }, m);
  }
  return m.reply(`Format tersedia untuk ${video.title}:\n${buildYouTubeDownloadRows(video).map(row => `${row.title}: ${row.id}`).join('\n')}`);
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

async function handleCommand(sock, m, command, args) {
  const first = String(args[0] || '').trim();
  switch (command) {
    case 'yts':
    case 'ytsearch': {
      const query = args.join(' ').trim();
      if (query.length < 2) return m.reply('Gunakan *.yts <kata kunci>* untuk mencari video YouTube.');
      const videos = await searchYouTube(query);
      if (!videos.length) return m.reply('Tidak ada hasil video yang dapat dibaca. Coba kata kunci lain.');
      return sendVideoCarousel(sock, m, videos, query);
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
        return sendResolutionMenu(sock, m, video);
      }
      const result = await downloadYouTubeMp4(first, resolution);
      await sock.sendMessage(m.chat, {
        video: result.buffer,
        mimetype: 'video/mp4',
        fileName: result.fileName,
        caption: `${result.title}\n${result.height ? `Resolusi: ${result.height}p\n` : ''}Sumber: ${result.url}`
      }, { quoted: m });
      return null;
    }

    case 'ytm':
    case 'ytmusic':
    case 'ytplay': {
      const query = args.join(' ').trim();
      if (query.length < 2) return m.reply('Gunakan *.ytm <judul lagu / artis>* untuk mencari dan mengirim audio saja.');
      const [video] = await searchYouTube(`${query} official audio`, 1);
      if (!video) return m.reply('Lagu tidak ditemukan. Coba judul dan nama artis yang lebih spesifik.');
      // Audio jobs use a per-request temporary directory, no shared media cache,
      // and send only audio; this path never invokes the MP4/video downloader.
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
  fullButton: false,
  category: 'general',
  description: 'Pencarian YouTube, pilihan resolusi MP4, unduhan MP3, dan musik audio-only terisolasi.',
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
