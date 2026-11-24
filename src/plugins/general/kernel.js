import { buildPublicKernelSnapshot, publishKernelDashboard } from '../../runtime/kernel-dashboard.js';

const count = value => Number(value || 0).toLocaleString('id-ID');

export default {
  name: 'kernel',
  aliases: ['kernelstatus', 'nadiweb'],
  category: 'general',
  description: 'Dashboard WebView publik realtime untuk status kernel, sirkuit NADI, aktivitas, dan statistik respons',
  usage: '.kernel',
  async execute({ sock, m }) {
    try {
      const published = await publishKernelDashboard();
      const snapshot = buildPublicKernelSnapshot();
      const totals = snapshot.totals || {};
      const nadi = snapshot.connection?.nadi || {};
      const status = [
        '*OCHA LIDYA · PUBLIC KERNEL DASHBOARD*',
        `WhatsApp: *${snapshot.connection?.whatsapp?.status || 'unknown'}*`,
        `NADI: *${nadi.ready ? 'READY' : nadi.running ? 'STARTING' : 'OFFLINE'}* · ticks ${count(nadi.ticks)}`,
        '',
        `Pesan masuk: *${count(totals.incomingMessages)}*`,
        `Giliran balasan bot: *${count(totals.botRespondingTurns)}*`,
        `Total output bot: *${count(totals.botOutputMessages)}*`,
        `Jawaban AI berhasil: *${count(totals.aiResponses)}* · gagal ${count(totals.aiFailures)}`,
        '',
        'Dashboard menampilkan telemetri agregat dan variabel matematis NADI secara live. Isi chat, nomor, JID, dan memori privat tidak dipublikasikan.',
        'Gunakan tombol di bawah untuk membuka WebView.'
      ].join('\n');

      if (typeof sock.sendInteractive === 'function') {
        try {
          return await sock.sendInteractive(m.chat, {
            title: 'OCHA LIDYA · KERNEL STATUS',
            subtitle: 'NADI 2.1 · Live Operational Telemetry',
            body: status,
            footer: 'PUBLIC READ-ONLY · Refresh otomatis 2,5 detik',
            buttons: [{
              name: 'cta_url',
              display_text: 'Buka WebView Kernel',
              url: published.url,
              merchant_url: published.url,
              webview_interaction: true
            }]
          }, m);
        } catch {
          return m.reply(`${status}\n\n${published.url}`);
        }
      }
      return m.reply(`${status}\n\n${published.url}`);
    } catch (error) {
      return m.reply([
        '*KERNEL DASHBOARD BELUM DAPAT DIPUBLIKASIKAN*',
        'Pastikan Code Lab aktif, public tunnel diaktifkan, dan binary cloudflared tersedia pada host bot.',
        'Periksa konfigurasi codeLab.enabled, codeLab.publicTunnelEnabled, dan codeLab.cloudflaredBin.',
        `Status: ${String(error?.message || 'gateway tidak tersedia').slice(0, 220)}`
      ].join('\n'));
    }
  }
};
