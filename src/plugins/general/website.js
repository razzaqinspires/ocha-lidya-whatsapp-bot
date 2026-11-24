import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebsiteVerification, getWebsiteVerification, reportWebsitePayment } from '../../rental/website-verification.js';
import { createWebsiteSite, getWebsiteTemplates, listWebsiteSites, updateWebsiteSite, addWebsiteSection, createWebsitePost, publishWebsiteSite, createWebsiteEditorSession, createWebsiteShareCard } from '../../rental/website-sites.js';
import { getPublicGatewayUrl } from '../../runtime/code-lab.js';
import { getConfig } from '../../core/config.js';
const QRIS_PATH = fileURLToPath(new URL('../../../assets/payments/qris-razzaq-ventures.jpg', import.meta.url));
const OWNER_JID = () => `${String(getConfig().bot.owner || '').replace(/\D/g, '')}@s.whatsapp.net`;
function clean(value) { return String(value || '').replace(/:\d+(?=@)/, '').toLowerCase(); }
function privateJid(value) { return /^\d{8,15}@s\.whatsapp\.net$/.test(clean(value)); }
function helpText() {
  return '*OCHA WEBSITE BUILDER · PART 2*\n\n.website templates — lihat tujuh template\n.website create <template> [slug] — buat draft website\n.website list — daftar website milik Anda\n.website publish <slug> — terbitkan melalui shared TryCloudflare\n.website editor <slug> — buka editor halaman visual\n.website edit <slug> <field> <value> — edit melalui chat\n.website section <slug> <judul> | <isi> — tambah bagian halaman\n.website post <slug> <caption> — tambah post teks/foto/video\n.website share <slug> <post-id> — buat kartu share PNG\n.website status — status verifikasi dan website\n.website guide — panduan lengkap\n\nField edit: title, tagline, description, about, ctaText, whatsapp, email, instagram, location, primaryColor, secondaryColor. Untuk foto/video, kirim media dengan caption: .website post <slug> <caption>.';
}

export default {
  name: 'website', aliases: ['buatwebsite', 'webprofile'], category: 'general',
  usage: '[templates|create|list|publish|editor|edit|post|share|verify|paid|bukti|status|guide]',
  description: 'Buat, edit, terbitkan, dan kelola website profesional dengan tujuh template, posting media, dan kartu share',
  async execute({ sock, m, args }) {
    if (m.isGroup) return m.reply('Website Builder hanya diproses melalui chat pribadi agar tautan editor dan data akun tetap privat. Buka chat pribadi bot, lalu ketik .website.');
    const user = clean(m.senderPn || m.sender);
    if (!privateJid(user)) return m.reply('Identitas WhatsApp belum dapat diverifikasi.');
    const action = String(args[0] || 'guide').toLowerCase();

    if (action === 'templates' || action === 'template') {
      const templates = getWebsiteTemplates();
      return m.reply(`*PILIH TEMPLATE WEBSITE*\n\n${templates.map(item => `${item.id} — ${item.name}\n${item.description}\nCocok untuk: ${item.demo}`).join('\n\n')}\n\nContoh: .website create business razzaq-profile`);
    }
    if (action === 'create' || action === 'buat') {
      const site = await createWebsiteSite(user, { template: args[1] || 'business', slug: args[2] || '' });
      return m.reply(`*DRAFT WEBSITE BERHASIL DIBUAT*\nNama: ${site.title}\nSlug: ${site.slug}\nTemplate: ${site.template}\nSumber akses: ${site.source === 'rental' ? 'Paket sewa aktif' : 'Verifikasi centang biru'}\n\nLangkah berikutnya:\n1. .website editor ${site.slug}\n2. Atur konten melalui editor atau .website edit ${site.slug} <field> <value>\n3. .website publish ${site.slug}\n\nSatu slot website berlaku per grup sewa atau satu kali untuk akun terverifikasi.`);
    }
    if (action === 'list' || action === 'daftar') {
      const sites = await listWebsiteSites(user);
      if (!sites.length) return m.reply('Belum ada website. Ketik .website templates, lalu .website create <template> [slug].');
      return m.reply(`*WEBSITE ANDA · ${sites.length}*\n\n${sites.map(site => `${site.title}\nSlug: ${site.slug} · Template: ${site.template}\nStatus: ${site.status.toUpperCase()} · Versi ${site.version}\nPost: ${site.posts?.length || 0} · Diperbarui: ${site.updatedAt}`).join('\n\n')}\n\nEdit: .website editor <slug>\nTerbitkan: .website publish <slug>`);
    }
    if (action === 'publish' || action === 'terbitkan') {
      const slug = args[1];
      if (!slug) return m.reply('Format: .website publish <slug>');
      const baseUrl = await getPublicGatewayUrl();
      const site = await publishWebsiteSite(user, slug, baseUrl);
      return m.reply(`*WEBSITE BERHASIL DITERBITKAN*\n${site.title}\nTemplate: ${site.template}\nURL publik:\n${site.publicUrl}\n\nData situs tersimpan permanen di database lokal. URL TryCloudflare bersifat sementara dan dapat berubah ketika bot memulai ulang; terbitkan ulang untuk memperoleh URL aktif yang baru.`);
    }
    if (action === 'editor' || action === 'editlink') {
      const slug = args[1];
      if (!slug) return m.reply('Format: .website editor <slug>');
      const baseUrl = await getPublicGatewayUrl();
      const editorUrl = await createWebsiteEditorSession(user, slug, baseUrl);
      return m.reply(`*EDITOR WEBSITE*\n${editorUrl}\n\nLink editor berlaku 24 jam dan hanya untuk pemilik website. Jangan kirim link ini ke grup atau pihak lain.`);
    }
    if (action === 'edit' || action === 'ubah') {
      const [slug, field, ...valueParts] = args.slice(1);
      if (!slug || !field || !valueParts.length) return m.reply('Format: .website edit <slug> <field> <value>\nField tersedia: title, tagline, description, about, ctaText, whatsapp, email, instagram, location, primaryColor, secondaryColor.\nContoh: .website edit profil title Razzaq Ventures');
      const editable = new Set(['title', 'tagline', 'description', 'about', 'ctaText', 'whatsapp', 'email', 'instagram', 'location', 'primaryColor', 'secondaryColor']);
      if (!editable.has(field)) return m.reply('Field tidak dikenali. Lihat .website guide untuk daftar field yang dapat diedit.');
      const patch = { [field]: valueParts.join(' ') };
      const site = await updateWebsiteSite(user, slug, patch);
      return m.reply(`Website ${site.slug} diperbarui. Versi ${site.version}. Perubahan langsung tampil pada URL publik yang sudah diterbitkan.`);
    }
    if (action === 'section' || action === 'bagian') {
      const slug = args[1];
      const combined = args.slice(2).join(' ');
      const divider = combined.indexOf('|');
      if (!slug || divider < 1) return m.reply('Format: .website section <slug> <judul> | <isi bagian>.');
      const site = await addWebsiteSection(user, slug, combined.slice(0, divider).trim(), combined.slice(divider + 1).trim());
      return m.reply(`Bagian halaman berhasil ditambahkan ke ${site.slug}. Total bagian tambahan: ${site.customSections.length}.`);
    }
    if (action === 'post' || action === 'posting') {
      const slug = args[1];
      if (!slug) return m.reply('Format: .website post <slug> <caption>. Untuk media, kirim foto/video dengan caption perintah tersebut.');
      const caption = args.slice(2).join(' ');
      let media = null;
      if (['imageMessage', 'videoMessage'].includes(m.type) && typeof m.download === 'function') {
        const downloaded = await m.download();
        media = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded || []);
      }
      const result = await createWebsitePost(user, slug, { caption, media });
      return m.reply(`Post berhasil disimpan.\nID: ${result.post.id}\nMedia: ${media ? (m.type === 'videoMessage' ? 'Video tersimpan' : 'Foto tersimpan') : 'Teks'}\nWebsite: ${result.site.slug}\nVersi: ${result.site.version}\n\nKartu share: .website share ${result.site.slug} ${result.post.id}`);
    }
    if (action === 'share' || action === 'kartu') {
      const slug = args[1]; const postId = args[2];
      if (!slug || !postId) return m.reply('Format: .website share <slug> <post-id>');
      const image = await createWebsiteShareCard(user, slug, postId);
      return sock.sendMessage(m.chat, { image, caption: `Kartu konten · ${slug}\nDibuat dari Ocha Website Builder.` }, { quoted: m });
    }
    if (action === 'status') {
      const entitlement = await getWebsiteVerification(user);
      const sites = await listWebsiteSites(user);
      const verification = entitlement?.verified
        ? `VERIFIED ✓ · Slot ${entitlement.websiteSlotsUsed}/${entitlement.websiteSlotsGranted}`
        : 'Belum terverifikasi untuk slot non-penyewa';
      return m.reply(`*WEBSITE ACCOUNT STATUS*\n${verification}\nWebsite tersimpan: ${sites.length}\n\n${sites.length ? sites.map(site => `${site.slug} · ${site.status.toUpperCase()} · ${site.posts?.length || 0} post`).join('\n') : 'Belum ada website.'}\n\nPenyewa aktif mendapat satu slot website pada grup yang dipilih melalui .sewa.`);
    }
    if (action === 'verify' || action === 'daftar-verifikasi') {
      const order = await createWebsiteVerification(user);
      let qr;
      try { qr = await fs.readFile(QRIS_PATH); } catch {}
      const caption = `*VERIFIKASI WEBSITE · RAZZAQ VENTURES*\nInvoice: ${order.id}\nBiaya: *Rp10.000* (satu kali)\nMasa pembayaran: 24 jam\n\nScan QRIS, masukkan nominal tepat Rp10.000, lalu kirim laporan: .website paid ${order.id}\nAtau kirim foto bukti dengan caption: .website bukti ${order.id}\n\nCentang biru dan satu slot website diberikan setelah owner memeriksa dana masuk. Screenshot tidak mengaktifkan verifikasi otomatis.`;
      if (qr) return sock.sendMessage(m.chat, { image: qr, caption }, { quoted: m });
      return m.reply(caption);
    }
    if (action === 'paid') {
      const order = await reportWebsitePayment(args[1], user, { note: args.slice(2).join(' ') });
      try { await sock.sendMessage(OWNER_JID(), { text: `VERIFIKASI WEBSITE MENUNGGU PEMERIKSAAN\nInvoice: ${order.id}\nPemohon: ${user}\nNominal: Rp10.000\nStatus: ${order.status}\nSetujui melalui .webverify approve ${order.id}\nTolak melalui .webverify reject ${order.id} [alasan]` }); } catch {}
      return m.reply(`Laporan pembayaran ${order.id} diterima dan menunggu verifikasi owner. Slot website belum diberikan.`);
    }
    if (action === 'bukti' || action === 'proof') {
      const orderId = String(args[1] || '').toUpperCase();
      if (!orderId || m.type !== 'imageMessage' || typeof m.download !== 'function') return m.reply('Kirim foto JPG/PNG/WEBP dengan caption .website bukti <invoice>.');
      const image = await m.download();
      const buffer = Buffer.isBuffer(image) ? image : Buffer.from(image || []);
      if (!buffer.length || buffer.length > 5 * 1024 * 1024) return m.reply('Bukti kosong atau melebihi 5 MB.');
      const validImage = (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) || buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP');
      if (!validImage) return m.reply('Bukti harus berupa gambar JPG, PNG, atau WEBP yang valid.');
      const evidenceDir = path.resolve('data/website-verification-evidence');
      await fs.mkdir(evidenceDir, { recursive: true, mode: 0o700 });
      const evidencePath = path.join(evidenceDir, `${orderId}-${Date.now()}.bin`);
      await fs.writeFile(evidencePath, buffer, { flag: 'wx', mode: 0o600 });
      const relativeEvidence = path.relative(process.cwd(), evidencePath).replaceAll(path.sep, '/');
      const order = await reportWebsitePayment(orderId, user, { note: args.slice(2).join(' '), file: relativeEvidence });
      try { await sock.sendMessage(OWNER_JID(), { image: buffer, caption: `BUKTI VERIFIKASI WEBSITE\nInvoice: ${order.id}\nPemohon: ${user}\nNominal: Rp10.000\nArsip: ${relativeEvidence}\nPeriksa mutasi sebelum menyetujui.` }); } catch {}
      return m.reply(`Bukti untuk ${order.id} diterima. Status masih menunggu verifikasi dana oleh owner.`);
    }
    if (action === 'guide' || action === 'panduan' || action === 'help') return m.reply(`${helpText()}\n\nAkses non-penyewa: .website verify → pembayaran Rp10.000 → owner approve → satu slot.\nAkses penyewa: pilih grup dengan .sewa di grup lalu gunakan Website Builder dari chat pribadi. Setiap grup sewa mendapat satu website.\n\nMedia post menerima JPG/PNG/WEBP maksimum 10 MB atau MP4 maksimum 20 MB per file, total media 50 MB per website. Share card dibuat dalam PNG 1:1; konten video diringkas menjadi kartu teks/caption. File asli disimpan di server dengan permission privat.`);
    return m.reply(helpText());
  }
};
