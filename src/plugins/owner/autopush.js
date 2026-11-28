import { getAutoPushRuntime } from '../../core/auto-push-runtime.js';
import { normalizeAutoPushTarget } from '../../core/auto-push-config.js';

const TARGET_LABELS = Object.freeze({ ocha: 'Ocha Lidya Bot', ac: 'Artificial Consciousness Component' });

function formatStatus(statuses) {
  const lines = ['AUTO-PUSH · DUA REPOSITORY'];
  for (const name of ['ocha', 'ac']) {
    const status = statuses[name] || {};
    lines.push(
      '',
      `${name === 'ocha' ? '①' : '②'} ${TARGET_LABELS[name]}`,
      `Status       : ${status.enabled ? 'ON' : 'OFF'}`,
      `Git          : ${status.ready ? 'READY' : 'NOT READY'}`,
      `Repository   : ${status.repository || '-'}`,
      `Branch       : ${status.branch || '-'}`,
      `Token        : ${status.tokenAvailable ? 'TERSEDIA' : 'BELUM ADA'}`,
      `Perubahan    : ${status.pendingChanges ?? '-'}`,
      status.reason ? `Catatan      : ${status.reason}` : '',
    );
  }
  lines.push('', 'Command: .autopush on|off <ocha|ac|all> · .autopush push <ocha|ac|all>');
  return lines.filter(Boolean).join('\n');
}

export default {
  name: 'autopush',
  aliases: ['gitpush', 'autogit'],
  category: 'owner',
  menuCategory: 'owner',
  menu: false,
  description: 'Kontrol privat auto-push Ocha dan AC ke dua repository GitHub yang terpisah',
  usage: '.autopush <status|on|off|push|setup>',
  ownerOnly: true,
  privateOnly: true,
  async execute({ m, args = [] }) {
    const runtime = getAutoPushRuntime();
    if (!runtime) return m.reply('Auto-push runtime belum siap. Restart Ocha setelah proses bootstrap selesai.');

    const action = String(args[0] || 'status')
      .trim()
      .toLowerCase();
    const target = normalizeAutoPushTarget(args[1] || 'all');
    if (!target) return m.reply('Target tidak dikenal. Gunakan ocha, ac, atau all.');

    if (['status', 'info', 'config', 'konfigurasi'].includes(action)) {
      const statuses = await runtime.getStatus('all');
      return m.reply(formatStatus(statuses));
    }

    if (['on', 'enable', 'aktif'].includes(action)) {
      const result = await runtime.setEnabled(target, true);
      return m.reply(
        `Auto-push ${target.toUpperCase()} diaktifkan.\n${formatStatus(result)}\n\nJika repository belum READY, siapkan clone/token melalui petunjuk .autopush setup ac lalu restart Ocha.`,
      );
    }

    if (['off', 'disable', 'nonaktif'].includes(action)) {
      const result = await runtime.setEnabled(target, false);
      return m.reply(
        `Auto-push ${target.toUpperCase()} dinonaktifkan. Perubahan source tetap lokal dan tidak dihapus.\n${formatStatus(result)}`,
      );
    }

    if (['push', 'sync', 'publish'].includes(action)) {
      const result = await runtime.pushNow(target);
      const lines = [`MANUAL PUSH · ${target.toUpperCase()}`];
      for (const [name, status] of Object.entries(result)) {
        lines.push(
          `${TARGET_LABELS[name]}: ${status.ok ? `PUSHED · ${status.commit || 'HEAD'} · ${status.files ?? 0} file` : `BELUM PUSH · ${status.reason || 'unknown'}`}`,
        );
      }
      return m.reply(lines.join('\n'));
    }

    if (['setup', 'siapkan'].includes(action)) {
      return m.reply(
        [
          'AUTO-PUSH SETUP · DUA REPOSITORY',
          '',
          'Ocha:',
          '• npm run git:setup (command lama tetap dipertahankan)',
          '• GITHUB_PAT di .env dengan izin Contents read/write hanya untuk repository Ocha',
          '',
          'Artificial Consciousness:',
          '• AC_GITHUB_PAT di .env dengan izin Contents read/write untuk artificial-consciousness-component',
          '• npm run ac:git:setup',
          '• npm start',
          '',
          'AC tidak diinisialisasi dengan git init kosong. Setup akan clone remote terlebih dahulu, mencadangkan snapshot lokal, lalu menerapkan snapshot ke working tree hasil clone. Jika clone gagal, snapshot tidak diubah.',
        ].join('\n'),
      );
    }

    return m.reply(
      [
        'AUTO-PUSH CONTROL · OWNER PRIVATE',
        '.autopush status',
        '.autopush on ocha|ac|all',
        '.autopush off ocha|ac|all',
        '.autopush push ocha|ac|all',
        '.autopush setup',
        '',
        'Alias kompatibilitas: .gitpush dan .autogit. Command disembunyikan dari menu umum.',
      ].join('\n'),
    );
  },
};
