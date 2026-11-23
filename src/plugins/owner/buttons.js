import { updateConfig, getConfig } from '../../core/config.js';
import { listPlugins, getPlugin } from '../../core/plugin-loader.js';
import { getPrefixes } from '../../core/prefix.js';
import { planButtonInventory, getHardButtonExemptions } from '../../core/adaptive-buttons.js';

const hardExemptions = getHardButtonExemptions();

function buttonStatus(config, plugins) {
  const full = config.ui?.fullButton || {};
  const inventory = planButtonInventory(plugins, config, getPrefixes()[0] || '');
  const exceptions = inventory.filter(item => item.mode === 'exempt');
  const candidates = inventory.filter(item => item.mode !== 'exempt');
  const list = exceptions.map(item => `• ${item.name}: ${hardExemptions[item.name] || item.reason}`).join('\n') || '• Tidak ada';
  return [
    '*COMMAND BUTTON ENGINE*',
    `Status: ${full.enabled ? 'ACTIVE · FULL BUTTON ALL' : 'OFF · TEXT-FIRST'}`,
    `Strategi: ${full.strategy || 'adaptive'}`,
    `Plugin terdaftar: ${inventory.length}`,
    `Command yang dievaluasi: ${candidates.length}`,
    `Pengecualian otomatis: ${exceptions.length}`,
    `Pengecualian custom: ${(full.excludedCommands || []).join(', ') || 'Tidak ada'}`,
    `Batas teks interaktif: ${full.maxBodyChars || 1800} karakter`,
    '',
    '*PENGECUALIAN PERMANEN*',
    list,
    '',
    'Engine memilih Quick Reply untuk 1–3 aksi dan Single Select untuk 4+ aksi. Teks panjang, kode, stack trace, pesan progres, dan output navigasi khusus tetap menggunakan teks.'
  ].join('\n');
}

function buttonAudit(config, plugins) {
  const inventory = planButtonInventory(plugins, config, getPrefixes()[0] || '');
  const lines = inventory.map((item, index) => {
    const aliases = item.aliases.length ? ` · alias: ${item.aliases.join(', ')}` : '';
    const mode = item.mode === 'exempt' ? 'EXEMPT' : `${item.mode.toUpperCase()} · ${item.actionCount} aksi`;
    return `${String(index + 1).padStart(2, '0')}. ${item.name} — ${mode}${aliases}\n    ${item.reason}`;
  });
  return `*FULL BUTTON · COMMAND AUDIT*\n${lines.join('\n')}\n\nAudit hanya membaca registry. Tidak ada pesan tombol yang dikirim saat audit.`;
}

export default {
  name: 'buttons',
  aliases: ['buttonmode', 'uibuttons', 'button', 'fullbutton', 'commandbutton'],
  category: 'owner',
  ownerOnly: true,
  privateOnly: true,
  fullButton: false,
  usage: 'full <all|off|status|audit|exclude add|remove|list> | <on|off|status>',
  description: 'Kelola mesin keputusan tombol adaptif untuk seluruh command dan alias',
  async execute({ m, args }) {
    const [first = 'help', second = ''] = args.map(value => String(value || '').trim());
    const action = first.toLowerCase();
    const sub = second.toLowerCase();
    const plugins = listPlugins();

    if (action === 'status' || (action === 'full' && sub === 'status')) {
      return m.reply(buttonStatus(getConfig(), plugins));
    }
    if (action === 'audit' || action === 'dry-run' || (action === 'full' && ['audit', 'dry-run'].includes(sub))) {
      return m.reply(buttonAudit(getConfig(), plugins));
    }

    if (action === 'full' && ['all', 'on'].includes(sub)) {
      await updateConfig(config => {
        config.ui.fullButton.enabled = true;
        config.ui.fullButton.strategy = 'adaptive';
        config.ui.buttonsEnabled = true;
      }, { actor: m.sender, reason: 'enable adaptive full-button engine for every eligible command and alias' });
      const updated = getConfig();
      const inventory = planButtonInventory(plugins, updated, getPrefixes()[0] || '');
      return m.reply(`*FULL BUTTON ALL DIAKTIFKAN*\n${inventory.length} plugin command masuk evaluasi adaptif. Alias mengikuti plugin induknya secara otomatis.\n\nEngine memilih Quick Reply, Single Select, atau teks berdasarkan konteks dan keamanan. Command yang sudah memiliki UI khusus tetap dikecualikan.\n\nJalankan .buttons full audit untuk melihat keputusan per command.`);
    }

    if (action === 'full' && ['off', 'disable'].includes(sub)) {
      await updateConfig(config => { config.ui.fullButton.enabled = false; }, { actor: m.sender, reason: 'disable adaptive full-button engine' });
      return m.reply('Full Button dinonaktifkan. Seluruh balasan kembali ke transport teks asli; UI khusus plugin tetap berjalan seperti sebelumnya.');
    }

    if (action === 'full' && sub === 'exclude') {
      const [operation = 'list', target = ''] = args.slice(2).map(value => String(value || '').trim());
      const current = getConfig().ui.fullButton.excludedCommands || [];
      if (operation.toLowerCase() === 'list') return m.reply(`*PENGECUALIAN CUSTOM*\n${current.length ? current.map(item => `• ${item}`).join('\n') : 'Belum ada pengecualian custom.'}\n\nPengecualian permanen sistem tidak dapat dihapus.`);
      const plugin = getPlugin(target);
      if (!plugin) return m.reply(`Command/alias tidak ditemukan: ${target || '(kosong)'}. Periksa .menu.`);
      if (hardExemptions[plugin.name]) return m.reply(`${plugin.name} sudah menjadi pengecualian permanen: ${hardExemptions[plugin.name]}.`);
      if (operation.toLowerCase() === 'add') {
        await updateConfig(config => {
          const list = new Set(config.ui.fullButton.excludedCommands || []);
          list.add(plugin.name);
          config.ui.fullButton.excludedCommands = [...list].sort();
        }, { actor: m.sender, reason: `exclude ${plugin.name} from adaptive full-button engine` });
        return m.reply(`Command *${plugin.name}* ditambahkan ke pengecualian custom. Semua aliasnya ikut dikecualikan.`);
      }
      if (['remove', 'delete', 'del'].includes(operation.toLowerCase())) {
        await updateConfig(config => {
          config.ui.fullButton.excludedCommands = (config.ui.fullButton.excludedCommands || []).filter(name => name !== plugin.name);
        }, { actor: m.sender, reason: `remove ${plugin.name} from adaptive full-button exclusions` });
        return m.reply(`Command *${plugin.name}* dihapus dari pengecualian custom. Semua aliasnya kembali dievaluasi engine.`);
      }
      return m.reply('Gunakan .buttons full exclude add <command|alias>, .buttons full exclude remove <command|alias>, atau .buttons full exclude list.');
    }

    if (action === 'on' || action === 'enable') {
      await updateConfig(config => {
        config.ui.buttonsEnabled = true;
        config.ui.fullButton.enabled = true;
      }, { actor: m.sender, reason: 'legacy buttons on maps to adaptive full-button mode' });
      return m.reply('Mode tombol adaptif diaktifkan untuk seluruh command yang memenuhi evaluasi engine. Alias mengikuti command induk dan pengecualian khusus tetap aman.');
    }
    if (action === 'off' || action === 'disable') {
      await updateConfig(config => {
        config.ui.buttonsEnabled = false;
        config.ui.fullButton.enabled = false;
      }, { actor: m.sender, reason: 'disable all automatic command buttons' });
      return m.reply('Mode tombol adaptif dimatikan. Semua balasan kembali ke teks biasa; UI khusus milik plugin tetap tidak diubah.');
    }

    return m.reply([
      '*COMMAND BUTTON ENGINE*',
      '.buttons full all — aktifkan tombol adaptif untuk seluruh command dan alias',
      '.buttons full off — nonaktifkan injeksi adaptif',
      '.buttons full status — status dan daftar pengecualian',
      '.buttons full audit — simulasi keputusan tanpa mengirim tombol',
      '.buttons full exclude list — daftar pengecualian tambahan',
      '.buttons full exclude add <command|alias> — kecualikan plugin dan seluruh aliasnya',
      '.buttons full exclude remove <command|alias> — aktifkan kembali evaluasi plugin',
      '.buttons on/off/status — alias kompatibilitas',
      '',
      'Mode full all tidak memaksa setiap pesan menjadi tombol. Engine menentukan UI paling sesuai: Quick Reply, Single Select, atau teks biasa. Output panjang, kode, error teknis, dan proses khusus tetap menggunakan teks.',
      'Perubahan hanya berlaku pada balasan teks biasa selama satu eksekusi command. Pengiriman gambar, dokumen, poll, carousel, kontak, Native Flow eksplisit, dan reply-session tidak ditimpa.'
    ].join('\n'));
  }
};
