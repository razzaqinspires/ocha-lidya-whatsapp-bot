export default {
  name: 'owner', aliases: ['creator'], category: 'general', description: 'Informasi owner',
  async execute({ sock, m, config }) {
    const number = String(config.bot.owner).replace(/\D/g, '');
    const body = `Owner Razzaq Ventures\nNomor: ${number}\nKontak WhatsApp: https://wa.me/${number}`;
    if (config.ui?.buttonsEnabled && sock.sendInteractive) {
      return sock.sendInteractive(m.chat, {
        title: 'OCHA LIDYA · OWNER', body,
        buttons: [{ type: 'cta_copy', title: 'Salin nomor owner', id: 'copy_owner', copy_code: number }]
      }, m);
    }
    return m.reply(body);
  }
};
