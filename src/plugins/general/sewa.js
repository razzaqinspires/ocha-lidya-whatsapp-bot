import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../../core/config.js';
import { getGroupMetadata } from '../../core/group-metadata.js';
import { ensureGroupMetadata } from '../../core/group-runtime.js';
import {
  getQuotaStatus, getTenantStatus, createRentalOrder, setOrderPaymentMethod,
  reportPayment, attachPaymentEvidence, cancelOrder, getOrder, getPlans,
  setRentalContext, getRentalContext, submitRentalReview, getRentalReviewSummary,
  getTenant, createRentalSupportTicket, listOrders
} from '../../rental/service.js';
import { isCustomerOrder, listCustomerOrders, customerVisibleOrderStatus } from '../../rental/customer-portal.js';
import { PAYMENT_METHODS, normalizePaymentMethod } from '../../rental/payment-methods.js';
import { formatRupiah } from '../../rental/catalog.js';

const QRIS_PATH = fileURLToPath(new URL('../../../assets/payments/qris-razzaq-ventures.jpg', import.meta.url));
const EVIDENCE_ROOT = path.resolve('data/rental-evidence');
const OWNER_JID = () => `${getConfig().bot.owner}@s.whatsapp.net`;
const GROUP_ACK_WINDOW_MS = 45_000;
const groupAckAt = new Map();
const dateWib = value => new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) + ' WIB';
const prettyDuration = ms => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days ? `${days} hari` : '', hours ? `${hours} jam` : '', minutes ? `${minutes} menit` : ''].filter(Boolean).join(' ') || `${seconds} detik`;
};
function cleanJid(value) { return String(value || '').replace(/:\d+(?=@)/, ''); }
function isPrivateJid(value) { return /^\d{8,15}@s\.whatsapp\.net$/.test(cleanJid(value)); }
function participantMatches(participant, sender) {
  const normalized = cleanJid(sender);
  return [participant?.id, participant?.phoneNumber, participant?.lid].filter(Boolean).some(value => cleanJid(value) === normalized);
}
function isGroupAdminInMetadata(meta, sender) {
  if (!meta || !isPrivateJid(sender)) return false;
  const user = cleanJid(sender);
  const groupOwner = [meta.owner, meta.ownerPn].filter(Boolean).some(value => cleanJid(value) === user);
  if (groupOwner) return true;
  return (meta.participants || []).some(participant => participantMatches(participant, user) && ['admin', 'superadmin', true].includes(participant.admin));
}
function getSenderJid(message) {
  const sender = cleanJid(message.senderPn || message.sender);
  return isPrivateJid(sender) ? sender : '';
}
async function refreshAndRequireGroupAdmin(sock, message, context) {
  if (message.isOwner) return getGroupMetadata(context.groupJid);
  const current = getGroupMetadata(context.groupJid);
  const age = current?.lastSyncedAt ? Date.now() - Date.parse(current.lastSyncedAt) : Number.POSITIVE_INFINITY;
  let meta = current;
  if (!current || !Number.isFinite(age) || age > 5 * 60_000) {
    meta = await ensureGroupMetadata(sock, context.groupJid, { force: true });
  }
  const refreshedAge = meta?.lastSyncedAt ? Date.now() - Date.parse(meta.lastSyncedAt) : Number.POSITIVE_INFINITY;
  if (!meta || !Number.isFinite(refreshedAge) || refreshedAge > 30 * 60_000) {
    throw new Error('Data admin grup belum dapat diperbarui. Kembali ke grup tujuan, ketik .sewa sekali lagi, lalu coba kembali di chat pribadi.');
  }
  if (!isGroupAdminInMetadata(meta, getSenderJid(message))) {
    throw new Error(`Aksi ini hanya dapat dilakukan admin grup *${context.groupName}*. Minta admin grup menjalankan .sewa di grup tersebut dan menyelesaikan transaksi dari chat pribadinya.`);
  }
  return meta;
}
function planDescription(plan) {
  return [
    `*PAKET ${plan.name.toUpperCase()}*`,
    `Harga: *${formatRupiah(plan.price)}* untuk ${plan.durationDays} hari`,
    `Kapasitas: maksimal *${Number(plan.maxMembers).toLocaleString('id-ID')} anggota*`,
    `Kuota bersama: *${Number(plan.dailyQuota).toLocaleString('id-ID')} unit / 24 jam*`,
    'Hak akses: seluruh anggota grup dapat menggunakan fitur bot yang tersedia untuk pengguna grup.',
    'Fitur admin: kelola aturan grup, sambutan anggota baru, dan buat polling.',
    'Masa tenggang setelah berakhir: 48 jam.'
  ].join('\n');
}
function catalogText(plans) {
  return `*OCHA LIDYA · PAKET SEWA GRUP*\n\n${Object.values(plans).map(planDescription).join('\n\n')}`
    + `\n\n*Cara menghitung kuota*\n• Command ringan: 1 unit\n• AI dan media: 3 unit\n• Pencarian, unduhan, website, dan proyek: 5 unit\n• Eksekusi kode/build/deploy: 12 unit\n\nKuota digunakan bersama oleh semua anggota grup, bukan kuota per orang. Reset 24 jam mengikuti waktu aktivasi. Status, menu, dan perintah pembayaran tidak memotong kuota.\n\n*Cara mulai*\n1. Pastikan Anda admin grup tujuan.\n2. Di grup tersebut, ketik *.sewa*.\n3. Lanjutkan semua langkah di chat pribadi bot.\n4. Ketik *.sewa plan mini* (atau standard/pro) untuk membuat invoice.\n5. Pilih metode pembayaran, transfer sesuai nominal, lalu laporkan atau kirim foto bukti.\n6. Layanan aktif setelah owner memverifikasi dana masuk.`;
}
function comparisonText(plans) {
  return `*PERBANDINGAN PAKET SEWA*\n\n${Object.values(plans).map(plan => [
    `*${plan.name}*`, `Harga: ${formatRupiah(plan.price)} / ${plan.durationDays} hari`,
    `Kapasitas: ${Number(plan.maxMembers).toLocaleString('id-ID')} anggota`,
    `Kuota: ${Number(plan.dailyQuota).toLocaleString('id-ID')} unit / 24 jam`
  ].join('\n')).join('\n\n')}\n\nPaket tidak memberi akses ke command owner/developer. Semua anggota tetap tunduk pada izin command dan kebijakan keamanan bot.`;
}
function rentalFaq() {
  return [
    '*FAQ SEWA OCHA LIDYA*',
    '1. Pembayaran dilakukan di mana? Semua transaksi hanya melalui chat pribadi bot.',
    '2. Kapan grup aktif? Setelah owner memverifikasi dana masuk, bukan hanya dari screenshot.',
    '3. Apakah kuota untuk setiap anggota? Tidak, kuota dipakai bersama oleh semua anggota grup.',
    '4. Kapan kuota reset? Setiap 24 jam berdasarkan jendela aktivasi grup.',
    '5. Bisa ganti paket? Buat invoice paket baru lewat .sewa upgrade <mini|standard|pro>.',
    '6. Apakah level/XP membuka fitur owner? Tidak. Akses ditentukan role WhatsApp dan policy backend.',
    '7. Bagaimana memberi ulasan? Pelanggan terverifikasi dapat memakai .sewa ulasan <1-5> [komentar].',
    '8. Bagaimana menyampaikan saran atau kendala? Gunakan .sewa masukan <pesan> atau .sewa konsultasi <pesan> di chat pribadi.'
  ].join('\n');
}
async function sendReviewSummary(message) {
  const summary = await getRentalReviewSummary();
  const average = summary.total ? `${summary.average.toFixed(2)}/5` : 'Belum ada ulasan terverifikasi';
  const distribution = [5, 4, 3, 2, 1].map(score => `${score}★ ${summary.distribution[score] || 0}`).join('  ·  ');
  const comments = summary.reviews.filter(item => item.comment).map(item => `“${item.comment}” — ${item.planName}, ${item.rating}/5`).join('\n');
  return message.reply(`*RATING SEWA OCHA LIDYA*\nRata-rata: *${average}*\nTotal ulasan pembelian terverifikasi: ${summary.total}\n${distribution}${comments ? `\n\n*ULASAN TERBARU*\n${comments}` : ''}\n\nRating hanya dihitung dari transaksi yang terverifikasi. Tidak ada rating buatan atau pengulangan ulasan untuk satu invoice.`);
}
async function sendPlans(sock, message) {
  const plans = await getPlans();
  const rows = Object.values(plans).map(plan => ({
    id: `.sewa plan ${plan.id}`,
    title: `${plan.name} · ${formatRupiah(plan.price)}`.slice(0, 24),
    description: `${Number(plan.maxMembers).toLocaleString('id-ID')} anggota · ${Number(plan.dailyQuota).toLocaleString('id-ID')} unit/24 jam`.slice(0, 72)
  }));
  const body = catalogText(plans);
  if (typeof sock.sendInteractive === 'function') {
    try {
      return await sock.sendInteractive(message.chat, {
        title: 'OCHA LIDYA · PILIH PAKET',
        subtitle: 'Rental WhatsApp Bot · Razzaq Ventures',
        body,
        footer: 'Semua transaksi dilanjutkan di chat pribadi.',
        buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: 'Lihat dan pilih paket', sections: [{ title: 'Paket 30 hari', rows }] }) }]
      }, message);
    } catch {}
  }
  return message.reply(`${body}\n\nPilih paket dengan mengetik *.sewa plan mini*, *.sewa plan standard*, atau *.sewa plan pro*.`);
}
async function sendGroupRedirect(sock, message, args) {
  const sender = getSenderJid(message);
  if (!sender) {
    return message.reply('Nomor pribadi Anda belum dapat dipetakan oleh WhatsApp. Buka chat pribadi bot dan ketik .sewa, atau coba lagi setelah sinkronisasi nomor selesai.');
  }
  const meta = await ensureGroupMetadata(sock, message.chat);
  const groupName = meta?.subject || message.chat;
  await setRentalContext(sender, message.chat, groupName);
  const action = String(args[0] || 'packages').toLowerCase();
  const command = args.length ? `.sewa ${args.join(' ')}` : '.sewa';
  const hasPaymentImage = message.type === 'imageMessage' || Boolean(message.message?.imageMessage);
  let groupMediaRemoval = '';
  if (hasPaymentImage) {
    // Payment evidence must never be accepted or archived from a group chat.
    // Attempt to remove the source message when the bot has delete permissions.
    try {
      if (message.key) await sock.sendMessage(message.chat, { delete: message.key });
      groupMediaRemoval = '\nPesan media di grup telah diminta untuk dihapus. Jika masih terlihat, hapus manual dan kirim ulang bukti lewat chat pribadi.';
    } catch {
      groupMediaRemoval = '\nBot tidak memiliki izin menghapus pesan tersebut. Hapus pesan media secara manual dari grup, lalu kirim ulang bukti melalui chat pribadi.';
    }
  }
  const intro = `*OCHA LIDYA · CHECKOUT PRIBADI*\nKonteks grup tersimpan: *${groupName}*\n\nUntuk menjaga privasi, katalog, invoice, detail rekening/QRIS, laporan pembayaran, dan bukti transaksi hanya dikirim melalui chat pribadi. Tidak ada invoice yang dibuat dari perintah grup.\n\nLanjutkan di chat pribadi bot dengan mengetik perintah yang sama:\n*${command}*\n\n${action === 'paid' || action === 'bukti' || action === 'proof' || hasPaymentImage ? 'Kirim laporan atau foto bukti pembayaran di chat pribadi, bukan di grup.' : 'Untuk mulai dari awal, ketik *.sewa* di chat pribadi untuk melihat paket.'}${groupMediaRemoval}\n\nSesi grup ini berlaku 12 jam. Pastikan Anda admin grup saat membuat invoice atau mengelola pembayaran.`;
  try {
    await sock.sendMessage(sender, { text: intro });
  } catch {
    return message.reply('Saya belum dapat mengirim pesan pribadi. Simpan nomor bot dan buka chat pribadi bot terlebih dahulu, lalu ketik .sewa. Belum ada invoice atau detail pembayaran yang dibuat.');
  }
  const key = `${message.chat}:${sender}`;
  const now = Date.now();
  const previous = groupAckAt.get(key) || 0;
  if (previous <= now) {
    groupAckAt.set(key, now + GROUP_ACK_WINDOW_MS);
    if (groupAckAt.size > 5000) for (const [entry, expiry] of groupAckAt) if (expiry <= now) groupAckAt.delete(entry);
    await message.reply('Panduan sewa dan langkah berikutnya sudah dikirim ke pesan pribadi Anda. Silakan buka chat pribadi Ocha Lidya untuk melanjutkan.');
  }
}
async function sendPaymentMenu(sock, message, order) {
  const methods = [
    ['qris', 'QRIS', 'Scan kode QRIS Razzaq Ventures'],
    ['ovo', 'OVO', 'Transfer ke e-wallet'],
    ['gopay', 'GoPay', 'Transfer ke e-wallet'],
    ['dana', 'DANA', 'Transfer ke e-wallet'],
    ['seabank', 'SeaBank', 'Transfer ke rekening bank']
  ];
  const body = `*INVOICE ${order.id}*\nGrup: ${order.groupName}\nPaket: ${order.planName}\nJumlah anggota maksimal: ${Number(order.maxMembers || 0).toLocaleString('id-ID')}\nTotal: *${formatRupiah(order.amount)}*\nMasa aktif: ${order.durationDays} hari\nKuota: ${Number(order.dailyQuota).toLocaleString('id-ID')} unit/24 jam\nBatas pembayaran: ${dateWib(order.expiresAt)}\n\nPilih metode pembayaran di bawah. Layanan baru aktif setelah owner memverifikasi dana masuk.`;
  if (typeof sock.sendInteractive === 'function') {
    try {
      return await sock.sendInteractive(message.chat, {
        title: 'PILIH METODE PEMBAYARAN', body, footer: 'Jangan pernah membagikan PIN, OTP, atau kata sandi.',
        buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: 'Metode pembayaran', sections: [{ title: 'Pembayaran tersedia', rows: methods.map(([id, title, description]) => ({ id: `.sewa pay ${order.id} ${id}`, title, description })) }] }) }]
      }, message);
    } catch {}
  }
  return message.reply(`${body}\n\n${methods.map(([id, name]) => `.sewa pay ${order.id} ${id} — ${name}`).join('\n')}`);
}
async function sendPaymentDetails(sock, message, order, methodId) {
  const method = PAYMENT_METHODS[methodId];
  if (!method) throw new Error('Metode pembayaran tidak tersedia. Pilih kembali melalui .sewa pay.');
  const safeHeader = `*OCHA LIDYA · PEMBAYARAN*\nInvoice: ${order.id}\nGrup: ${order.groupName}\nPaket: ${order.planName}\nNominal: *${formatRupiah(order.amount)}*\nPenerima: ${method.receiver || 'RAZZAQ VENTURES'}`;
  if (method.kind === 'static-qris') {
    try {
      const image = await fs.readFile(QRIS_PATH);
      await sock.sendMessage(message.chat, { image, caption: `${safeHeader}\n\nScan QRIS Razzaq Ventures dan masukkan nominal persis seperti invoice. QRIS ini statis, jadi pembayaran tidak terverifikasi otomatis. Simpan ID invoice untuk laporan pembayaran.` });
    } catch {
      await message.reply(`${safeHeader}\n\nFile QRIS tidak dapat dibaca saat ini. Jangan melakukan transfer sebelum gambar QRIS dikirim oleh bot. Hubungi owner untuk bantuan.`);
      return;
    }
    return message.reply(`Setelah pembayaran berhasil, ketik *.sewa paid ${order.id}* atau kirim foto bukti dengan caption *.sewa bukti ${order.id}*.`);
  }
  const account = method.account;
  const details = `${safeHeader}\nMetode: ${method.name}\nNomor rekening/e-wallet: *${account}*\nNama penerima: *${method.receiver}*\n\nTransfer sesuai nominal invoice. Periksa nama penerima sebelum mengirim. Setelah berhasil, ketik *.sewa paid ${order.id}* atau kirim foto bukti dengan caption *.sewa bukti ${order.id}*.`;
  if (typeof sock.sendInteractive === 'function') {
    try {
      return await sock.sendInteractive(message.chat, {
        title: `${method.name} · INVOICE`, body: details, footer: 'Pastikan data penerima benar sebelum transfer.',
        buttons: [{ name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: `Salin ${method.name}`, copy_code: account }) }, { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Saya sudah membayar', id: `.sewa paid ${order.id}` }) }]
      }, message);
    } catch {}
  }
  return message.reply(details);
}
function imageExtension(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', mimetype: 'image/jpeg' };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { ext: 'png', mimetype: 'image/png' };
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mimetype: 'image/webp' };
  return null;
}
async function storePaymentEvidence(message, order, note = '') {
  if (message.type !== 'imageMessage' || typeof message.download !== 'function') {
    throw new Error(`Kirim foto bukti sebagai gambar dengan caption: .sewa bukti ${order.id} [catatan]. Format JPG, PNG, atau WEBP; maksimal 5 MB.`);
  }
  const downloaded = await message.download();
  const buffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded || []);
  if (!buffer.length) throw new Error('File gambar kosong atau gagal diunduh. Kirim ulang foto bukti.');
  if (buffer.length > 5 * 1024 * 1024) throw new Error('Ukuran bukti pembayaran maksimal 5 MB. Kompres gambar lalu kirim ulang.');
  const detected = imageExtension(buffer);
  if (!detected) throw new Error('File bukan gambar JPG, PNG, atau WEBP yang valid.');
  const evidenceId = crypto.randomUUID();
  const relativePath = `data/rental-evidence/${order.id}/${evidenceId}.${detected.ext}`;
  const absolutePath = path.resolve(relativePath);
  if (!absolutePath.startsWith(`${EVIDENCE_ROOT}${path.sep}`)) throw new Error('Lokasi penyimpanan bukti tidak valid.');
  await fs.mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
  await fs.chmod(path.dirname(absolutePath), 0o700);
  await fs.writeFile(absolutePath, buffer, { flag: 'wx', mode: 0o600 });
  return { buffer, absolutePath, record: { id: evidenceId, relativePath, mimetype: detected.mimetype, size: buffer.length }, note };
}
async function notifyOwnerPayment(sock, order, actor, label = 'PEMBAYARAN SEWA PERLU DIVERIFIKASI') {
  const text = `*${label}*\nInvoice: ${order.id}\nGrup: ${order.groupName}\nGroup JID: ${order.groupJid}\nPaket: ${order.planName}\nNominal: ${formatRupiah(order.amount)}\nMetode: ${order.paymentMethod || '-'}\nPelapor: ${actor}\nWaktu: ${dateWib(order.paymentReportedAt)}\nBukti terlampir: ${(order.paymentEvidence || []).length}\n\nPeriksa mutasi/merchant dashboard. Screenshot bukan bukti dana masuk.\nSetujui: .rentals approve ${order.id}\nTolak: .rentals reject ${order.id} [alasan]`;
  await sock.sendMessage(OWNER_JID(), { text });
}
async function requirePrivateContext(sock, message, { admin = true } = {}) {
  const sender = getSenderJid(message);
  if (!sender || message.isGroup) throw new Error('Perintah ini hanya dapat dijalankan melalui chat pribadi bot.');
  const context = await getRentalContext(sender);
  if (!context) throw new Error('Grup tujuan belum dipilih atau sesi telah kedaluwarsa. Buka grup tujuan, ketik .sewa, lalu lanjutkan dari chat pribadi bot (sesi berlaku 12 jam).');
  if (admin) await refreshAndRequireGroupAdmin(sock, message, context);
  return { sender, context };
}

export default {
  name: 'sewa', aliases: ['rent', 'paketsewa'], category: 'general', fullButton: false,
  usage: '[bandingkan|estimasi <anggota>|faq|rating|testimoni|ulasan <1-5> [komentar]|masukan <pesan>|konsultasi <pesan>|status|pesanan|invoice [id]|plan|upgrade|perpanjang|pay|paid|bukti|cancel]',
  description: 'Paket sewa, invoice dan pembayaran pribadi per grup WhatsApp',
  async execute({ sock, m, args }) {
    if (m.isGroup) return sendGroupRedirect(sock, m, args);

    const action = String(args[0] || 'packages').toLowerCase();
    if (['packages', 'paket', 'list', 'help', 'bantuan'].includes(action)) {
      if (action === 'help' || action === 'bantuan') {
        const context = await getRentalContext(getSenderJid(m));
        return m.reply(`*PANDUAN SEWA OCHA LIDYA*\n${context ? `Grup terpilih: ${context.groupName}` : 'Grup belum dipilih.'}\n\n.sewa — lihat paket\n.sewa bandingkan — bandingkan paket\n.sewa estimasi <anggota> — rekomendasi kapasitas\n.sewa fitur / .sewa faq — fitur dan pertanyaan umum\n.sewa rating / testimoni — rating dan ulasan pelanggan terverifikasi\n.sewa ulasan <1-5> [komentar] — kirim satu ulasan per invoice terverifikasi\n.sewa masukan <pesan> — buat tiket saran/kendala layanan\n.sewa konsultasi <pesan> — minta konsultasi paket atau teknis\n.sewa plan <mini|standard|pro> — buat invoice\n.sewa upgrade <paket> — upgrade paket\n.sewa perpanjang — perpanjang paket aktif\n.sewa pay <invoice> <qris|ovo|gopay|dana|seabank> — pilih pembayaran\n.sewa paid <invoice> — laporkan pembayaran\n.sewa bukti <invoice> — kirim foto bukti melalui chat pribadi\n.sewa invoice [id] — cek invoice milik Anda\n.sewa pesanan — riwayat invoice milik Anda\n.sewa status — masa aktif dan kuota\n.sewa cancel <invoice> — batalkan invoice\n\nPemesanan, dukungan, dan pembayaran hanya diproses di chat pribadi. Untuk memilih grup, ketik .sewa di grup tujuan. Hanya admin grup yang dapat membuat invoice dan mengelola transaksi.`);
      }
      return sendPlans(sock, m);
    }

    if (['rating', 'reviews', 'ulasan-terbaru', 'testimoni'].includes(action) || (action === 'ulasan' && !args[1])) {
      return sendReviewSummary(m);
    }
    if (['bandingkan', 'compare', 'perbandingan'].includes(action)) {
      return m.reply(comparisonText(await getPlans()));
    }
    if (['estimasi', 'kalkulator', 'rekomendasi'].includes(action)) {
      const members = Number(String(args[1] || '').replace(/[^0-9]/g, ''));
      if (!Number.isSafeInteger(members) || members < 1 || members > 100000) {
        return m.reply('Format: .sewa estimasi <jumlah_anggota>. Masukkan angka 1 sampai 100000.');
      }
      const plans = Object.values(await getPlans()).sort((a, b) => a.price - b.price);
      const recommended = plans.find(plan => members <= plan.maxMembers);
      if (!recommended) {
        return m.reply(`Untuk ${members.toLocaleString('id-ID')} anggota, kapasitas paket saat ini belum mencukupi. Paket terbesar menampung ${Math.max(...plans.map(plan => plan.maxMembers)).toLocaleString('id-ID')} anggota. Hubungi owner untuk konsultasi kapasitas khusus.`);
      }
      return m.reply(`*ESTIMASI PAKET SEWA*\nJumlah anggota: ${members.toLocaleString('id-ID')}\nRekomendasi: *${recommended.name}*\nHarga: ${formatRupiah(recommended.price)} / ${recommended.durationDays} hari\nKapasitas: ${Number(recommended.maxMembers).toLocaleString('id-ID')} anggota\nKuota bersama: ${Number(recommended.dailyQuota).toLocaleString('id-ID')} unit/24 jam\n\nIni estimasi kapasitas, bukan invoice. Untuk transaksi, pilih grup tujuan dengan .sewa di grup lalu lanjutkan di chat pribadi.`);
    }
    if (['fitur', 'features'].includes(action)) {
      const plans = await getPlans();
      return m.reply(`${catalogText(plans)}\n\n*KEAMANAN DAN KETERSEDIAAN*\nPaket sewa membuka penggunaan fitur yang memang tersedia untuk grup. Fitur sensitif tetap memerlukan hak admin/owner. Ketersediaan command mengikuti konfigurasi server dan dapat berubah saat maintenance.`);
    }
    if (['faq', 'tanya'].includes(action)) return m.reply(rentalFaq());

    if (action === 'context' || action === 'grup') {
      const context = await getRentalContext(getSenderJid(m));
      return m.reply(context ? `Grup tujuan: ${context.groupName}\nSesi berlaku sampai ${dateWib(context.expiresAt)}.` : 'Belum ada grup tujuan. Ketik .sewa di dalam grup yang ingin disewakan.');
    }

    // Read-only customer self-service is available to the invoice requester;
    // it does not require current group-admin status and never reveals peer orders.
    if (['invoice', 'pesanan', 'riwayat', 'orders'].includes(action)) {
      const sender = getSenderJid(m);
      if (!sender || m.isGroup) return m.reply('Riwayat dan invoice hanya dapat dilihat melalui chat pribadi bot.');
      const context = await getRentalContext(sender);
      if (!context) return m.reply('Grup tujuan belum dipilih atau sesi telah kedaluwarsa. Ketik .sewa di grup tujuan, lalu buka chat pribadi bot.');

      if (action === 'invoice') {
        const orderId = String(args[1] || '').trim().toUpperCase();
        const candidate = orderId ? await getOrder(orderId) : listCustomerOrders(await listOrders(), context.groupJid, sender, 1)[0];
        if (!candidate || !isCustomerOrder(candidate, context.groupJid, sender)) {
          return m.reply('Invoice tidak ditemukan pada grup terpilih atau invoice tersebut bukan milik akun WhatsApp ini. Ketik .sewa pesanan untuk melihat invoice milik Anda.');
        }
        const status = customerVisibleOrderStatus(candidate);
        const labels = {
          pending: 'MENUNGGU PEMBAYARAN', payment_reported: 'PEMBAYARAN DILAPORKAN · MENUNGGU VERIFIKASI',
          approved: 'DISETUJUI · LAYANAN DIAKTIFKAN', rejected: 'DITOLAK', cancelled: 'DIBATALKAN', expired: 'KEDALUWARSA', unknown: 'STATUS TIDAK DIKENAL'
        };
        return m.reply(`*DETAIL INVOICE SEWA OCHA LIDYA*\nInvoice: *${candidate.id}*\nGrup: ${candidate.groupName}\nPaket: ${candidate.planName}\nTotal: *${formatRupiah(candidate.amount)}*\nStatus: *${labels[status] || labels.unknown}*\nDibuat: ${dateWib(candidate.createdAt)}\nBatas pembayaran: ${dateWib(candidate.expiresAt)}\nMetode pembayaran: ${candidate.paymentMethod || 'Belum dipilih'}\n${candidate.paymentReportedAt ? `Dilaporkan dibayar: ${dateWib(candidate.paymentReportedAt)}\n` : ''}${candidate.approvedAt ? `Disetujui: ${dateWib(candidate.approvedAt)}\n` : ''}${candidate.rejectionReason ? `Alasan penolakan: ${String(candidate.rejectionReason).slice(0, 180)}\n` : ''}\nUntuk riwayat lain: .sewa pesanan`);
      }

      const orders = listCustomerOrders(await listOrders(), context.groupJid, sender, 10);
      if (!orders.length) return m.reply(`Belum ada invoice yang dibuat oleh akun WhatsApp ini untuk grup *${context.groupName}*. Ketik .sewa plan mini untuk membuat invoice baru.`);
      const labels = { pending: 'Menunggu pembayaran', payment_reported: 'Menunggu verifikasi', approved: 'Disetujui', rejected: 'Ditolak', cancelled: 'Dibatalkan', expired: 'Kedaluwarsa', unknown: 'Status tidak dikenal' };
      const rows = orders.map(order => {
        const status = customerVisibleOrderStatus(order);
        return `• *${order.id}* — ${order.planName} · ${formatRupiah(order.amount)}\n  ${labels[status] || labels.unknown} · ${dateWib(order.createdAt)}`;
      });
      return m.reply(`*RIWAYAT INVOICE ANDA*\nGrup: ${context.groupName}\nMenampilkan ${orders.length} invoice terbaru yang dibuat oleh akun ini.\n\n${rows.join('\n')}\n\nDetail invoice: .sewa invoice <id>\nInvoice terbaru: .sewa invoice`);
    }

    const { sender, context } = await requirePrivateContext(sock, m, { admin: true });
    if (['masukan', 'feedback', 'saran', 'keluhan', 'konsultasi', 'support'].includes(action)) {
      const raw = args.slice(1).join(' ').trim();
      const category = ['saran', 'keluhan', 'konsultasi'].includes(action) ? action : 'masukan';
      if (raw.length < 12) {
        return m.reply(`Format: .sewa ${action === 'konsultasi' ? 'konsultasi' : 'masukan'} <pesan>\nJelaskan kebutuhan atau kendala minimal 12 karakter. Jangan sertakan password, OTP, API key, atau data pembayaran rahasia.`);
      }
      const result = await createRentalSupportTicket({
        groupJid: context.groupJid, requesterJid: sender, requesterName: m.pushName,
        category, message: raw
      });
      const ticket = result.ticket;
      try {
        await sock.sendMessage(OWNER_JID(), { text: `*TIKET PELANGGAN SEWA · ${ticket.id}*\nKategori: ${ticket.category.toUpperCase()}\nGrup: ${ticket.groupName}\nPengirim: ${ticket.requesterName}\nWhatsApp: ${ticket.requesterJid}\nWaktu: ${dateWib(ticket.createdAt)}\n\n${ticket.message}\n\nBalas: .rentals reply ${ticket.id} <pesan>\nTutup: .rentals close ${ticket.id}` });
      } catch (error) {
        // The ticket remains in the owner queue even when the immediate DM fails.
      }
      return m.reply(result.duplicate
        ? `Pesan yang sama sudah tercatat sebagai tiket *${ticket.id}*. Tiket masih menunggu tindak lanjut.`
        : `*MASUKAN BERHASIL DICATAT*\nID tiket: *${ticket.id}*\nKategori: ${ticket.category}\nGrup: ${ticket.groupName}\nStatus: MENUNGGU TINDAK LANJUT\n\nTim Razzaq Ventures menerima masukan ini. Simpan ID tiket untuk rujukan. Respons owner akan dikirim melalui chat pribadi.`);
    }
    const groupJid = context.groupJid;

    if (action === 'ulasan' || action === 'review') {
      const rating = Number(args[1]);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return m.reply('Format: .sewa ulasan <1-5> [komentar]. Hanya pelanggan dengan invoice yang telah disetujui dapat mengirim satu ulasan untuk setiap invoice.');
      }
      const comment = args.slice(2).join(' ').slice(0, 240);
      const result = await submitRentalReview({ groupJid, reviewerJid: sender, rating, comment });
      return m.reply(result.duplicate
        ? `Ulasan untuk invoice terverifikasi ini sudah pernah dikirim dengan rating ${result.review.rating}/5. Ulasan yang sama tidak dihitung dua kali.`
        : `Terima kasih. Ulasan ${rating}/5 telah tercatat untuk transaksi terverifikasi paket ${result.review.planName}. Rating publik hanya dihitung dari transaksi sah.`);
    }

    if (action === 'status' || action === 'cek') {
      const status = await getTenantStatus(groupJid);
      if (!status.tenant) return m.reply(`Grup *${context.groupName}* belum memiliki langganan aktif.\nLihat paket: .sewa\nBuat invoice: .sewa plan mini`);
      const quota = await getQuotaStatus(groupJid);
      const tenant = status.tenant;
      const statusLabel = status.status === 'over-limit' ? 'MELEBIHI BATAS ANGGOTA' : status.status.toUpperCase();
      return m.reply(`*STATUS SEWA OCHA LIDYA*\nGrup: ${tenant.groupName}\nPaket: ${tenant.planName}\nStatus: *${statusLabel}*\nAnggota: ${Number(status.memberCount).toLocaleString('id-ID')}/${Number(status.memberLimit).toLocaleString('id-ID')} orang\nMasa aktif sampai: ${dateWib(tenant.expiresAt)}\nSisa masa aktif: ${prettyDuration(status.remainingMs)}\n${status.status === 'grace' ? `Masa tenggang: ${prettyDuration(status.graceRemainingMs)}\n` : ''}${status.overLimit ? 'Kurangi jumlah anggota atau buat invoice paket dengan kapasitas lebih besar.\n' : ''}Kuota 24 jam: ${quota.used}/${quota.limit} unit\nSisa kuota: ${quota.remaining} unit\nReset kuota: ${dateWib(quota.resetAt)}\nHitung mundur reset: ${prettyDuration(quota.remainingMs)}\n\nPerpanjang atau tingkatkan kapasitas: .sewa plan <paket>`);
    }

    if (['plan', 'paketkan', 'upgrade', 'perpanjang', 'renew'].includes(action)) {
      const currentTenant = await getTenant(groupJid);
      const requestedPlan = String(args[1] || '').toLowerCase();
      const planId = requestedPlan || (['perpanjang', 'renew'].includes(action) ? currentTenant?.planId : '');
      if (!planId) return sendPlans(sock, m);
      const result = await createRentalOrder({ groupJid, requestedBy: sender, groupName: context.groupName, planId });
      return sendPaymentMenu(sock, m, result.order);
    }

    if (action === 'pay' || action === 'bayar') {
      const orderId = args[1];
      const methodId = normalizePaymentMethod(args[2]);
      if (!orderId || !methodId) return m.reply('Format: .sewa pay <invoice> <qris|ovo|gopay|dana|seabank>');
      const order = await getOrder(orderId);
      if (!order || order.groupJid !== groupJid) return m.reply('Invoice tidak ditemukan untuk grup yang sedang dipilih. Ketik .sewa di grup invoice tersebut untuk mengganti konteks.');
      const updated = await setOrderPaymentMethod(orderId, methodId, sender);
      return sendPaymentDetails(sock, m, updated, methodId);
    }

    if (action === 'paid' || action === 'sudah') {
      const orderId = args[1];
      if (!orderId) return m.reply('Format: .sewa paid <invoice> [catatan]');
      const order = await getOrder(orderId);
      if (!order || order.groupJid !== groupJid) return m.reply('Invoice tidak ditemukan untuk grup yang sedang dipilih.');
      const result = await reportPayment(orderId, sender, args.slice(2).join(' '));
      await m.reply(`*PEMBAYARAN DILAPORKAN*\nInvoice: ${result.order.id}\nNominal: ${formatRupiah(result.order.amount)}\nStatus: MENUNGGU VERIFIKASI OWNER\n\nLaporan sudah diteruskan kepada owner. Layanan belum aktif sampai dana benar-benar terverifikasi. Anda juga dapat mengirim foto bukti dengan caption *.sewa bukti ${result.order.id}*.`);
      if (!result.reused) {
        try { await notifyOwnerPayment(sock, result.order, sender); }
        catch (error) { await m.reply('Laporan tersimpan, tetapi pemberitahuan otomatis kepada owner gagal dikirim. Hubungi owner dan sebutkan ID invoice tersebut.'); }
      }
      return undefined;
    }

    if (action === 'bukti' || action === 'proof') {
      const orderId = args[1];
      if (!orderId) return m.reply('Kirim gambar dengan caption: .sewa bukti <invoice> [catatan].');
      const order = await getOrder(orderId);
      if (!order || order.groupJid !== groupJid) return m.reply('Invoice tidak ditemukan untuk grup yang sedang dipilih.');
      const stored = await storePaymentEvidence(m, order, args.slice(2).join(' '));
      let result;
      try {
        result = await attachPaymentEvidence(orderId, sender, stored.record, stored.note);
      } catch (error) {
        await fs.unlink(stored.absolutePath).catch(() => {});
        throw error;
      }
      try {
        await sock.sendMessage(OWNER_JID(), { image: stored.buffer, mimetype: stored.record.mimetype, caption: `*BUKTI PEMBAYARAN SEWA*\nInvoice: ${result.order.id}\nGrup: ${result.order.groupName}\nPaket: ${result.order.planName}\nNominal: ${formatRupiah(result.order.amount)}\nMetode: ${result.order.paymentMethod}\nPengirim: ${sender}\nUkuran: ${(stored.record.size / 1024).toFixed(1)} KB\n\nPeriksa mutasi/merchant dashboard sebelum menyetujui.` });
      } catch (error) {
        try { await notifyOwnerPayment(sock, result.order, sender, 'BUKTI PEMBAYARAN TERSIMPAN · NOTIFIKASI GAMBAR GAGAL'); } catch {}
      }
      return m.reply(`*BUKTI PEMBAYARAN DITERIMA*\nInvoice: ${result.order.id}\nFile: ${(stored.record.size / 1024).toFixed(1)} KB\nStatus: MENUNGGU VERIFIKASI OWNER\n\nBukti telah dikirim secara pribadi untuk pemeriksaan. Screenshot tidak langsung mengaktifkan layanan; aktivasi menunggu verifikasi dana masuk.`);
    }

    if (action === 'cancel' || action === 'batal') {
      const orderId = args[1];
      if (!orderId) return m.reply('Format: .sewa cancel <invoice>');
      const order = await getOrder(orderId);
      if (!order || order.groupJid !== groupJid) return m.reply('Invoice tidak ditemukan untuk grup yang sedang dipilih.');
      const cancelled = await cancelOrder(orderId, sender);
      return m.reply(`Invoice ${cancelled.id} berhasil dibatalkan. Untuk memilih paket lain, ketik .sewa plan <paket>.`);
    }

    return m.reply('Perintah tidak dikenal. Ketik .sewa help untuk panduan lengkap.');
  }
};
