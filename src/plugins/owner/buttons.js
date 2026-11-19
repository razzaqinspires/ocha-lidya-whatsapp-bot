import { updateConfig, getConfig } from '../../core/config.js';
export default {
  name: 'buttons', aliases: ['buttonmode', 'uibuttons'], category: 'owner', ownerOnly: true,
  description: 'Aktifkan atau nonaktifkan tombol interaktif pada seluruh balasan bot',
  async execute({ m, args }) {
    const value = String(args[0] || '').toLowerCase();
    if (!['on', 'off', 'status'].includes(value)) {
      return m.reply('Gunakan: .buttons on | .buttons off | .buttons status');
    }
    if (value === 'status') return m.reply(`Interactive buttons: ${getConfig().ui.buttonsEnabled ? 'ON' : 'OFF'}`);
    await updateConfig(config => { config.ui.buttonsEnabled = value === 'on'; }, { actor: m.sender, reason: `interactive buttons ${value}` });
    return m.reply(`Tombol interaktif ${value === 'on' ? 'diaktifkan' : 'dinonaktifkan'}.`);
  }
};
