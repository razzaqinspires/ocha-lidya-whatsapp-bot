import { updateConfig, getConfig } from '../../core/config.js';

const runners = {
  eval: { key: 'masterEvalEnabled', label: 'JavaScript eval', token: '> dan =>' },
  cli: { key: 'masterCliEnabled', label: 'CLI shell', token: '$' },
  python: { key: 'masterPythonEnabled', label: 'Python runner', token: '>>' },
  golang: { key: 'masterGolangEnabled', label: 'Go runner', token: '>>>' }
};

function statusText(security) {
  const lines = [
    '╭─ OCHA MASTER CONSOLE ─────────────────',
    '│ CONTROL PANEL · OWNER ONLY',
    '├─ RUNNER ACCESS'
  ];
  for (const [name, runner] of Object.entries(runners)) {
    const state = security[runner.key] ? '● ON' : '○ OFF';
    lines.push(`│ ${runner.label.padEnd(17)} ${state.padEnd(5)}  ${runner.token}`);
  }
  lines.push(
    '├─ COMMANDS',
    '│ .master status',
    '│ .master eval on/off',
    '│ .master cli on/off',
    '│ .master python on/off',
    '│ .master golang on/off',
    '├─ NOTES',
    '│ Each runner is independent. No global exec switch.',
    '│ Legacy .master exec on/off is an alias for CLI.',
    '╰──────────────────────────────────────'
  );
  return lines.join('\n');
}

export default {
  name: 'master', aliases: ['masterconfig'], category: 'owner', ownerOnly: true, privateOnly: true,
  description: 'Manage independent owner-only developer runners',
  async execute({ m, args }) {
    const [requestedFeature, value] = args;
    const feature = String(requestedFeature || 'status').toLowerCase();
    const canonicalFeature = feature === 'exec' ? 'cli' : feature;
    if (feature === 'status' || feature === 'help') return m.reply(statusText(getConfig().security));

    const runner = runners[canonicalFeature];
    if (!runner || !['on', 'off'].includes(String(value || '').toLowerCase())) {
      return m.reply([
        'Perintah tidak valid.',
        'Gunakan:',
        '.master status',
        '.master eval on/off',
        '.master cli on/off',
        '.master python on/off',
        '.master golang on/off',
        '',
        'Catatan: exec adalah alias lama untuk cli.'
      ].join('\n'));
    }

    const enabled = String(value).toLowerCase() === 'on';
    await updateConfig(config => {
      config.security[runner.key] = enabled;
      // The old global exec gate is intentionally removed in schema v11.
      delete config.security.masterExecEnabled;
    }, { actor: m.sender, reason: `master ${canonicalFeature} ${value}` });

    const note = feature === 'exec' ? '\nAlias lama: gunakan .master cli on/off.' : '';
    return m.reply(`${runner.label}: ${enabled ? 'ON' : 'OFF'}\nRunner ${runner.token} ${enabled ? 'siap digunakan' : 'dinonaktifkan'}.${note}`);
  }
};
