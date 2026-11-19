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

async function sendGroupDetail(sock, m, groupId, page, groups) {
  const meta = getCachedGroupInfo(groupId);
  if (!meta) {
    await m.reply('Metadata grup belum tersedia di cache. Ocha akan mengisi cache melalui event grup berikutnya; command ini tidak memicu fetch berulang.');
    return;
  }
  const backText = `${renderInfo(meta)}\n\nBalas *0* untuk kembali ke daftar grup.`;
  return m.replyWithSession(backText, {
    kind: 'groupinfo-detail',
    choices: [{ key: '0', label: 'Kembali ke daftar grup', value: { action: 'page', page } }],
    helpText: 'Balas *0* untuk kembali ke daftar grup.',
    onSelect: async ({ sock: activeSock, message }) => sendGroupPage(activeSock, message, groups, page)
  });
}

async function sendGroupPage(sock, m, groups, requestedPage = 1) {
  const prefix = getPrefixes()[0] || '';
  const pageCount = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const page = Math.max(1, Math.min(pageCount, Number(requestedPage) || 1));
  const start = (page - 1) * PAGE_SIZE;
  const visible = groups.slice(start, start + PAGE_SIZE);
  const choices = visible.map((group, index) => ({
    key: String(index + 1),
    label: group.subject || group.id,
    value: { action: 'detail', groupId: group.id }
  }));
  if (page < pageCount) choices.push({ key: '0', label: 'Halaman berikutnya', value: { action: 'page', page: page + 1 } });
  if (page > 1) choices.push({ key: '00', label: 'Halaman sebelumnya', value: { action: 'page', page: page - 1 } });

  const lines = [
    '*GROUP METADATA CACHE*',
    `Tersimpan ${groups.length} grup dalam database metadata. Halaman ${page}/${pageCount}.`,
    'Balas dengan angka pada pesan ini untuk memilih grup.',
    '',
    ...visible.map((group, index) => `${index + 1}. ${group.subject || group.id} · ${group.participants?.length || 0} anggota`)
  ];
  if (page < pageCount) lines.push('', '0. Halaman berikutnya');
  if (page > 1) lines.push('00. Halaman sebelumnya');
  lines.push('', `Atau gunakan command langsung: ${prefix}groupinfo <group-id>`);

  return m.replyWithSession(lines.join('\n'), {
    kind: 'groupinfo-list',
    choices,
    helpText: `Balas angka 1-${visible.length} untuk membuka grup${page < pageCount ? ', 0 untuk halaman berikutnya' : ''}${page > 1 ? ', atau 00 untuk halaman sebelumnya' : ''}.`,
    onSelect: async ({ sock: activeSock, message, value }) => {
      if (value.action === 'page') return sendGroupPage(activeSock, message, groups, value.page);
      if (value.action === 'detail') return sendGroupDetail(activeSock, message, value.groupId, page, groups);
    }
  });
}

export default {
  name: 'groupinfo', aliases: ['gcinfo', 'grouplist'], category: 'general',
  description: 'Informasi grup dari cache JSONL dengan navigasi melalui reply angka',
  async execute({ sock, m, args }) {
    const groupId = args.find(value => value.endsWith('@g.us')) || (m.isGroup ? m.chat : '');
    if (groupId) {
      const meta = getCachedGroupInfo(groupId);
      if (!meta) return m.reply('Metadata grup belum tersedia di cache. Ocha akan mengisi cache saat menerima event grup berikutnya; perintah ini tidak memicu fetch berulang.');
      return m.reply(renderInfo(meta));
    }

    // Private-chat list reads the local cache after one-time bootstrap.
    await hydrateParticipatingGroupsOnce(sock);
    const groups = getCachedGroups().sort((a, b) => String(a.subject || a.id).localeCompare(String(b.subject || b.id), 'id'));
    if (!groups.length) return m.reply('Belum ada metadata grup tersimpan. Cache diisi satu kali melalui sinkronisasi awal dan event grup.');

    const requestedPage = args[0]?.toLowerCase() === 'page' ? Number(args[1]) : Number(args[0]);
    return sendGroupPage(sock, m, groups, Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  }
};
