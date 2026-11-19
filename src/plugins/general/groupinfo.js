import { getCachedGroupInfo, getCachedGroups, hydrateParticipatingGroupsOnce } from '../../core/group-runtime.js';
import { getPrefixes } from '../../core/prefix.js';
import { getConfig } from '../../core/config.js';

const PAGE_SIZE = 10;

function groupRow(group, prefix) {
  const count = group.participants?.length || group.size || 0;
  return {
    title: String(group.subject || 'Grup tanpa nama').slice(0, 24),
    description: `${count} anggota · ${group.id}`.slice(0, 72),
    id: `${prefix}groupinfo ${group.id}`
  };
}

function renderInfo(meta) {
  const participants = meta.participants || [];
  const admins = participants.filter(participant => participant.admin === 'admin' || participant.admin === 'superadmin').length;
  const created = meta.creation ? new Date(meta.creation * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-';
  return [
    `*${meta.subject || 'Group'}*`,
    `ID: ${meta.id}`,
    `Owner: ${meta.ownerPn || meta.owner || '-'}`,
    `Anggota tersimpan: ${participants.length}`,
    `Admin: ${admins}`,
    `Dibuat: ${created}`,
    `Deskripsi: ${meta.desc || '-'}`,
    `Cache diperbarui: ${new Date(meta.updatedAt || meta.lastSyncedAt || Date.now()).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`
  ].join('\n');
}

export default {
  name: 'groupinfo', aliases: ['gcinfo', 'grouplist'], category: 'general',
  description: 'Informasi grup dari cache JSONL tanpa meminta metadata berulang',
  async execute({ sock, m, args }) {
    const groupId = args.find(value => value.endsWith('@g.us')) || (m.isGroup ? m.chat : '');
    if (groupId) {
      const meta = getCachedGroupInfo(groupId);
      if (!meta) return m.reply('Metadata grup belum tersedia di cache. Ocha akan mengisi cache saat menerima event grup berikutnya; perintah ini tidak memicu fetch berulang.');
      return m.reply(renderInfo(meta));
    }

    // In a private chat this performs the single initial batch sync only if it
    // has not already been checkpointed; later calls read the local cache.
    await hydrateParticipatingGroupsOnce(sock);
    const groups = getCachedGroups().sort((a, b) => String(a.subject || a.id).localeCompare(String(b.subject || b.id), 'id'));
    if (!groups.length) return m.reply('Belum ada metadata grup tersimpan. Cache diisi satu kali melalui sinkronisasi awal dan event grup.');

    const prefix = getPrefixes()[0] || '';
    const requestedPage = args[0]?.toLowerCase() === 'page' ? Number(args[1]) : Number(args[0]);
    const pageCount = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, pageCount) : 1;
    const start = (page - 1) * PAGE_SIZE;
    const visible = groups.slice(start, start + PAGE_SIZE);
    const rows = visible.map(group => groupRow(group, prefix));
    const body = `Tersimpan ${groups.length} grup dalam database metadata. Halaman ${page}/${pageCount}. Pilih grup untuk melihat detail.\n\n${visible.map((group, index) => `${start + index + 1}. ${group.subject || group.id} · ${group.participants?.length || 0} anggota`).join('\n')}`;
    const buttons = [];
    if (page > 1) buttons.push({ type: 'quick_reply', title: 'Sebelumnya', id: `${prefix}groupinfo page ${page - 1}` });
    if (page < pageCount) buttons.push({ type: 'quick_reply', title: 'Berikutnya', id: `${prefix}groupinfo page ${page + 1}` });
    if (getConfig().ui?.buttonsEnabled && sock.sendInteractive) {
      return sock.sendInteractive(m.chat, {
        title: 'GROUP METADATA CACHE',
        body,
        footer: 'Cache lokal · metadata grup tersimpan tidak di-fetch ulang',
        buttons: [...buttons, { type: 'single_select', title: 'Pilih grup', sections: [{ title: `Grup ${page}`, rows }] }]
      }, m);
    }
    return m.reply(body);
  }
};
