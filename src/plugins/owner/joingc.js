import { ensureGroupMetadata, getCachedGroupInfo } from '../../core/group-runtime.js';
import { rememberJoinedGroup, isGroupJid } from '../../core/group-control.js';
import { upsertGroupMetadata } from '../../core/group-metadata.js';

const INVITE_HOST = 'chat.whatsapp.com';

export function extractWhatsAppInviteCode(input) {
  const raw = String(input || '').trim().replace(/^<(.+)>$/, '$1');
  if (!raw || raw.length > 500) throw new Error('Masukkan satu tautan undangan WhatsApp yang valid.');
  let url;
  try { url = new URL(raw); }
  catch { throw new Error('Format tautan tidak valid. Contoh: https://chat.whatsapp.com/KODEUNDANGAN'); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== INVITE_HOST || url.username || url.password || url.port) {
    throw new Error('Hanya tautan resmi https://chat.whatsapp.com/ yang diterima. Tautan redirect atau domain lain ditolak.');
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 1) throw new Error('Tautan undangan harus berisi satu kode undangan langsung.');
  let code;
  try { code = decodeURIComponent(segments[0]); }
  catch { throw new Error('Kode undangan memiliki encoding yang tidak valid.'); }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(code)) throw new Error('Kode undangan tidak valid.');
  return code;
}

function groupIdFrom(value) {
  if (typeof value === 'string' && isGroupJid(value)) return value;
  if (value && typeof value === 'object') {
    for (const candidate of [value.id, value.gid, value.groupId, value.jid]) {
      if (typeof candidate === 'string' && isGroupJid(candidate)) return candidate;
    }
  }
  return '';
}

export default {
  name: 'joingc',
  aliases: ['joingroup', 'join-group'],
  category: 'owner',
  ownerOnly: true,
  privateOnly: true,
  description: 'Masukkan bot ke grup WhatsApp melalui tautan undangan; grup baru dimulai dalam status mute',
  async execute({ sock, m, args, text }) {
    const rawLink = String(text || args.join(' ') || '').trim();
    if (!rawLink) return m.reply('Gunakan: .joingc <url-undangan-whatsapp>\nContoh: .joingc https://chat.whatsapp.com/KODEUNDANGAN');

    let code;
    try { code = extractWhatsAppInviteCode(rawLink); }
    catch (error) { return m.reply(`Tautan ditolak: ${error.message}`); }

    if (typeof sock.groupAcceptInvite !== 'function') {
      return m.reply('Baileys socket tidak menyediakan groupAcceptInvite. Periksa versi dependency WhatsApp yang terpasang.');
    }

    let inviteInfo = null;
    if (typeof sock.groupGetInviteInfo === 'function') {
      try { inviteInfo = await sock.groupGetInviteInfo(code); }
      catch (error) {
        return m.reply(`Undangan tidak dapat diverifikasi oleh WhatsApp: ${String(error?.message || error).slice(0, 240)}\nBot belum mencoba masuk ke grup.`);
      }
    }

    const previewId = groupIdFrom(inviteInfo);
    const alreadyCached = previewId ? getCachedGroupInfo(previewId) : null;
    let joinedId = previewId;
    let alreadyMember = false;

    // Always ask WhatsApp to accept/confirm the invite. A local cache entry can
    // be stale if the bot was removed while it was offline.
    try {
      const result = await sock.groupAcceptInvite(code);
      joinedId = groupIdFrom(result) || joinedId;
    } catch (error) {
      // If WhatsApp says the invite cannot be accepted, query current membership
      // once before returning an error. This avoids trusting stale local metadata.
      if (!previewId || typeof sock.groupFetchAllParticipating !== 'function') {
        return m.reply(`Gagal bergabung ke grup: ${String(error?.message || error).slice(0, 300)}`);
      }
      try {
        const participating = await sock.groupFetchAllParticipating();
        const values = Array.isArray(participating) ? participating : Object.values(participating || {});
        alreadyMember = values.some(group => groupIdFrom(group) === previewId);
        if (!alreadyMember) return m.reply(`Gagal bergabung ke grup: ${String(error?.message || error).slice(0, 300)}`);
        joinedId = previewId;
      } catch {
        return m.reply(`Gagal bergabung ke grup: ${String(error?.message || error).slice(0, 300)}`);
      }
    }

    if (!isGroupJid(joinedId)) {
      return m.reply('WhatsApp menerima permintaan join, tetapi tidak mengembalikan Group JID yang dapat diverifikasi. Periksa .groupinfo setelah sinkronisasi grup.');
    }

    let metadata = null;
    try { metadata = await ensureGroupMetadata(sock, joinedId, { force: true }); }
    catch { /* Join succeeded; metadata can be hydrated by the next group event. */ }
    if (!metadata && inviteInfo && groupIdFrom(inviteInfo) === joinedId) {
      try { metadata = await upsertGroupMetadata({ ...inviteInfo, id: joinedId, participants: inviteInfo.participants || [] }); }
      catch { /* Keep the successful membership result even if cache persistence is temporarily unavailable. */ }
    }

    try {
      await rememberJoinedGroup(joinedId, { actor: m.sender, reason: 'owner joined group via .joingc; group starts muted' });
    } catch (error) {
      return m.reply(`Bot berhasil bergabung ke ${metadata?.subject || inviteInfo?.subject || 'grup'}, tetapi status mute tidak berhasil disimpan ke database. Global mute saat ini: ${'tetap mengikuti konfigurasi yang berlaku'}. Error: ${String(error?.message || error).slice(0, 180)}`);
    }
    const title = metadata?.subject || inviteInfo?.subject || alreadyCached?.subject || 'Grup WhatsApp';
    return m.reply([
      alreadyMember ? 'BOT SUDAH TERDAFTAR DI GRUP' : 'BERHASIL BERGABUNG KE GRUP',
      `Nama: ${title}`,
      `Group ID: ${joinedId}`,
      'Status interaksi: MUTE (default aman)',
      'Untuk mengaktifkan bot hanya di grup ini, kirim `.mute off` di chat pribadi owner.',
      'Periksa daftar dan status grup melalui `.groupinfo`.'
    ].join('\n'));
  }
};
