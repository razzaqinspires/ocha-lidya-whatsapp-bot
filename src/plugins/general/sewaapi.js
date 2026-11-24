import { getRentalContext, getTenantStatus } from '../../rental/service.js';
import { createRentalAccessKey, listOwnerRentalAccessKeys, revokeRentalAccessKey } from '../../rental/access-keys.js';
import { getPublicGatewayUrl } from '../../runtime/code-lab.js';

function cleanJid(value) { return String(value || '').replace(/:\d+(?=@)/, '').toLowerCase(); }
function privateJid(value) { return /^\d{8,15}@s\.whatsapp\.net$/.test(cleanJid(value)); }

export default {
  name: 'sewaapi', aliases: ['dashboardkey', 'webkey'], category: 'general',
  usage: '[buat|list|revoke] [rental|profile|id]',
  description: 'Kelola dua API key privat untuk dashboard informasi sewa dan profil',
  async execute({ sock, m, args }) {
    if (m.isGroup) return m.reply('Pengelolaan API key hanya tersedia di chat pribadi. Ketik .sewaapi di pesan pribadi bot.');
    const ownerJid = cleanJid(m.senderPn || m.sender);
    if (!privateJid(ownerJid)) return m.reply('Identitas WhatsApp belum dapat diverifikasi.');
    const action = String(args[0] || 'menu').toLowerCase();
    if (action === 'gateway' || action === 'url') {
      const context = await getRentalContext(ownerJid);
      if (!context) return m.reply('Pilih grup sewa melalui .sewa di grup tujuan terlebih dahulu.');
      const tenant = await getTenantStatus(context.groupJid);
      if (!tenant.tenant || tenant.status !== 'active' || cleanJid(tenant.tenant.billingContact) !== ownerJid) return m.reply('URL gateway dashboard hanya dapat diminta oleh kontak pemesan sewa aktif.');
      const gateway = await getPublicGatewayUrl();
      return m.reply(`*DASHBOARD API GATEWAY*\n${gateway}\n\nGunakan sebagai Base URL aplikasi Android. Endpoint rental: ${gateway}/api/v1/rental/overview. URL TryCloudflare sementara dan dapat berubah saat bot restart. Minta URL baru melalui .sewaapi gateway.`);
    }
    if (['list', 'daftar'].includes(action)) {
      const keys = await listOwnerRentalAccessKeys(ownerJid);
      if (!keys.length) return m.reply('Belum ada API key dashboard pada akun ini. Ketik .sewaapi untuk membuat.');
      return m.reply(`*API KEY DASHBOARD ANDA*\n${keys.map(key => `${key.id} · ${key.type.toUpperCase()}\nScope: ${(key.scopes || [key.scope]).join(', ')}\nStatus: ${key.status.toUpperCase()}\nDibuat: ${key.createdAt}\nRequest: ${key.requestCount || 0}\nTerakhir dipakai: ${key.lastUsedAt || '-'}`).join('\n\n')}\n\nSecret utuh tidak dapat ditampilkan kembali. Cabut key yang tidak digunakan: .sewaapi revoke <id>.`);
    }
    if (['revoke', 'cabut'].includes(action)) {
      if (!args[1]) return m.reply('Format: .sewaapi revoke <ID-KEY>');
      const key = await revokeRentalAccessKey({ ownerJid, keyId: args[1] });
      return m.reply(`API key ${key.id} berstatus ${key.status.toUpperCase()}. Semua request berikutnya dengan key tersebut akan ditolak.`);
    }
    if (['buat', 'create', 'rental', 'profile'].includes(action)) {
      const type = ['profile'].includes(action) ? 'profile' : String(args[1] || '').toLowerCase() || (action === 'rental' ? 'rental' : '');
      if (!['rental', 'profile'].includes(type)) return m.reply('Pilih salah satu: .sewaapi buat rental atau .sewaapi buat profile.');
      const context = await getRentalContext(ownerJid);
      if (!context) return m.reply('Pilih grup sewa terlebih dahulu dengan mengetik .sewa di grup tujuan, lalu kembali ke chat pribadi.');
      const tenant = await getTenantStatus(context.groupJid);
      if (!tenant.tenant || tenant.status !== 'active') return m.reply('API key dashboard hanya tersedia bagi penyewa dengan status sewa aktif. Periksa .sewa status atau hubungi owner.');
      if (type === 'rental' && cleanJid(tenant.tenant.billingContact) !== ownerJid) return m.reply('API key pengelolaan hanya dapat dibuat oleh kontak pemesan/pembayar sewa grup ini.');
      const key = await createRentalAccessKey({ ownerJid, groupJid: context?.groupJid, type });
      const details = `*API KEY BERHASIL DIBUAT*\nID: ${key.id}\nJenis: ${key.type}\nScope: ${(key.scopes || [key.scope]).join(', ')}\n\nAPI KEY (ditampilkan sekali):\n${key.secret}\n\nSimpan di password manager atau secret manager. Jangan kirim ke grup, jangan masukkan ke source code, dan jangan unggah ke GitHub. Jika bocor, cabut dengan .sewaapi revoke ${key.id}.\n\nEndpoint:\n${type === 'rental' ? 'GET /api/v1/rental/overview · PATCH /api/v1/rental/member-limit · POST /api/v1/rental/membership/actions · GET/PATCH /api/v1/rental/commands · GET /api/v1/rental/membership/actions' : 'GET /api/v1/profile'}\nHeader: x-api-key: <API_KEY>`;
      if (typeof sock.sendInteractive === 'function') {
        try {
          await sock.sendInteractive(m.chat, { title: 'DASHBOARD API KEY', body: `Key ${key.id} berhasil dibuat. Salin secret sekarang; secret tidak dapat ditampilkan kembali.`, footer: 'Simpan secara privat.', buttons: [{ name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: 'Salin API Key', copy_code: key.secret }) }] }, m);
          return m.reply(`Key ${key.id} dibuat. Endpoint: ${type === 'rental' ? 'GET /api/v1/rental/overview · PATCH /api/v1/rental/member-limit · POST /api/v1/rental/membership/actions · GET/PATCH /api/v1/rental/commands · GET /api/v1/rental/membership/actions' : 'GET /api/v1/profile'}. Jika tombol salin tidak tersedia di WhatsApp Anda, hubungi owner untuk rotasi key; secret tidak dapat dipulihkan.`);
        } catch {}
      }
      return m.reply(details);
    }
    const body = '*DASHBOARD ACCESS · OCHA LIDYA*\n\nPilih salah satu API key. Setiap jenis mempunyai izin terpisah. Key rental berisi izin baca dan tulis dengan audit, pembatasan tenant, antrean tindakan anggota, dan idempotency.\n\n1. Pengelolaan sewa — status paket, anggota, limit paket, kuota, dan permintaan aksi anggota.\n2. Informasi profil — profil akun WhatsApp pemilik key.\n\nBuat: .sewaapi buat rental\nBuat: .sewaapi buat profile\nGateway: .sewaapi gateway\nDaftar: .sewaapi list\nCabut: .sewaapi revoke <id>\n\nAPI key hanya memberi akses pada grup sewa yang terkait dan kontak pemesan. Perubahan limit dibatasi maksimum paket aktif. Aksi anggota masuk antrean dan diproses bot setelah memeriksa status sewa, keberadaan anggota, dan hak admin bot. Semua mutasi memiliki audit log.';
    if (typeof sock.sendInteractive === 'function') {
      try {
        return await sock.sendInteractive(m.chat, { title: 'PILIH JENIS API KEY', body, footer: 'Satu key untuk satu scope.', buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: 'Pilih akses dashboard', sections: [{ title: 'Jenis API key', rows: [{ id: '.sewaapi buat rental', title: 'Informasi Detail Sewa', description: 'Status, anggota, limit, kuota, masa aktif' }, { id: '.sewaapi buat profile', title: 'Informasi Profil', description: 'Data profil akun pemilik API key' }] }] }) }] }, m);
      } catch {}
    }
    return m.reply(body);
  }
};
