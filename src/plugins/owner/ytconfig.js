import { getConfig, updateConfig } from '../../core/config.js';

function currentText() {
  const { youtube } = getConfig();
  return [
    '*YOUTUBE · SERVER CONFIGURATION*',
    `yt-dlp executable: ${youtube.ytDlpBin}`,
    `FFmpeg location: ${youtube.ffmpegLocation || '(PATH sistem)'}`,
    `Maksimum file: ${youtube.maxDownloadMb} MB`,
    `Maksimum durasi: ${youtube.maxDurationSeconds} detik (${Math.floor(youtube.maxDurationSeconds / 60)} menit)`,
    `Hasil pencarian: ${youtube.searchResults}`,
    '',
    '*OWNER COMMANDS*',
    '.ytconfig binary <path|yt-dlp>',
    '.ytconfig ffmpeg <path|clear>',
    '.ytconfig maxsize <8-128>',
    '.ytconfig maxduration <30-7200>',
    '.ytconfig results <2-8>',
    '.ytconfig reset',
    '',
    'Semua nilai non-secret disimpan di konfigurasi aplikasi (JSONL), bukan .env.'
  ].join('\n');
}

export default {
  name: 'ytconfig', aliases: ['youtubeconfig'], category: 'owner', ownerOnly: true, privateOnly: true,
  usage: '[status|binary|ffmpeg|maxsize|maxduration|results|reset] [value]',
  description: 'Atur executable yt-dlp, FFmpeg, dan batas penggunaan YouTube',
  async execute({ m, args }) {
    const [action = 'status', rawValue = ''] = args;
    const value = String(rawValue).trim();
    if (['status', 'help'].includes(String(action).toLowerCase())) return m.reply(currentText());

    const setters = {
      binary: {
        valid: value.length > 0 && value.length <= 512,
        apply: config => { config.youtube.ytDlpBin = value; },
        usage: '.ytconfig binary <path executable atau yt-dlp>'
      },
      ffmpeg: {
        valid: value === 'clear' || value.length <= 512,
        apply: config => { config.youtube.ffmpegLocation = value === 'clear' ? '' : value; },
        usage: '.ytconfig ffmpeg <path direktori/binary atau clear>'
      },
      maxsize: {
        valid: /^\d+$/.test(value) && Number(value) >= 8 && Number(value) <= 128,
        apply: config => { config.youtube.maxDownloadMb = Number(value); },
        usage: '.ytconfig maxsize <8-128>'
      },
      maxduration: {
        valid: /^\d+$/.test(value) && Number(value) >= 30 && Number(value) <= 7200,
        apply: config => { config.youtube.maxDurationSeconds = Number(value); },
        usage: '.ytconfig maxduration <30-7200 detik>'
      },
      results: {
        valid: /^\d+$/.test(value) && Number(value) >= 2 && Number(value) <= 8,
        apply: config => { config.youtube.searchResults = Number(value); },
        usage: '.ytconfig results <2-8>'
      }
    };

    const key = String(action).toLowerCase();
    if (key === 'reset') {
      await updateConfig(config => {
        config.youtube = { ytDlpBin: 'yt-dlp', ffmpegLocation: '', maxDownloadMb: 48, maxDurationSeconds: 1800, searchResults: 5 };
      }, { actor: m.sender, reason: 'reset YouTube application settings to defaults' });
      return m.reply(`Pengaturan YouTube dikembalikan ke default.\n\n${currentText()}`);
    }

    const setting = setters[key];
    if (!setting) return m.reply(currentText());
    if (!setting.valid) return m.reply(`Nilai tidak valid. Format: ${setting.usage}`);
    await updateConfig(setting.apply, { actor: m.sender, reason: `update YouTube config ${key}` });
    return m.reply(`Pengaturan YouTube tersimpan.\n\n${currentText()}`);
  }
};
