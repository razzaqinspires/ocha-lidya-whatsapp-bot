import { getConfig, updateConfig } from '../../core/config.js';

export default {
  name: 'mute', aliases: ['groupmute'], category: 'owner', ownerOnly: true, privateOnly: true,
  description: 'Mute/unmute seluruh interaksi grup tanpa menghentikan sinkronisasi metadata dan kontak',
  async execute({ m, args }) {
    const value = String(args[0] || 'status').toLowerCase();
    if (!['on', 'off', 'status'].includes(value)) {
      return m.reply('Gunakan: .mute on | .mute off | .mute status\nON = bot diam di semua grup. OFF = bot menerima command dan percakapan grup.');
    }
    if (value === 'status') {
      const muted = Boolean(getConfig().features.groupsMuted);
      return m.reply(`GROUP INTERACTION MUTE\nStatus: ${muted ? 'ON · SILENT DI SEMUA GRUP' : 'OFF · INTERAKSI GRUP AKTIF'}\nSinkronisasi metadata grup: tetap aktif\nPencatatan kontak terverifikasi: tetap aktif`);
    }
    const muted = value === 'on';
    await updateConfig(config => {
      config.features.groupsMuted = muted;
    }, { actor: m.sender, reason: `global group mute ${value}` });
    return m.reply([
      `GROUP MUTE: ${muted ? 'ON' : 'OFF'}`,
      muted ? 'Ocha akan diam di seluruh grup. Pesan, command, dan AI grup tidak diproses untuk dibalas.' : 'Interaksi grup diaktifkan kembali.',
      'Metadata grup dan database kontak tetap berjalan dalam kedua mode.'
    ].join('\n'));
  }
};
