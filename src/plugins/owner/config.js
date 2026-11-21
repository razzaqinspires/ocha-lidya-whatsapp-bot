import { getConfig } from '../../core/config.js';
import { isVerifiedOwnerMessage } from '../../core/identity.js';
import { formatOwnerConfiguration } from '../../core/config-disclosure.js';

export default {
  name: 'config',
  aliases: ['configuration', 'settings'],
  category: 'owner',
  ownerOnly: true,
  usage: '[show]',
  privateOnly: true,
  description: 'Tampilkan snapshot konfigurasi owner dengan redaksi otomatis untuk seluruh credential.',
  async execute({ m }) {
    if (!isVerifiedOwnerMessage(m, getConfig().bot.owner)) {
      return m.reply('Akses konfigurasi ditolak. Identitas owner harus diverifikasi dari metadata nomor WhatsApp yang terdaftar.');
    }
    if (m.isGroup || String(m.chat || '').endsWith('@g.us')) {
      return m.reply('Snapshot konfigurasi hanya dapat dikirim melalui chat pribadi owner.');
    }
    return m.reply(formatOwnerConfiguration());
  }
};
