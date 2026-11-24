import { listWebsiteOrders, reviewWebsiteOrder } from '../../rental/website-verification.js';
export default {
  name: 'webverify', aliases: ['websiteverify'], category: 'owner', ownerOnly: true, privateOnly: true,
  usage: '[list|approve <invoice>|reject <invoice> <alasan>]',
  description: 'Verifikasi pembayaran centang biru dan hak satu slot website',
  async execute({ m, args }) {
    const [action = 'list', invoice, ...rest] = args;
    if (action === 'list') {
      const orders = (await listWebsiteOrders()).filter(order => ['pending', 'reported'].includes(order.status));
      return m.reply(orders.length ? `WEBSITE VERIFICATION QUEUE\n${orders.map(order => `${order.id} · ${order.status.toUpperCase()}\nPemohon: ${order.ownerJid}\nNominal: Rp${Number(order.amount).toLocaleString('id-ID')}\nDibuat: ${order.createdAt}`).join('\n\n')}` : 'Tidak ada invoice verifikasi website yang menunggu.');
    }
    if (!invoice || !['approve', 'reject'].includes(action)) return m.reply('Format: .webverify list | .webverify approve <invoice> | .webverify reject <invoice> <alasan>');
    const order = await reviewWebsiteOrder(invoice, m.sender, action, rest.join(' '));
    return m.reply(action === 'approve' ? `VERIFIKASI WEBSITE DISETUJUI\nInvoice: ${order.id}\nPemohon: ${order.ownerJid}\nBadge: Blue Check ✓\nSlot website: 1 (satu kali)\nPart 2 akan menyediakan editor dan template.` : `Verifikasi ${order.id} ditolak. Alasan: ${order.rejectionReason}`);
  }
};
