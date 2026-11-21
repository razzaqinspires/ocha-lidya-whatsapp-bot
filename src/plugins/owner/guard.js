import { getConfig, updateConfig } from '../../core/config.js';
import { getCommandSanction, formatDuration } from '../../core/command-governor.js';

export default {
  name: 'guard', aliases: ['commandguard', 'antispam'], category: 'owner', ownerOnly: true, privateOnly: true,
  usage: '<cooldown|antispam|status> [on|off|user]',
  description: 'Kontrol global adaptive command cooldown dan anti-spam',
  async execute({ m, args }) {
    const [key = 'status', value] = args;
    const config = getConfig();
    if (key === 'status' || key === 'show') {
      const guard = config.commandGuard;
      return m.reply(`COMMAND GOVERNOR\nCooldown adaptif: ${guard.cooldown.enabled ? 'ON' : 'OFF'}\nAnti-spam: ${guard.antiSpam.enabled ? 'ON' : 'OFF'}\nPeringatan harian: ${guard.antiSpam.dailyWarnings}\nAmbang sementara: ${guard.antiSpam.dailyWarnings} pelanggaran\nZona reset: Asia/Jakarta`);
    }
    if (!['on', 'off'].includes(String(value || '').toLowerCase())) return m.reply('Gunakan .guard cooldown on|off atau .guard antispam on|off');
    const enabled = value.toLowerCase() === 'on';
    if (key === 'cooldown') await updateConfig(c => { c.commandGuard.cooldown.enabled = enabled; }, { actor: m.sender, reason: `adaptive command cooldown ${enabled ? 'on' : 'off'}` });
    else if (['antispam', 'spam'].includes(key)) await updateConfig(c => { c.commandGuard.antiSpam.enabled = enabled; }, { actor: m.sender, reason: `anti spam ${enabled ? 'on' : 'off'}` });
    else return m.reply('Gunakan: .guard cooldown on|off | .guard antispam on|off | .guard status');
    return m.reply(`${key === 'cooldown' ? 'Adaptive cooldown' : 'Anti-spam'} global: *${enabled ? 'ON' : 'OFF'}*.`);
  }
};
