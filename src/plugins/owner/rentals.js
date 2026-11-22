import { getPlans, listTenants, listOrders, getTenantStatus, getQuotaStatus, approvePayment, rejectOrder, suspendTenant, activateTenantManually, extendTenant, updatePlan, rentalSummary } from '../../rental/service.js';
import { listRecords } from '../../core/repository.js';
import { getRentalSchedulerStatus } from '../../rental/runtime.js';
import { formatRupiah, normalizePlanId } from '../../rental/catalog.js';
const wib = value => new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) + ' WIB';

export default {
  name: 'rentals', aliases: ['rentaladmin', 'sewaadmin'], category: 'owner', ownerOnly: true, privateOnly: true,
  usage: '<status|list|pending|usage|audit|show|approve|reject|suspend|activate|extend|setprice|setquota|plans>',
  description: 'Administrasi tenant sewa, pembayaran, paket, kuota dan masa aktif',
  async execute({ sock, m, args }) {
    const action = String(args[0] || 'status').toLowerCase();
    if (action === 'status' || action === 'stats') {
      const stats = await rentalSummary();
      const scheduler = getRentalSchedulerStatus();
      return m.reply(`*RENTAL MANAGEMENT*\nTenant: ${stats.tenants}\nAktif: ${stats.active}\nGrace: ${stats.grace}\nSuspended: ${stats.suspended}\nOrder menunggu: ${stats.pendingOrders}\nOrder disetujui: ${stats.approvedOrders}\nPendapatan terverifikasi: ${formatRupiah(stats.revenueApproved)}\n\n*AUTONOMOUS SCHEDULER*\nStatus: ${scheduler.active ? 'ACTIVE' : 'STOPPED'}\nLast run: ${scheduler.lastRunAt ? wib(scheduler.lastRunAt) : 'Belum ada'}\nLast error: ${scheduler.lastError || '-'}`);
    }
    if (action === 'plans' || action === 'paket') {
      const plans = await getPlans();
      return m.reply(`*RENTAL PACKAGES*\n${Object.values(plans).map(p => `${p.id.toUpperCase()} · ${p.name}\nHarga: ${formatRupiah(p.price)} / ${p.durationDays} hari\nKuota: ${p.dailyQuota} unit / 24 jam\nGrace: ${p.graceHours} jam`).join('\n\n')}\n\nAtur: .rentals setprice <plan> <nominal>\nAtur kuota: .rentals setquota <plan> <unit>`);
    }
    if (action === 'setprice' || action === 'setquota') {
      const planId = normalizePlanId(args[1]);
      const value = Number(args[2]);
      if (!planId || !Number.isSafeInteger(value)) return m.reply(`Format: .rentals ${action} <mini|standard|pro> <angka>`);
      const patch = action === 'setprice' ? { price: value } : { dailyQuota: value };
      const plan = await updatePlan(planId, patch, m.sender);
      return m.reply(`Paket ${plan.name} diperbarui.\nHarga: ${formatRupiah(plan.price)}\nKuota: ${plan.dailyQuota} unit / 24 jam.`);
    }
    if (action === 'list' || action === 'tenant') {
      const tenants = await listTenants();
      if (!tenants.length) return m.reply('Belum ada tenant sewa.');
      const lines = [];
      for (const tenant of tenants.slice(0, 60)) {
        const status = await getTenantStatus(tenant.groupJid);
        const quota = await getQuotaStatus(tenant.groupJid);
        lines.push(`${tenant.groupName}\n${tenant.groupJid}\n${tenant.planName} · ${status.status.toUpperCase()}\nExpiry: ${wib(tenant.expiresAt)} · Kuota: ${quota.used}/${quota.limit}`);
      }
      return m.reply(`*DAFTAR TENANT (${tenants.length})*\n\n${lines.join('\n\n')}`);
    }
    if (action === 'pending' || action === 'orders') {
      const orders = await listOrders();
      const pending = orders.filter(order => ['pending', 'payment_reported'].includes(order.status)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
      if (!pending.length) return m.reply('Tidak ada invoice yang menunggu.');
      return m.reply(`*PENDING RENTAL ORDERS*\n${pending.map(order => `${order.id} · ${order.status.toUpperCase()}\n${order.groupName}\n${order.planName} · ${formatRupiah(order.amount)}\nMetode: ${order.paymentMethod || '-'}\nBatas: ${wib(order.expiresAt)}`).join('\n\n')}`);
    }
    if (action === 'usage' || action === 'kuota') {
      const jid = args[1];
      if (!jid) return m.reply('Format: .rentals usage <group-jid>');
      const tenantStatus = await getTenantStatus(jid);
      if (!tenantStatus.tenant) return m.reply('Tenant tidak ditemukan.');
      const quota = await getQuotaStatus(jid);
      const top = Object.entries(quota.breakdown || {}).sort((a, b) => b[1] - a[1]).slice(0, 15);
      return m.reply(`*RENTAL QUOTA DETAIL*\n${tenantStatus.tenant.groupName}\nStatus: ${tenantStatus.status.toUpperCase()}\nPaket: ${tenantStatus.tenant.planName}\nTerpakai: ${quota.used}/${quota.limit} unit\nSisa: ${quota.remaining} unit\nReset: ${wib(quota.resetAt)}\n\n*Penggunaan per command*\n${top.length ? top.map(([name, cost]) => `• ${name}: ${cost} unit`).join('\n') : 'Belum ada penggunaan pada periode ini.'}`);
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
      return m.reply(`*ORDER DETAIL*\nID: ${order.id}\nGrup: ${order.groupName}\nJID: ${order.groupJid}\nPemesan: ${order.requestedBy}\nPaket: ${order.planName}\nNominal: ${formatRupiah(order.amount)}\nStatus: ${order.status}\nMetode: ${order.paymentMethod || '-'}\nDibuat: ${wib(order.createdAt)}\nExpired: ${wib(order.expiresAt)}\nLaporan bayar: ${order.paymentReportedAt ? wib(order.paymentReportedAt) : '-'}\nCatatan: ${order.paymentNote || '-'}`);
    }
    if (action === 'approve' || action === 'confirm') {
      const id = args[1];
      if (!id) return m.reply('Format: .rentals approve <order-id>');
      const result = await approvePayment(id, m.sender);
      if (!result.reused) {
        try { await sock.sendMessage(result.tenant.groupJid, { text: `*PEMBAYARAN TERVERIFIKASI · SEWA AKTIF*\nPaket: ${result.tenant.planName}\nAktif sampai: ${wib(result.tenant.expiresAt)}\nKuota: ${result.tenant.dailyQuota} unit / 24 jam\nSemua command kini tersedia sesuai kuota grup.` }); } catch {}
      }
      return m.reply(`Order ${result.order.id} ${result.reused ? 'sudah pernah' : 'berhasil'} disetujui.\nTenant: ${result.tenant.groupName}\nExpiry: ${wib(result.tenant.expiresAt)}\nGroup mute override: ACTIVE.`);
    }
    if (action === 'reject') {
      const id = args[1];
      if (!id) return m.reply('Format: .rentals reject <order-id> [alasan]');
      const order = await rejectOrder(id, m.sender, args.slice(2).join(' ') || 'Pembayaran belum dapat diverifikasi.');
      try { await sock.sendMessage(order.groupJid, { text: `Invoice ${order.id} belum dapat disetujui. Alasan: ${order.rejectionReason}\nHubungi owner untuk tindak lanjut.` }); } catch {}
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
    return m.reply('RENTAL OWNER CONSOLE\n.rentals status\n.rentals plans\n.rentals list\n.rentals pending\n.rentals usage <group-jid>\n.rentals audit [group-jid|order-id]\n.rentals show <order-id>\n.rentals approve <order-id>\n.rentals reject <order-id> [alasan]\n.rentals suspend <group-jid> [alasan]\n.rentals activate <group-jid> [hari]\n.rentals extend <group-jid> [hari]\n.rentals setprice <plan> <nominal>\n.rentals setquota <plan> <unit>');
  }
};
