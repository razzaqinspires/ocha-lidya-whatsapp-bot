export default {
  name: 'owner', aliases: ['creator'], category: 'general', description: 'Kontak owner bot',
  async execute({ m, config }) {
    const number = String(config.bot.owner || '').replace(/\D/g, '');
    const display = number ? `https://wa.me/${number}` : 'Kontak owner belum dikonfigurasi.';
    return m.reply(`*OWNER OCHA LIDYA*\nNomor: ${number || '-'}\nKontak: ${display}\n\nNomor dapat disalin langsung dari pesan ini.`);
  }
};
