import { getConfig, updateConfig } from '../../core/config.js';

const REACTION_MENU_ROWS = [
  { title: 'Aktifkan Auto Reaction', description: '⏳ / 💭 saat proses, ✅ saat selesai', id: '.react on' },
  { title: 'Nonaktifkan Auto Reaction', description: 'Hentikan reaction otomatis', id: '.react off' },
  { title: 'Lihat Status', description: 'Periksa pengaturan saat ini', id: '.react status' }
];

async function sendReactionMenu(sock, m, config) {
  try {
    if (typeof sock.sendInteractive === 'function') {
      return await sock.sendInteractive(m.chat, {
        title: 'OCHA · AUTO REACTION',
        subtitle: 'OWNER CONTROL',
        body: statusText(config),
        footer: 'Pengaturan global untuk command dan AI',
        buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({
          title: 'Kelola Auto Reaction',
          sections: [{ title: 'PILIH AKSI', rows: REACTION_MENU_ROWS }]
        }) }]
      }, m);
    }
  } catch {}
  return m.reply(`${statusText(config)}\n\nPilih: .react on | .react off | .react status`);
}

function statusText(config) {
  const policy = config.ui?.autoReactions || {};
  return [
    '*OCHA · AUTO REACTION MANAGER*',
    `Status: *${policy.enabled ? 'ACTIVE' : 'OFF'}*`,
    `Command: ${policy.commandEmoji || '⏳'} → ${policy.successEmoji || '✅'}`,
    `AI thinking: ${policy.thinkingEmoji || '💭'} → ${policy.successEmoji || '✅'}`,
    `Gagal: ${policy.failureEmoji || '❌'}`,
    '',
    'Jika aktif, semua command plugin yang lolos ke dispatcher akan diberi reaction proses. Percakapan AI memakai 💭 selama berpikir lalu ✅ setelah jawaban selesai.',
    'Reaksi hanya indikator proses. Jika WhatsApp client tidak mendukung reaction, perintah tetap berjalan normal.'
  ].join('\n');
}

export default {
  name: 'react',
  aliases: ['autoreact', 'reactions'],
  category: 'owner',
  ownerOnly: true,
  privateOnly: true,
  fullButton: false,
  usage: '[menu|on|off|status]',
  description: 'Kelola reaction otomatis untuk seluruh command plugin dan percakapan AI',
  async execute({ sock, m, args }) {
    const action = String(args[0] || 'menu').toLowerCase();
    if (['menu', 'help', ''].includes(action)) return sendReactionMenu(sock, m, getConfig());
    if (['status', 'check', 'info'].includes(action)) return m.reply(statusText(getConfig()));

    if (['on', 'enable', 'aktif', 'nyala'].includes(action)) {
      await updateConfig(config => {
        config.ui.autoReactions = {
          enabled: true,
          commandEmoji: '⏳',
          thinkingEmoji: '💭',
          successEmoji: '✅',
          failureEmoji: '❌'
        };
      }, { actor: m.sender, reason: 'owner enabled automatic command and AI reactions' });
      return m.reply('Auto Reaction aktif. Command menggunakan ⏳ lalu ✅; balasan AI menggunakan 💭 lalu ✅.');
    }

    if (['off', 'disable', 'mati', 'nonaktif'].includes(action)) {
      await updateConfig(config => { config.ui.autoReactions.enabled = false; }, { actor: m.sender, reason: 'owner disabled automatic command and AI reactions' });
      return m.reply('Auto Reaction dinonaktifkan.');
    }

    return m.reply('Gunakan `.react on`, `.react off`, atau `.react status`. Pengaturan ini hanya dapat diubah owner melalui chat pribadi.');
  }
};
