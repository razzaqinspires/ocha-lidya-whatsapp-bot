import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../../core/config.js';
import { getGroupMetadata } from '../../core/group-metadata.js';
import { getQuotaStatus, getTenantStatus, createRentalOrder, setOrderPaymentMethod, reportPayment, cancelOrder, getOrder, getPlans } from '../../rental/service.js';
import { PAYMENT_METHODS, normalizePaymentMethod } from '../../rental/payment-methods.js';
import { formatRupiah } from '../../rental/catalog.js';

const QRIS_PATH = fileURLToPath(new URL('../../../assets/payments/qris-razzaq-ventures.jpg', import.meta.url));
const OWNER_JID = () => `${getConfig().bot.owner}@s.whatsapp.net`;
const dateWib = value => new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) + ' WIB';
const prettyDuration = ms => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days ? `${days} hari` : '', hours ? `${hours} jam` : '', minutes ? `${minutes} menit` : ''].filter(Boolean).join(' ') || `${seconds} detik`;
};
function participantMatches(participant, sender) {
  const normalized = String(sender || '').replace(/:\d+(?=@)/, '');
  return [participant?.id, participant?.phoneNumber, participant?.lid].filter(Boolean).some(value => String(value).replace(/:\d+(?=@)/, '') === normalized);
}
function isGroupAdmin(message) {
  if (message.isOwner) return true;
  const meta = getGroupMetadata(message.chat);
  if (!meta) return false;
  const directOwner = [meta.owner, meta.ownerPn].filter(Boolean).some(value => String(value).replace(/:\d+(?=@)/, '') === message.sender);
  if (directOwner) return true;
  return (meta.participants || []).some(participant => participantMatches(participant, message.sender) && ['admin', 'superadmin', true].includes(participant.admin));
}
function requireGroup(message) {
  if (!message.isGroup) throw new Error('Jalankan perintah sewa di dalam grup WhatsApp yang ingin disewakan.');
  if (!isGroupAdmin(message)) throw new Error('Pemesanan sewa hanya dapat dibuat owner bot atau admin grup. Metadata admin belum dapat diverifikasi; coba lagi setelah sinkronisasi grup selesai.');
}
async function sendPlans(sock, message) {
  const plans = await getPlans();
  const rows = Object.values(plans).map(plan => ({
    id: `.sewa plan ${plan.id}`,
    title: `${plan.name} · ${formatRupiah(plan.price)}`.slice(0, 24),
    description: `${plan.dailyQuota.toLocaleString('id-ID')} unit / 24 jam · ${plan.durationDays} hari`.slice(0, 72)
  }));
  const body = `Pilih paket untuk grup ini. Semua command tersedia selama langganan aktif; penggunaan dihitung dengan bobot workload dan kuota dipakai bersama seluruh anggota grup.\n\n${Object.values(plans).map(p => `• *${p.name}* — ${formatRupiah(p.price)} / ${p.durationDays} hari · ${p.dailyQuota.toLocaleString('id-ID')} unit / 24 jam`).join('\n')}\n\nPembayaran QRIS statis atau transfer diverifikasi manual oleh owner.`;
  if (typeof sock.sendInteractive === 'function') {
    return sock.sendInteractive(message.chat, {
      title: 'OCHA LIDYA · PILIH PAKET',
      subtitle: 'Rental WhatsApp Bot · Razzaq Ventures',
      body,
      footer: 'Kuota reset setiap 24 jam sejak aktivasi.',
      buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: 'Lihat paket sewa', sections: [{ title: 'Paket 30 hari', rows }] }) }]
    }, message);
  }
  return message.reply(body + `\n\nPilih dengan mengetik .sewa plan mini|standard|pro`);
}
async function sendPaymentMenu(sock, message, order) {
  const methods = [
    ['qris', 'QRIS', 'Scan kode QRIS merchant Razzaq Ventures'],
    ['ovo', 'OVO', 'Transfer ke nomor e-wallet'],
    ['gopay', 'GoPay', 'Transfer ke nomor e-wallet'],
    ['dana', 'DANA', 'Transfer ke nomor e-wallet'],
    ['seabank', 'SeaBank', 'Transfer rekening SeaBank']
  ];
  const body = `*INVOICE ${order.id}*\nGrup: ${order.groupName}\nPaket: ${order.planName}\nTotal: *${formatRupiah(order.amount)}*\nBatas pembayaran: ${dateWib(order.expiresAt)}\n\nPilih metode pembayaran. Layanan aktif setelah pembayaran diverifikasi owner.`;
  if (typeof sock.sendInteractive === 'function') {
    return sock.sendInteractive(message.chat, {
      title: 'PILIH METODE PEMBAYARAN', body, footer: 'Jangan pernah membagikan PIN atau OTP.',
      buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: 'Metode pembayaran', sections: [{ title: 'Pembayaran tersedia', rows: methods.map(([id, title, description]) => ({ id: `.sewa pay ${order.id} ${id}`, title, description })) }] }) }]
    }, message);
  }
  return message.reply(body + `\n\n${methods.map(([id, name]) => `.sewa pay ${order.id} ${id}`).join('\n')}`);
}
async function sendPaymentDetails(sock, message, order, methodId) {
  const method = PAYMENT_METHODS[methodId];
  const safeHeader = `*OCHA LIDYA · PEMBAYARAN*\nInvoice: ${order.id}\nPaket: ${order.planName}\nNominal: *${formatRupiah(order.amount)}*\nPenerima: ${method.receiver || 'RAZZAQ VENTURES'}`;
  if (method.kind === 'static-qris') {
    const image = await fs.readFile(QRIS_PATH);
    await sock.sendMessage(message.chat, { image, caption: `${safeHeader}\n\nScan QRIS Razzaq Ventures dan masukkan nominal persis seperti invoice. QRIS ini statis; pembayaran tidak terverifikasi otomatis. Simpan referensi invoice ${order.id}.` }, { quoted: message });
    if (typeof sock.sendInteractive === 'function') {
      return sock.sendInteractive(message.chat, { body: 'Setelah transfer berhasil, laporkan pembayaran untuk pemeriksaan owner.', footer: 'Screenshot saja bukan bukti final pembayaran.', buttons: [{ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Saya sudah membayar', id: `.sewa paid ${order.id}` }) }, { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: 'Salin ID Invoice', copy_code: order.id }) }] }, message);
    }
    return message.reply(`Setelah membayar, ketik .sewa paid ${order.id}`);
  }
  const account = method.account;
  const details = `${safeHeader}\nMetode: ${method.name}\nNomor rekening/e-wallet: *${account}*\nNama penerima: *${method.receiver}*\n\nTransfer sesuai nominal invoice. Setelah berhasil, pilih tombol konfirmasi atau ketik .sewa paid ${order.id}.`;
  if (typeof sock.sendInteractive === 'function') {
    return sock.sendInteractive(message.chat, { title: `${method.name} · INVOICE`, body: details, footer: 'Pastikan nama penerima benar sebelum transfer.', buttons: [{ name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: `Salin ${method.name}`, copy_code: account }) }, { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Saya sudah membayar', id: `.sewa paid ${order.id}` }) }] }, message);
  }
  return message.reply(details);
}

export default {
  name: 'sewa', aliases: ['rent', 'paketsewa'], category: 'general',
  usage: '[status|plan <mini|standard|pro>|pay <order-id> <metode>|paid <order-id>|cancel <order-id>]',
  description: 'Paket sewa bot, invoice, pembayaran, kuota dan masa aktif per grup',
  async execute({ sock, m, args }) {
    const action = String(args[0] || 'packages').toLowerCase();
    if (action === 'packages' || action === 'paket' || action === 'list') return sendPlans(sock, m);
    if (action === 'status' || action === 'cek') {
      if (!m.isGroup) return m.reply('Status sewa grup dibuka dari dalam grup: .sewa status');
      const status = await getTenantStatus(m.chat);
      if (!status.tenant) return m.reply('Grup ini belum memiliki langganan. Gunakan .sewa untuk melihat paket.');
      const quota = await getQuotaStatus(m.chat);
      const tenant = status.tenant;
      return m.reply(`*STATUS SEWA OCHA LIDYA*\nGrup: ${tenant.groupName}\nPaket: ${tenant.planName}\nStatus: ${status.status.toUpperCase()}\nMasa aktif sampai: ${dateWib(tenant.expiresAt)}\nSisa masa aktif: ${prettyDuration(status.remainingMs)}\n${status.status === 'grace' ? `Masa tenggang tersisa: ${prettyDuration(status.graceRemainingMs)}\n` : ''}Kuota 24 jam: ${quota.used}/${quota.limit} unit\nSisa kuota: ${quota.remaining} unit\nReset kuota: ${dateWib(quota.resetAt)}\nHitung mundur reset: ${prettyDuration(quota.remainingMs)}\n\nPerpanjang: .sewa`);
    }
    if (action === 'plan' || action === 'paketkan') {
      requireGroup(m);
      const planId = String(args[1] || '').toLowerCase();
      if (!planId) return sendPlans(sock, m);
      const result = await createRentalOrder({ groupJid: m.chat, requestedBy: m.sender, groupName: getGroupMetadata(m.chat)?.subject || m.chat, planId });
      await sendPaymentMenu(sock, m, result.order);
      return undefined;
    }
    if (action === 'pay' || action === 'bayar') {
      requireGroup(m);
      const orderId = args[1];
      const methodId = normalizePaymentMethod(args[2]);
      if (!orderId || !methodId) return m.reply('Format: .sewa pay <order-id> <qris|ovo|gopay|dana|seabank>');
      const order = await getOrder(orderId);
      if (!order || order.groupJid !== m.chat) return m.reply('Invoice tidak ditemukan untuk grup ini.');
      const updated = await setOrderPaymentMethod(orderId, methodId, m.sender);
      return sendPaymentDetails(sock, m, updated, methodId);
    }
    if (action === 'paid' || action === 'sudah') {
      requireGroup(m);
      const orderId = args[1];
      if (!orderId) return m.reply('Format: .sewa paid <order-id>');
      const order = await getOrder(orderId);
      if (!order || order.groupJid !== m.chat) return m.reply('Invoice tidak ditemukan untuk grup ini.');
      const result = await reportPayment(orderId, m.sender);
      await m.reply(`*PEMBAYARAN DILAPORKAN*\nInvoice: ${result.order.id}\nNominal: ${formatRupiah(result.order.amount)}\nStatus: MENUNGGU VERIFIKASI OWNER\n\nLaporan pembayaran sudah diteruskan untuk pemeriksaan. Bot belum diaktifkan sampai transaksi benar-benar terlihat pada akun penerima.`);
      if (!result.reused) try {
        await sock.sendMessage(OWNER_JID(), { text: `*PEMBAYARAN SEWA PERLU DIVERIFIKASI*\nInvoice: ${result.order.id}\nGrup: ${result.order.groupName}\nGroup JID: ${result.order.groupJid}\nPaket: ${result.order.planName}\nNominal: ${formatRupiah(result.order.amount)}\nMetode: ${result.order.paymentMethod}\nPelapor: ${m.sender}\nWaktu: ${dateWib(result.order.paymentReportedAt)}\n\nPeriksa mutasi/merchant dashboard, lalu gunakan .rentals approve ${result.order.id} atau .rentals reject ${result.order.id} alasan` });
      } catch {}
      return undefined;
    }
    if (action === 'cancel' || action === 'batal') {
      requireGroup(m);
      const orderId = args[1];
      if (!orderId) return m.reply('Format: .sewa cancel <order-id>');
      const order = await getOrder(orderId);
      if (!order || order.groupJid !== m.chat || (!m.isOwner && order.requestedBy !== m.sender && !isGroupAdmin(m))) return m.reply('Order tidak ditemukan atau Anda tidak berhak membatalkannya.');
      const cancelled = await cancelOrder(orderId, m.sender);
      return m.reply(`Invoice ${cancelled.id} dibatalkan.`);
    }
    return m.reply('RENTAL OCHA LIDYA\n.sewa — katalog paket\n.sewa status — status langganan dan kuota\n.sewa plan <mini|standard|pro> — buat invoice\n.sewa pay <order-id> <metode> — pilih pembayaran\n.sewa paid <order-id> — laporkan pembayaran\n.sewa cancel <order-id> — batalkan invoice\n\nPemesanan dilakukan oleh owner atau admin grup. Aktivasi menunggu verifikasi manual.');
  }
};
