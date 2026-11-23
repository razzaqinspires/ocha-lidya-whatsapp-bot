import { getConfig } from '../../core/config.js';
import { isVerifiedOwnerMessage } from '../../core/identity.js';
import { listFeatureRequests, updateFeatureRequest, formatFeatureRequest } from '../../ai/feature-requests.js';

function senderJid(m) {
  const value = String(m.senderPn || m.sender || '').replace(/:\d+(?=@)/, '');
  return /^(?:\d{8,15}@s\.whatsapp\.net|\d{8,20}@lid)$/.test(value) ? value : '';
}

export default {
  name: 'features',
  aliases: ['featurerequests', 'fiturreq'],
  category: 'owner',
  ownerOnly: true,
  privateOnly: true,
  menu: false,
  usage: '[list|all|show <request-id>|progress <id>|complete <id>|cancel <id>] ',
  description: 'Kelola permintaan pengembangan fitur yang tersimpan di User Vault privat owner',
  async execute({ m, args }) {
    if (m.isGroup || String(m.chat || '').endsWith('@g.us')) return m.reply('Feature backlog hanya dapat dibuka melalui DM owner.');
    if (!isVerifiedOwnerMessage(m, getConfig().bot.owner)) return m.reply('Akses ditolak.');
    const userId = senderJid(m);
    if (!userId) return m.reply('Identitas WhatsApp owner belum dapat dinormalisasi.');
    const action = String(args[0] || 'list').toLowerCase();

    if (['list', 'daftar', 'open', 'pending', 'all'].includes(action)) {
      const requests = await listFeatureRequests(userId, { includeClosed: action === 'all', limit: 20 });
      if (!requests.length) return m.reply(action === 'all' ? 'Belum ada permintaan fitur yang tercatat.' : 'Tidak ada permintaan fitur yang masih terbuka.');
      return m.reply([
        '*OCHA · FEATURE DEVELOPMENT BACKLOG*',
        ...requests.map((item, index) => `${index + 1}. ${item.title}\n   ID: ${item.id} · Status: ${item.status}\n   ${item.summary}`),
        '',
        'Detail: .features show <request-id>'
      ].join('\n'));
    }

    if (action === 'show') {
      const id = String(args[1] || '').toUpperCase();
      const requests = await listFeatureRequests(userId, { includeClosed: true, limit: 100 });
      const request = requests.find(item => item.id === id);
      return m.reply(request ? formatFeatureRequest(request) : 'Permintaan fitur tidak ditemukan pada vault owner ini.');
    }

    const statusMap = { progress: 'in-progress', complete: 'completed', completed: 'completed', cancel: 'cancelled', cancelled: 'cancelled', reopen: 'requested' };
    if (statusMap[action]) {
      const id = String(args[1] || '').toUpperCase();
      if (!id) return m.reply(`Format: .features ${action} <request-id> [catatan]`);
      const result = await updateFeatureRequest(userId, id, statusMap[action], args.slice(2).join(' '));
      if (!result.updated) return m.reply(result.reason === 'not-found' ? 'Permintaan tidak ditemukan di vault owner.' : 'ID atau status permintaan tidak valid.');
      return m.reply(`Permintaan ${id} diperbarui. Status: ${statusMap[action]}.`);
    }

    return m.reply([
      '*FEATURE BACKLOG COMMANDS*',
      '.features list — permintaan yang masih terbuka',
      '.features all — seluruh permintaan',
      '.features show <id> — detail dan kriteria penerimaan',
      '.features progress <id> [catatan] — mulai dikerjakan',
      '.features complete <id> [catatan] — tandai selesai',
      '.features cancel <id> [catatan] — batalkan',
      '.features reopen <id> [catatan] — buka kembali',
      '',
      'Backlog hanya membaca dan mengubah event pada User Vault owner yang terverifikasi.'
    ].join('\n'));
  }
};
