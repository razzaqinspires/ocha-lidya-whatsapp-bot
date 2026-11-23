import { getPlans, listTenants, listOrders, getTenantStatus, getQuotaStatus, approvePayment, rejectOrder, suspendTenant, activateTenantManually, extendTenant, updatePlan, rentalSummary, listRentalSupportTickets, getRentalSupportTicket, updateRentalSupportTicket } from '../../rental/service.js';
import { listRecords } from '../../core/repository.js';
import { getRentalSchedulerStatus } from '../../rental/runtime.js';
import { formatRupiah, normalizePlanId } from '../../rental/catalog.js';
const wib = value => new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) + ' WIB';

export default {
  name: 'rentals', aliases: ['rentaladmin', 'sewaadmin'], category: 'owner', ownerOnly: true, privateOnly: true,
  usage: '<status|list|pending|usage|audit|show|approve|reject|suspend|activate|extend|setprice|setquota|setmembers|plans|support|reply|close>',
  description: 'Administrasi tenant sewa, pembayaran, paket, kuota dan masa aktif',
  async execute({ sock, m, args }) {
    const action = String(args[0] || 'status').toLowerCase();
    if (action === 'support' || action === 'tickets') {
      const filter = String(args[1] || 'open').toLowerCase();
      if (!['open', 'answered', 'closed', 'all'].includes(filter)) return m.reply('Format: .rentals support [open|answered|closed|all]');
      const result = await listRentalSupportTickets({ status: filter, limit: 30 });
      if (!result.tickets.length) return m.reply(`Tidak ada tiket dukungan dengan status ${filter}.`);
      return m.reply(`*TIKET DUKUNGAN · ${filter.toUpperCase()}*\nTotal: ${result.total}\n\n${result.tickets.map(ticket => `${ticket.id} · ${ticket.status.toUpperCase()}\n${ticket.category.toUpperCase()} · ${ticket.groupName}\n${ticket.requesterName} · ${wib(ticket.createdAt)}\n${String(ticket.message || '').slice(0, 260)}${String(ticket.message || '').length > 260 ? '…' : ''}`).join('\n\n')}\n\nBalas: .rentals reply <ticket-id> <pesan>\nTutup: .rentals close <ticket-id> [catatan]`);
    }
    if (action === 'reply') {
      const ticketId = String(args[1] || '').toUpperCase();
      const response = args.slice(2).join(' ').trim();
      if (!ticketId || response.length < 3) return m.reply('Format: .rentals reply <ticket-id> <pesan balasan>');
      const ticket = await getRentalSupportTicket(ticketId);
      if (!ticket) return m.reply('Tiket dukungan tidak ditemukan.');
      if (ticket.status === 'closed') return m.reply('Tiket sudah ditutup. Gunakan tiket baru bila pelanggan mengirim kendala lanjutan.');
      if (!/^\d{8,15}@s\.whatsapp\.net$/.test(String(ticket.requesterJid || ''))) return m.reply('Identitas pelanggan pada tiket tidak valid. Balasan dibatalkan.');
      await sock.sendMessage(ticket.requesterJid, { text: `*BALASAN RAZZAQ VENTURES · ${ticket.id}*\nGrup: ${ticket.groupName}\n\n${response.slice(0, 1500)}\n\nBila masalah belum selesai, balas melalui .sewa masukan <pesan> di chat pribadi bot.` });
      const updated = await updateRentalSupportTicket(ticketId, { status: 'answered', response }, m.sender);
      return m.reply(`Balasan berhasil dikirim ke pelanggan.\nTiket: ${updated.id}\nStatus: ANSWERED.`);
    }
    if (action === 'close') {
      const ticketId = String(args[1] || '').toUpperCase();
      const note = args.slice(2).join(' ').trim();
      if (!ticketId) return m.reply('Format: .rentals close <ticket-id> [catatan]');
      const ticket = await getRentalSupportTicket(ticketId);
      if (!ticket) return m.reply('Tiket dukungan tidak ditemukan.');
      const updated = await updateRentalSupportTicket(ticketId, { status: 'closed', response: note || 'Tiket dinyatakan selesai oleh tim dukungan.' }, m.sender);
      try { await sock.sendMessage(ticket.requesterJid, { text: `*TIKET DUKUNGAN DITUTUP · ${ticket.id}*\nGrup: ${ticket.groupName}\nCatatan: ${note || 'Tiket dinyatakan selesai oleh tim dukungan.'}\n\nTerima kasih telah menggunakan layanan Razzaq Ventures. Bila ada kendala baru, buat tiket baru melalui .sewa masukan <pesan>.` }); } catch {}
      return m.reply(`Tiket ${updated.id} ditutup.`);
    }
    if (action === 'status' || action === 'stats') {
      const stats = await rentalSummary();
      const scheduler = getRentalSchedulerStatus();
      return m.reply(`*RENTAL MANAGEMENT*\nTenant: ${stats.tenants}\nAktif: ${stats.active}\nGrace: ${stats.grace}\nSuspended: ${stats.suspended}\nOrder menunggu: ${stats.pendingOrders}\nOrder disetujui: ${stats.approvedOrders}\nPendapatan terverifikasi: ${formatRupiah(stats.revenueApproved)}\n\n*AUTONOMOUS SCHEDULER*\nStatus: ${scheduler.active ? 'ACTIVE' : 'STOPPED'}\nLast run: ${scheduler.lastRunAt ? wib(scheduler.lastRunAt) : 'Belum ada'}\nLast error: ${scheduler.lastError || '-'}`);
    }
    if (action === 'plans' || action === 'paket') {
      const plans = await getPlans();
      return m.reply(`*RENTAL PACKAGES*\n${Object.values(plans).map(p => `${p.id.toUpperCase()} · ${p.name}\nHarga: ${formatRupiah(p.price)} / ${p.durationDays} hari\nKuota bersama: ${p.dailyQuota} unit / 24 jam\nBatas anggota: ${Number(p.maxMembers || 0).toLocaleString('id-ID')}\nGrace: ${p.graceHours} jam`).join('\n\n')}\n\nAtur harga: .rentals setprice <plan> <nominal>\nAtur kuota: .rentals setquota <plan> <unit>\nAtur anggota: .rentals setmembers <plan> <jumlah>`);
    }
    if (['setprice', 'setquota', 'setmembers'].includes(action)) {
      const planId = normalizePlanId(args[1]);
      const value = Number(args[2]);
      if (!planId || !Number.isSafeInteger(value)) return m.reply(`Format: .rentals ${action} <mini|standard|pro> <angka>`);
      const patch = action === 'setprice' ? { price: value } : action === 'setquota' ? { dailyQuota: value } : { maxMembers: value };
      const plan = await updatePlan(planId, patch, m.sender);
      return m.reply(`Paket ${plan.name} diperbarui.\nHarga: ${formatRupiah(plan.price)}\nKuota: ${plan.dailyQuota} unit / 24 jam\nBatas anggota: ${Number(plan.maxMembers).toLocaleString('id-ID')}.`);
    }
    if (action === 'list' || action === 'tenant') {
      const tenants = await listTenants();
      if (!tenants.length) return m.reply('Belum ada tenant sewa.');
      const lines = [];
      for (const tenant of tenants.slice(0, 60)) {
        const status = await getTenantStatus(tenant.groupJid);
        const quota = await getQuotaStatus(tenant.groupJid);
        lines.push(`${tenant.groupName}\n${tenant.groupJid}\n${tenant.planName} · ${status.status.toUpperCase()}\nAnggota: ${Number(status.memberCount || 0)}/${Number(status.memberLimit || 0)}\nExpiry: ${wib(tenant.expiresAt)} · Kuota: ${quota.used}/${quota.limit}`);
      }
      return m.reply(`*DAFTAR TENANT (${tenants.length})*\n\n${lines.join('\n\n')}`);
    }
    if (action === 'pending' || action === 'orders') {
      const orders = await listOrders();
      const pending = orders.filter(order => ['pending', 'payment_reported'].includes(order.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
      if (!pending.length) return m.reply('Tidak ada invoice yang menunggu.');
      return m.reply(`*PENDING RENTAL ORDERS*\n${pending.map(order => `${order.id} · ${order.status.toUpperCase()}\n${order.groupName}\n${order.planName} · ${formatRupiah(order.amount)}\nMetode: ${order.paymentMethod || '-'} · Bukti: ${(order.paymentEvidence || []).length}\nBatas: ${wib(order.expiresAt)}`).join('\n\n')}`);
    }
    if (action === 'usage' || action === 'kuota') {
      const jid = args[1];
      if (!jid) return m.reply('Format: .rentals usage <group-jid>');
      const tenantStatus = await getTenantStatus(jid);
      if (!tenantStatus.tenant) return m.reply('Tenant tidak ditemukan.');
      const quota = await getQuotaStatus(jid);
      const top = Object.entries(quota.breakdown || {}).sort((a, b) => b[1] - a[1]).slice(0, 15);
      return m.reply(`*RENTAL QUOTA DETAIL*\n${tenantStatus.tenant.groupName}\nStatus: ${tenantStatus.status.toUpperCase()}\nPaket: ${tenantStatus.tenant.planName}\nAnggota: ${Number(tenantStatus.memberCount || 0)}/${Number(tenantStatus.memberLimit || 0)}\nTerpakai: ${quota.used}/${quota.limit} unit\nSisa: ${quota.remaining} unit\nReset: ${wib(quota.resetAt)}\n\n*Penggunaan per command*\n${top.length ? top.map(([name, cost]) => `• ${name}: ${cost} unit`).join('\n') : 'Belum ada penggunaan pada periode ini.'}`);
    }
    if (action === 'audit' || action === 'log') {
      const filter = String(args[1] || '').toLowerCase();
      const entries = Object.values(await listRecords('rental.audit')).filter(item => !filter || String(item.groupJid || '').toLowerCase().includes(filter) || String(item.orderId || '').toLowerCase().includes(filter)).sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 30);
      if (!entries.length) return m.reply('Belum ada audit event yang cocok.');
      return m.reply(`*RENTAL AUDIT · ${entries.length} EVENT*\n\n${entries.map(item => `${item.action}\n${item.groupJid || item.orderId || '-'}\n${item.actor || item.source || '-'} · ${item.at ? wib(item.at) : '-'}`).join('\n\n')}`);
    }
    if (action === 'show' || action === 'order') {
      const id = args[1];
      if (!id) return m.reply('Format: .rentals show <order-id>');
      const order = (await listOrders()).find(item => item.id.toLowerCase() === id.toLowerCase());
      if (!order) return m.reply('Order tidak ditemukan.');
      const evidence = (order.paymentEvidence || []).map((item, index) => `${index + 1}. ${item.mimetype || 'image'} · ${(Number(item.size || 0) / 1024).toFixed(1)} KB · ${item.relativePath}`).join('\n') || 'Belum ada';
      return m.reply(`*ORDER DETAIL*\nID: ${order.id}\nGrup: ${order.groupName}\nJID: ${order.groupJid}\nPemesan: ${order.requestedBy}\nPaket: ${order.planName}\nNominal: ${formatRupiah(order.amount)}\nBatas anggota: ${Number(order.maxMembers || 0).toLocaleString('id-ID')}\nStatus: ${order.status}\nMetode: ${order.paymentMethod || '-'}\nDibuat: ${wib(order.createdAt)}\nExpired: ${wib(order.expiresAt)}\nLaporan bayar: ${order.paymentReportedAt ? wib(order.paymentReportedAt) : '-'}\nCatatan: ${order.paymentNote || '-'}\n\n*BUKTI PEMBAYARAN*\n${evidence}\n\nBuka gambar bukti dari pesan masuk pribadi owner.`);
    }
    if (action === 'approve' || action === 'confirm') {
      const id = args[1];
      if (!id) return m.reply('Format: .rentals approve <order-id>');
      const result = await approvePayment(id, m.sender);
      if (!result.reused) {
        try { await sock.sendMessage(result.tenant.groupJid, { text: `*PEMBAYARAN TERVERIFIKASI · SEWA AKTIF*\nPaket: ${result.tenant.planName}\nAktif sampai: ${wib(result.tenant.expiresAt)}\nKuota bersama: ${result.tenant.dailyQuota} unit / 24 jam\nBatas anggota: ${Number(result.tenant.maxMembers || 0).toLocaleString('id-ID')}\nSeluruh anggota dapat menggunakan fitur bot sesuai kuota grup.` }); } catch {}
        if (result.order.requestedBy?.endsWith('@s.whatsapp.net')) {
          try { await sock.sendMessage(result.order.requestedBy, { text: `Pembayaran invoice ${result.order.id} telah diverifikasi. Sewa grup *${result.tenant.groupName}* aktif sampai ${wib(result.tenant.expiresAt)}. Paket ${result.tenant.planName}, maksimal ${Number(result.tenant.maxMembers || 0).toLocaleString('id-ID')} anggota dan kuota bersama ${result.tenant.dailyQuota} unit/24 jam.\n\nSetelah mencoba layanan, silakan sampaikan penilaian yang jujur melalui .sewa ulasan <1-5> [komentar]. Ulasan hanya dihitung satu kali untuk invoice ini.` }); } catch {}
        }
      }
      return m.reply(`Order ${result.order.id} ${result.reused ? 'sudah pernah' : 'berhasil'} disetujui.\nTenant: ${result.tenant.groupName}\nExpiry: ${wib(result.tenant.expiresAt)}\nBatas anggota: ${Number(result.tenant.maxMembers || 0).toLocaleString('id-ID')}\nGroup mute override: ACTIVE.`);
    }
    if (action === 'reject') {
      const id = args[1];
      if (!id) return m.reply('Format: .rentals reject <order-id> [alasan]');
      const order = await rejectOrder(id, m.sender, args.slice(2).join(' ') || 'Pembayaran belum dapat diverifikasi.');
      if (order.requestedBy?.endsWith('@s.whatsapp.net')) {
        try { await sock.sendMessage(order.requestedBy, { text: `Invoice ${order.id} belum dapat disetujui. Alasan: ${order.rejectionReason}\nSilakan hubungi owner dengan menyebutkan ID invoice tersebut.` }); } catch {}
      }
      return m.reply(`Order ${order.id} ditolak. Status tidak mengaktifkan layanan.`);
    }
    if (action === 'suspend') {
      const jid = args[1];
      if (!jid) return m.reply('Format: .rentals suspend <group-jid> [alasan]');
      const tenant = await suspendTenant(jid, m.sender, args.slice(2).join(' ') || 'Suspended by owner');
      return m.reply(`Tenant ${tenant.groupName} ditangguhkan dan grup di-mute.`);
    }
    if (action === 'activate') {
      const jid = args[1];
      if (!jid) return m.reply('Format: .rentals activate <group-jid> [hari]');
      const tenant = await activateTenantManually(jid, m.sender, Number(args[2]) || 30);
      return m.reply(`Tenant ${tenant.groupName} diaktifkan manual sampai ${wib(tenant.expiresAt)}.`);
    }
    if (action === 'extend') {
      const jid = args[1];
      if (!jid) return m.reply('Format: .rentals extend <group-jid> [hari]');
      const tenant = await extendTenant(jid, m.sender, Number(args[2]) || 30, m.key?.id || m.message?.key?.id || '');
      return m.reply(`Masa sewa ${tenant.groupName} diperpanjang sampai ${wib(tenant.expiresAt)}.`);
    }
    return m.reply('RENTAL OWNER CONSOLE\n.rentals status\n.rentals plans\n.rentals support [open|answered|closed|all]\n.rentals reply <ticket-id> <pesan>\n.rentals close <ticket-id> [catatan]\n.rentals list\n.rentals pending\n.rentals usage <group-jid>\n.rentals audit [group-jid|order-id]\n.rentals show <order-id>\n.rentals approve <order-id>\n.rentals reject <order-id> [alasan]\n.rentals suspend <group-jid> [alasan]\n.rentals activate <group-jid> [hari]\n.rentals extend <group-jid> [hari]\n.rentals setprice <plan> <nominal>\n.rentals setquota <plan> <unit>\n.rentals setmembers <plan> <jumlah>');
  }
};
