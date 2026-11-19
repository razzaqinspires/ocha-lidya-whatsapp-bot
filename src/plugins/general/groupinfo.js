import { getCachedGroupInfo, getCachedGroups, hydrateParticipatingGroupsOnce } from '../../core/group-runtime.js';
import { getPrefixes } from '../../core/prefix.js';

const PAGE_SIZE = 10;

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
    const body = `Tersimpan ${groups.length} grup dalam database metadata. Halaman ${page}/${pageCount}. Pilih grup untuk melihat detail.\n\n${visible.map((group, index) => `${start + index + 1}. ${group.subject || group.id} · ${group.participants?.length || 0} anggota`).join('\n')}`;
    // Text-first pagination avoids unsupported native-flow payloads.
    const navigation = [
      page > 1 ? `${prefix}groupinfo page ${page - 1} · sebelumnya` : null,
      page < pageCount ? `${prefix}groupinfo page ${page + 1} · berikutnya` : null
    ].filter(Boolean);
    const selectable = visible.map((group, index) => `${prefix}groupinfo ${group.id} · ${group.subject || 'Grup ' + (start + index + 1)}`);
    return m.reply([
      '*GROUP METADATA CACHE*',
      body,
      '',
      '*Buka detail grup:*',
      ...selectable,
      ...(navigation.length ? ['', '*Navigasi:*', ...navigation] : [])
    ].join('\n'));
  }
};
