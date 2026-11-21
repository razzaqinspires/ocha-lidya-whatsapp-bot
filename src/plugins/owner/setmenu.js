import { getConfig, updateConfig } from '../../core/config.js';

export default {
  name: 'setmenu', aliases: ['menuset', 'menuconfig'], category: 'owner', ownerOnly: true, privateOnly: true,
  usage: '<descriptions|pages|limit|status> [on|off|number]',
  description: 'Atur tampilan menu secara global untuk seluruh pengguna',
  async execute({ m, args }) {
    const [rawKey = 'status', rawValue] = args;
    const key = rawKey.toLowerCase();
    const config = getConfig();
    const menu = config.menu || { showDescriptions: false, pagination: { enabled: false, pageSize: 50 } };
    if (['status', 'show'].includes(key)) return m.reply(`GLOBAL MENU SETTINGS\nDeskripsi: ${menu.showDescriptions ? 'ON' : 'OFF'}\nHalaman: ${menu.pagination.enabled ? 'ON' : 'OFF'}\nBatas per halaman: ${menu.pagination.pageSize}\nPengaturan ini berlaku untuk semua pengguna.`);
    if (key === 'descriptions') {
      if (!['on', 'off'].includes(String(rawValue || '').toLowerCase())) return m.reply('Gunakan: .setmenu descriptions on|off');
      const enabled = rawValue.toLowerCase() === 'on';
      await updateConfig(c => { c.menu.showDescriptions = enabled; }, { actor: m.sender, reason: `global menu descriptions ${enabled ? 'on' : 'off'}` });
      return m.reply(`Deskripsi menu global: *${enabled ? 'ON' : 'OFF'}*.`);
    }
    if (key === 'pages') {
      if (!['on', 'off'].includes(String(rawValue || '').toLowerCase())) return m.reply('Gunakan: .setmenu pages on|off');
      const enabled = rawValue.toLowerCase() === 'on';
      await updateConfig(c => { c.menu.pagination.enabled = enabled; }, { actor: m.sender, reason: `global menu pagination ${enabled ? 'on' : 'off'}` });
      return m.reply(`Pagination menu global: *${enabled ? 'ON' : 'OFF'}*.`);
    }
    if (key === 'limit') {
      const limit = Number(rawValue);
      if (!Number.isInteger(limit) || limit < 10 || limit > 200) return m.reply('Batas halaman harus bilangan bulat 10–200. Contoh: .setmenu limit 50');
      await updateConfig(c => { c.menu.pagination.pageSize = limit; }, { actor: m.sender, reason: `global menu page size ${limit}` });
      return m.reply(`Batas command per halaman: *${limit}*.`);
    }
    return m.reply('SET MENU GLOBAL\n.setmenu descriptions on|off\n.setmenu pages on|off\n.setmenu limit <10-200>\n.setmenu status');
  }
};
