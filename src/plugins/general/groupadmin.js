import { getGroupMetadata } from '../../core/group-metadata.js';
import { ensureGroupMetadata } from '../../core/group-runtime.js';
import { getTenantStatus, getQuotaStatus } from '../../rental/service.js';
import { getGroupTools, updateGroupRules, updateGroupWelcome } from '../../core/group-tools.js';

function cleanJid(value) { return String(value || '').replace(/:\d+(?=@)/, ''); }
function isPrivateJid(value) { return /^\d{8,15}@s\.whatsapp\.net$/.test(cleanJid(value)); }
function isAdmin(meta, sender) {
  if (!meta || !isPrivateJid(sender)) return false;
  const actor = cleanJid(sender);
  if ([meta.owner, meta.ownerPn].filter(Boolean).some(value => cleanJid(value) === actor)) return true;
  return (meta.participants || []).some(participant =>
    [participant?.id, participant?.phoneNumber, participant?.lid].filter(Boolean).some(value => cleanJid(value) === actor)
    && ['admin', 'superadmin', true].includes(participant.admin)
  );
}
async function requireActiveTenant(message) {
  if (!message.isGroup) throw new Error('Perintah .gadmin hanya dapat digunakan di grup.');
  if (message.isOwner) return { tenant: null, status: null };
  const status = await getTenantStatus(message.chat);
  if (!status.tenant || status.status !== 'active') {
    throw new Error('Fitur admin tambahan hanya aktif pada grup dengan sewa aktif. Periksa atau perpanjang melalui .sewa.');
  }
  return { tenant: status.tenant, status };
}
async function requireTenantAdmin(sock, message) {
  const { tenant, status } = await requireActiveTenant(message);
  const sender = cleanJid(message.senderPn || message.sender);
  if (message.isOwner) return { sender, meta: getGroupMetadata(message.chat), tenant, status };
  const current = getGroupMetadata(message.chat);
  const age = current?.lastSyncedAt ? Date.now() - Date.parse(current.lastSyncedAt) : Infinity;
  const meta = !current || !Number.isFinite(age) || age > 5 * 60_000
    ? await ensureGroupMetadata(sock, message.chat, { force: true })
    : current;
  const refreshedAge = meta?.lastSyncedAt ? Date.now() - Date.parse(meta.lastSyncedAt) : Infinity;
  if (!meta || !Number.isFinite(refreshedAge) || refreshedAge > 30 * 60_000) {
    throw new Error('Data admin grup belum dapat diperbarui. Coba lagi setelah metadata grup berhasil disinkronkan.');
  }
  if (!isAdmin(meta, sender)) throw new Error('Fitur ini khusus admin grup. Pastikan data admin tersinkron, lalu coba lagi.');
  return { sender, meta, tenant, status };
}
export default {
  name: 'groupadmin', aliases: ['gadmin', 'grupadmin'], category: 'general',
  usage: '[info|aturan [teks]|aturan hapus|welcome on|off [pesan]|poll <pertanyaan> | <opsi 1> | <opsi 2> | ...|announce <pesan>]',
  description: 'Panel admin grup untuk aturan, sambutan anggota, polling dan pengumuman',
  ui: { fullButton: { actions: [
    { label: 'Info Grup', command: 'groupadmin info', description: 'Status sewa, anggota, kuota dan fitur' },
    { label: 'Baca Aturan', command: 'groupadmin aturan', description: 'Lihat aturan grup yang tersimpan' },
    { label: 'Menu Admin', command: 'groupadmin help', description: 'Lihat seluruh perangkat admin grup' }
  ] } },
  async execute({ sock, m, args }) {
    const action = String(args[0] || 'help').toLowerCase();

    // Saved group rules are readable by every participant in a rented group.
    // Only rule changes and other management actions require WhatsApp admin.
    if ((action === 'aturan' || action === 'rules') && args.length === 1) {
      await requireActiveTenant(m);
      const tools = await getGroupTools(m.chat);
      return m.reply(tools.rules ? `*ATURAN GRUP*\n${tools.rules}` : 'Aturan grup belum diatur oleh admin.');
    }

    const { tenant } = await requireTenantAdmin(sock, m);

    if (action === 'info' || action === 'status') {
      const status = await getTenantStatus(m.chat);
      const quota = await getQuotaStatus(m.chat);
      const tools = await getGroupTools(m.chat);
      const memberCount = Number(status.memberCount || status.tenant?.memberCount || 0);
      return m.reply(`*PANEL ADMIN GRUP*\nGrup: ${status.tenant?.groupName || getGroupMetadata(m.chat)?.subject || m.chat}\nPaket: ${status.tenant?.planName || tenant?.planName || 'Owner'}\nAnggota: ${memberCount.toLocaleString('id-ID')}/${Number(status.memberLimit || status.tenant?.maxMembers || 0).toLocaleString('id-ID')}\nKuota: ${quota ? `${quota.used}/${quota.limit} unit` : 'Tidak terbatas'}\nAturan grup: ${tools.rules ? 'Sudah diatur' : 'Belum diatur'}\nSambutan anggota baru: ${tools.welcome.enabled ? 'Aktif' : 'Nonaktif'}\n\nGunakan .gadmin help untuk daftar fitur.`);
    }

    if (action === 'aturan' || action === 'rules') {
      const tools = await getGroupTools(m.chat);
      const sub = String(args[1] || '').toLowerCase();
      if (sub === 'hapus' || sub === 'clear') {
        await updateGroupRules(m.chat, '', m.sender);
        return m.reply('Aturan grup berhasil dihapus.');
      }
      const content = args.slice(1).join(' ').trim();
      if (!content) return m.reply(tools.rules ? `*ATURAN GRUP*\n${tools.rules}` : 'Aturan grup belum diatur. Admin dapat membuatnya dengan .gadmin aturan <isi aturan>.');
      const saved = await updateGroupRules(m.chat, content, m.sender);
      return m.reply(`Aturan grup berhasil disimpan (${saved.rules.length}/1.500 karakter). Anggota dapat membacanya dengan .gadmin aturan.`);
    }

    if (action === 'welcome' || action === 'sambutan') {
      const mode = String(args[1] || '').toLowerCase();
      if (!['on', 'off', 'aktif', 'nonaktif'].includes(mode)) {
        const tools = await getGroupTools(m.chat);
        return m.reply(`Sambutan anggota baru: ${tools.welcome.enabled ? 'AKTIF' : 'NONAKTIF'}\nAktifkan: .gadmin welcome on [pesan]\nMatikan: .gadmin welcome off`);
      }
      const enabled = ['on', 'aktif'].includes(mode);
      const custom = args.slice(2).join(' ').trim();
      const updated = await updateGroupWelcome(m.chat, enabled, custom, m.sender);
      return m.reply(`Sambutan anggota baru ${enabled ? 'diaktifkan' : 'dinonaktifkan'}.${enabled && updated.welcome.text ? `\nPesan: ${updated.welcome.text}` : ''}`);
    }

    if (action === 'poll' || action === 'jajak') {
      const raw = args.slice(1).join(' ');
      const parts = raw.split('|').map(value => value.trim()).filter(Boolean);
      const question = parts.shift();
      const options = parts;
      if (!question || options.length < 2 || options.length > 12) {
        return m.reply('Format: .gadmin poll Pertanyaan | Opsi 1 | Opsi 2 [| Opsi 3 ...]\nGunakan 2 sampai 12 pilihan; setiap pilihan maksimal 100 karakter.');
      }
      if (question.length > 250 || options.some(value => value.length > 100)) throw new Error('Pertanyaan maksimal 250 karakter dan setiap pilihan maksimal 100 karakter.');
      await sock.sendMessage(m.chat, { poll: { name: question, values: options, selectableCount: 1 } });
      return undefined;
    }

    if (action === 'announce' || action === 'pengumuman') {
      const announcement = args.slice(1).join(' ').trim();
      if (!announcement) return m.reply('Format: .gadmin announce <isi pengumuman>');
      if (announcement.length > 1500) throw new Error('Pengumuman maksimal 1.500 karakter.');
      await sock.sendMessage(m.chat, { text: `*PENGUMUMAN ADMIN GRUP*\n\n${announcement}\n\n_Dikirim oleh admin grup._` });
      return undefined;
    }

    return m.reply(`*PANEL ADMIN GRUP OCHA LIDYA*\n\n.gadmin info — status paket, anggota, kuota dan fitur admin\n.gadmin aturan — lihat aturan grup\n.gadmin aturan <teks> — simpan aturan (maks. 1.500 karakter)\n.gadmin aturan hapus — hapus aturan\n.gadmin welcome on [pesan] — sambutan anggota baru\n.gadmin welcome off — matikan sambutan\n.gadmin poll Pertanyaan | Opsi 1 | Opsi 2 — buat polling\n.gadmin announce <pesan> — kirim pengumuman tanpa mention massal\n\nPerintah hanya untuk admin grup dan tersedia selama sewa aktif.`);
  }
};
