import { updateConfig, getConfig } from '../../core/config.js';

const runners = {
  eval: { key: 'masterEvalEnabled', label: 'JavaScript eval', token: '> dan =>' },
  cli: { key: 'masterCliEnabled', label: 'CLI shell', token: '$' },
  python: { key: 'masterPythonEnabled', label: 'Python runner', token: '>>' },
  golang: { key: 'masterGolangEnabled', label: 'Go runner', token: '>>>' },
};

function statusText(security) {
  const warningMode = security.masterWorkloadWarningMode || 'compact';
  const reviewEnabled = security.masterWorkloadReviewEnabled !== false;
  const lines = ['╭─ OCHA MASTER CONSOLE ─────────────────', '│ CONTROL PANEL · OWNER ONLY', '├─ RUNNER ACCESS'];
  for (const [name, runner] of Object.entries(runners)) {
    const state = security[runner.key] ? '● ON' : '○ OFF';
    lines.push(`│ ${runner.label.padEnd(17)} ${state.padEnd(5)}  ${runner.token}`);
  }
  lines.push(
    '├─ WORKLOAD GUARD',
    `│ Warning          : ${warningMode.toUpperCase()}`,
    `│ AI semantic review: ${reviewEnabled ? 'ON' : 'OFF · local heuristic only'}`,
    '│ Hard-block        : ALWAYS ON',
    `│ Risk confirmation : ${warningMode === 'off' ? 'OFF · non-hard-blocked work continues' : 'ON for flagged work'}`,
    `│ Master in groups  : ${security.allowMasterInGroups ? 'ON' : 'OFF'}`,
    `│ Eval template     : ${security.masterEvalTemplateEnabled === false ? 'HIDDEN' : 'VISIBLE'}`,
    '├─ COMMANDS',
    '│ .master status',
    '│ .master eval on/off',
    '│ .master template on/off/status',
    '│ .master cli on/off',
    '│ .master python on/off',
    '│ .master golang on/off',
    '│ .master warning on/off/true/false/compact/detailed/status',
    '│ .master review on/off/true/false/status',
    '│ .master group on/off/status',
    '├─ NOTES',
    '│ warning off = skip prompts for non-hard-blocked work; audit silently.',
    '│ Hard-block rules remain active in every warning mode.',
    '│ review off = disable AI assessment; local heuristic remains active.',
    '│ eval off = disable the JavaScript runner itself.',
    '│ template off = hide only the JavaScript console frame; output remains unchanged.',
    '│ Eval output over 30,000 characters is sent as a TXT document.',
    '│ Legacy .master exec on/off is an alias for CLI.',
    '╰──────────────────────────────────────',
  );
  return lines.join('\n');
}

export default {
  name: 'master',
  aliases: ['masterconfig'],
  category: 'owner',
  ownerOnly: true,
  privateOnly: false,
  usage: '[status|eval|template|cli|python|golang|warning|review|group] [on|off|true|false|compact|detailed|status]',
  description: 'Manage owner-only developer runners and workload review policy',
  async execute({ m, args }) {
    const [requestedFeature, requestedValue] = args;
    const feature = String(requestedFeature || 'status').toLowerCase();
    const rawValue = String(requestedValue || '').toLowerCase();
    const value = rawValue === 'true' ? 'on' : rawValue === 'false' ? 'off' : rawValue;
    const canonicalFeature =
      feature === 'exec'
        ? 'cli'
        : feature === 'reminder'
          ? 'warning'
          : ['assessor', 'assessment'].includes(feature)
            ? 'review'
            : feature;
    const security = getConfig().security;
    if (feature === 'status' || feature === 'help') return m.reply(statusText(security));

    if (canonicalFeature === 'template' || canonicalFeature === 'frame' || canonicalFeature === 'console') {
      if (!['status', 'on', 'off'].includes(value)) {
        return m.reply(
          'Gunakan .master template status|on|off. Pengaturan ini hanya menampilkan atau menyembunyikan bingkai OCHA MASTER CONSOLE pada hasil JavaScript eval.',
        );
      }
      if (value === 'status') {
        return m.reply(
          `JavaScript eval template: ${security.masterEvalTemplateEnabled === false ? 'HIDDEN' : 'VISIBLE'}\nGunakan .master template on/off.`,
        );
      }
      const enabled = value === 'on';
      await updateConfig(
        config => {
          config.security.masterEvalTemplateEnabled = enabled;
        },
        { actor: m.sender, reason: `master eval template ${value}` },
      );
      return m.reply(
        `Bingkai OCHA MASTER CONSOLE: ${enabled ? 'DITAMPILKAN' : 'DISEMBUNYIKAN'}. Isi hasil eval tidak diubah.`,
      );
    }

    if (canonicalFeature === 'warning') {
      if (!['status', 'on', 'off', 'compact', 'detailed'].includes(value)) {
        return m.reply(
          'Gunakan .master warning status|on|off|compact|detailed. Mode off melewati prompt untuk workload non-hard-blocked; hard-block tetap aktif.',
        );
      }
      if (value === 'status')
        return m.reply(
          `Workload warning: ${(security.masterWorkloadWarningMode || 'compact').toUpperCase()}\nPilihan: on/true, off/false, compact, detailed.`,
        );
      const mode = value === 'on' ? 'compact' : value;
      await updateConfig(
        config => {
          config.security.masterWorkloadWarningMode = mode;
        },
        { actor: m.sender, reason: `master workload warning ${mode}` },
      );
      const description =
        mode === 'off'
          ? 'Prompt peringatan dimatikan. Workload non-hard-blocked tetap dijalankan tanpa konfirmasi; seluruh hard-block tetap berlaku dan aktivitas dicatat di audit log.'
          : `Peringatan workload aktif dalam mode ${mode}. CTA Copy dan tombol tindakan tersedia untuk konfirmasi owner.`;
      return m.reply(description);
    }

    if (canonicalFeature === 'group') {
      if (!['status', 'on', 'off'].includes(value))
        return m.reply(
          'Gunakan .master group status|on|off. Pengaturan ini mengizinkan runner Master dan .master console digunakan oleh owner terverifikasi di grup.',
        );
      if (value === 'status')
        return m.reply(
          `Master console di grup: ${security.allowMasterInGroups ? 'ON' : 'OFF'}\nDefault aman: OFF. Aktifkan dari DM owner dengan .master group on.`,
        );
      const enabled = value === 'on';
      await updateConfig(
        config => {
          config.security.allowMasterInGroups = enabled;
        },
        { actor: m.sender, reason: `master group access ${value}` },
      );
      return m.reply(
        `Master console di grup: ${enabled ? 'ON' : 'OFF'}. ${enabled ? 'Hanya owner terverifikasi yang dapat memakai runner Master di grup.' : 'Perintah Master kembali dibatasi ke DM owner.'}`,
      );
    }

    if (canonicalFeature === 'review') {
      if (!['status', 'on', 'off'].includes(value))
        return m.reply(
          'Gunakan .master review status|on|off|true|false. Mode off mematikan AI semantic review, bukan pemeriksaan lokal.',
        );
      if (value === 'status')
        return m.reply(
          `AI semantic review: ${security.masterWorkloadReviewEnabled === false ? 'OFF' : 'ON'}\nLocal heuristic dan hard-block: ALWAYS ON.`,
        );
      const enabled = value === 'on';
      await updateConfig(
        config => {
          config.security.masterWorkloadReviewEnabled = enabled;
        },
        { actor: m.sender, reason: `master workload AI review ${value}` },
      );
      return m.reply(
        `AI semantic review: ${enabled ? 'ON' : 'OFF'}. ${enabled ? 'Pemeriksaan AI dan lokal aktif.' : 'AI tidak dipanggil; pemeriksaan lokal tetap aktif. Konfirmasi mengikuti pengaturan .master warning.'}`,
      );
    }

    const runner = runners[canonicalFeature];
    if (!runner || !['on', 'off'].includes(value)) {
      return m.reply(
        [
          'Perintah tidak valid.',
          'Gunakan:',
          '.master status',
          '.master eval on/off',
          '.master template on/off/status',
          '.master cli on/off',
          '.master python on/off',
          '.master golang on/off',
          '.master warning on/off/true/false/compact/detailed/status',
          '.master review on/off/true/false/status',
          '.master group on/off/status',
          '',
          'Catatan: eval off mematikan runner JavaScript. warning off melewati prompt untuk risiko non-hard-blocked; hard-block tetap aktif. exec adalah alias lama untuk cli.',
        ].join('\n'),
      );
    }

    const enabled = value === 'on';
    await updateConfig(
      config => {
        config.security[runner.key] = enabled;
        delete config.security.masterExecEnabled;
      },
      { actor: m.sender, reason: `master ${canonicalFeature} ${value}` },
    );

    const note = feature === 'exec' ? '\nAlias lama: gunakan .master cli on/off.' : '';
    return m.reply(
      `${runner.label}: ${enabled ? 'ON' : 'OFF'}\nRunner ${runner.token} ${enabled ? 'siap digunakan' : 'dinonaktifkan'}.${note}`,
    );
  },
};
