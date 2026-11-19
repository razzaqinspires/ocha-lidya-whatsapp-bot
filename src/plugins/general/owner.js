export default {
  name: 'owner', aliases: ['creator'], category: 'general', description: 'Kirim kartu kontak owner bot',
  async execute({ m, config }) {
    const number = String(config.bot.owner || '').replace(/\D/g, '');
    if (!number) return m.reply('Nomor owner belum dikonfigurasi.');
    return m.sendContact({
      number,
      displayName: 'Owner Ocha Lidya',
      organization: 'Razzaq Ventures'
    });
  }
};
