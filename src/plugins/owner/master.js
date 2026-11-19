import { updateConfig, getConfig } from '../../core/config.js';
const keys = {
  exec: 'masterExecEnabled', eval: 'masterEvalEnabled', cli: 'masterCliEnabled',
  python: 'masterPythonEnabled', golang: 'masterGolangEnabled'
};
export default {
  name: 'master', aliases: ['masterconfig'], category: 'owner', ownerOnly: true,
  description: 'Enable/disable owner-only developer runners',
  async execute({ m, args }) {
    const [feature, value] = args;
    if (!feature || feature === 'status') {
      const security = getConfig().security;
      const lines = Object.entries(keys).map(([name, key]) => `${name}: ${security[key] ? 'ON' : 'OFF'}`);
      lines.push('', 'JavaScript eval: .master eval on', 'CLI shell ($): .master exec on lalu .master cli on', 'Python (>>): .master exec on lalu .master python on', 'Go (>>>): .master exec on lalu .master golang on');
      return m.reply(lines.join('\n'));
    }
    const key = keys[String(feature).toLowerCase()];
    if (!key || !['on', 'off'].includes(String(value).toLowerCase())) {
      return m.reply('Gunakan: .master status | .master eval on/off | .master exec on/off | .master cli on/off | .master python on/off | .master golang on/off');
    }
    const enabled = value.toLowerCase() === 'on';
    await updateConfig(config => { config.security[key] = enabled; }, { actor: m.sender, reason: `master ${feature} ${value}` });
    return m.reply(`Master ${feature}: ${enabled ? 'ON' : 'OFF'}`);
  }
};
