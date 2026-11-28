import { getConfig } from '../../core/config.js';
import { isVerifiedOwnerMessage } from '../../core/identity.js';
import { getChatNivoExporterStatus, startChatNivoExport } from '../../integrations/chatnivo/exporter.js';
import {
  getChatNivoInferenceStatus,
  listChatNivoModels,
  updateChatNivoRuntimeConfig,
} from '../../integrations/chatnivo/inference.js';

const HELP = [
  '*CHATNIVO · OWNER INTEGRATION*',
  '.chatnivo status — status exporter dan AI fallback',
  '.chatnivo models — daftar model yang tersedia pada akun ChatNivo',
  '.chatnivo model <id> — pilih model fallback',
  '.chatnivo fallback <on|off> — aktifkan/nonaktifkan fallback',
  '.chatnivo export — ekspor riwayat chat akun owner ke penyimpanan lokal privat',
  '',
  'AI fallback menggunakan endpoint Open WebUI-style setelah seluruh provider Ocha gagal. Login dan model harus berhasil diverifikasi terlebih dahulu.',
].join('\n');

export default {
  name: 'chatnivo',
  aliases: [],
  category: 'owner',
  ownerOnly: true,
  privateOnly: true,
  description: 'Kelola ekspor privat ChatNivo dan fallback AI terakhir setelah provider utama Ocha gagal.',
  usage: '.chatnivo <status|models|model|fallback|export>',
  async execute({ m, args = [] }) {
    const config = getConfig();
    if (!isVerifiedOwnerMessage(m, config.bot.owner)) {
      return m.reply('Akses ChatNivo ditolak. Identitas owner belum terverifikasi.');
    }
    if (m.isGroup || String(m.chat || '').endsWith('@g.us')) {
      return m.reply('Command ChatNivo hanya dapat digunakan dari chat pribadi owner.');
    }

    const action = String(args[0] || 'help').toLowerCase();
    if (action === 'help' || action === 'menu') return m.reply(HELP);

    if (action === 'status') {
      try {
        const status = await getChatNivoExporterStatus();
        const inference = getChatNivoInferenceStatus();
        return m.reply(
          [
            '*CHATNIVO EXPORTER STATUS*',
            `Exporter source: ${status.exporterAvailable ? 'AVAILABLE' : 'MISSING'}`,
            `Account credentials: ${status.configured ? 'CONFIGURED' : `MISSING (${status.missingCredentials.join(', ')})`}`,
            `Service URL: ${status.baseUrl}`,
            `Export job: ${status.active ? 'RUNNING' : 'IDLE'}`,
            `AI fallback: ${inference.enabled ? 'ENABLED' : 'DISABLED'}`,
            `AI credentials: ${inference.credentialsConfigured ? 'CONFIGURED' : `MISSING (${inference.missingCredentials.join(', ')})`}`,
            `AI model: ${inference.modelId || 'AUTO ONLY IF EXACTLY ONE MODEL IS AVAILABLE'}`,
            `Model selection: ${inference.modelSelection}`,
            `Fallback readiness: ${inference.ready ? 'ELIGIBLE (remote health not yet probed)' : 'NOT READY'}`,
            'AI API: POST /api/chat/completions (Open WebUI-style); remote availability is verified on use.',
          ].join('\n'),
        );
      } catch (error) {
        return m.reply(`Status ChatNivo gagal dibaca: ${error.message}`);
      }
    }

    if (action === 'models') {
      try {
        const models = await listChatNivoModels();
        if (!models.length)
          return m.reply(
            'ChatNivo tidak mengembalikan model. Periksa izin API/model pada akun atau instalasi ChatNivo.',
          );
        return m.reply(
          [
            '*CHATNIVO MODELS*',
            ...models
              .slice(0, 40)
              .map((item, index) => `${index + 1}. ${item.id}${item.name !== item.id ? ` — ${item.name}` : ''}`),
            models.length > 40 ? `dan ${models.length - 40} model lainnya.` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        );
      } catch (error) {
        return m.reply(`Daftar model ChatNivo gagal diambil: ${error.message}`);
      }
    }

    if (action === 'model') {
      const modelId = String(args.slice(1).join(' ') || '').trim();
      if (!modelId) return m.reply('Format: .chatnivo model <model-id>. Lihat pilihan dengan .chatnivo models.');
      try {
        const models = await listChatNivoModels();
        const selected = models.find(item => item.id === modelId);
        if (!selected)
          return m.reply(
            'Model ID tidak ditemukan pada katalog akun ChatNivo. Periksa kembali melalui .chatnivo models.',
          );
        await updateChatNivoRuntimeConfig({ modelId: selected.id });
        return m.reply(
          `Model fallback ChatNivo disetel ke: ${selected.id}. Model ini hanya dipanggil setelah seluruh provider Ocha pada rantai utama gagal.`,
        );
      } catch (error) {
        return m.reply(`Model ChatNivo tidak dapat disetel: ${error.message}`);
      }
    }

    if (action === 'fallback') {
      const value = String(args[1] || '').toLowerCase();
      if (!['on', 'off'].includes(value)) return m.reply('Format: .chatnivo fallback <on|off>');
      try {
        await updateChatNivoRuntimeConfig({ fallbackEnabled: value === 'on' });
        return m.reply(`ChatNivo AI fallback ${value === 'on' ? 'diaktifkan' : 'dinonaktifkan'}.`);
      } catch (error) {
        return m.reply(`Konfigurasi ChatNivo gagal diperbarui: ${error.message}`);
      }
    }

    if (action === 'export') {
      let job;
      try {
        job = await startChatNivoExport();
      } catch (error) {
        return m.reply(`Ekspor ChatNivo tidak dimulai: ${error.message}`);
      }

      void job.done
        .then(async result => {
          await m.reply(
            [
              '*CHATNIVO EXPORT COMPLETED*',
              `Jumlah percakapan: ${result.chatCount ?? 'tidak dilaporkan oleh server'}`,
              'File tersimpan pada direktori privat `data/private/chatnivo-exports`.',
              'Isi chat tidak dikirim kembali ke WhatsApp.',
            ].join('\n'),
          );
        })
        .catch(async error => {
          await m.reply(
            `Ekspor ChatNivo gagal: ${error.message}\nPeriksa autentikasi pada situs resmi, MFA, dan ketersediaan layanan. Detail server tidak diteruskan ke chat.`,
          );
        });

      return m.reply(
        'Ekspor ChatNivo dimulai. Proses berjalan di background; hasil akan diberitahukan setelah selesai. Jangan kirim ulang command selama job ini aktif.',
      );
    }

    return m.reply(HELP);
  },
};
