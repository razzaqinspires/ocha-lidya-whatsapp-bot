import { updateConfig, getConfig } from '../../core/config.js';
export default {
  name: 'buttons', aliases: ['buttonmode', 'uibuttons'], category: 'owner', ownerOnly: true,
  description: 'Atur kebijakan transport pesan interaktif (mode aman: teks biasa)',
  async execute({ m, args }) {
    const value = String(args[0] || '').toLowerCase();
    if (!['on', 'off', 'status'].includes(value)) {
      return m.reply('Gunakan: .buttons on | .buttons off | .buttons status');
    }
    if (value === 'status') return m.reply(`Mode tombol: ${getConfig().ui.buttonsEnabled ? 'ON (kompatibilitas tersimpan; command tetap dikirim sebagai teks aman)' : 'OFF'}\nTransport command: TEXT-FIRST`);
    await updateConfig(config => { config.ui.buttonsEnabled = value === 'on'; }, { actor: m.sender, reason: `interactive preference ${value}` });
    return m.reply(value === 'on'
      ? 'Preferensi interaktif disimpan. Transport command tetap menggunakan teks biasa agar semua pesan dapat dibaca dan disalin.'
      : 'Mode interaktif dinonaktifkan. Semua command dikirim sebagai teks biasa.');
  }
};
