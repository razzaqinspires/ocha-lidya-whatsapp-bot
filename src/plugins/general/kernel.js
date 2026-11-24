import { buildPublicKernelSnapshot, publishKernelDashboard } from '../../runtime/kernel-dashboard.js';

const count = value => Number(value || 0).toLocaleString('id-ID');

export function buildKernelStatus(snapshot = {}) {
  const totals = snapshot.totals || {};
  const nadi = snapshot.connection?.nadi || {};
  return [
    '*OCHA LIDYA · PUBLIC KERNEL DASHBOARD*',
    `WhatsApp: *${snapshot.connection?.whatsapp?.status || 'unknown'}*`,
    `NADI: *${nadi.ready ? 'READY' : nadi.running ? 'STARTING' : 'OFFLINE'}* · ticks ${count(nadi.ticks)}`,
    '',
    `Pesan masuk: *${count(totals.incomingMessages)}*`,
    `Giliran balasan bot: *${count(totals.botRespondingTurns)}*`,
    `Total output bot: *${count(totals.botOutputMessages)}*`,
    `Jawaban AI berhasil: *${count(totals.aiResponses)}* · gagal ${count(totals.aiFailures)}`,
    '',
    'Dashboard menampilkan telemetri agregat dan variabel matematis NADI secara live. Isi chat, nomor, JID, dan memori privat tidak dipublikasikan.'
  ].join('\n');
}

export async function executeKernelCommand({ sock, m, publish = publishKernelDashboard } = {}) {
  // Deliver a lightweight acknowledgement before even reading external runtime
  // telemetry. If the gateway or NADI snapshot stalls, the command is not silent.
  let acknowledgement;
  try {
    acknowledgement = await m.reply('Permintaan .kernel diterima. Ocha sedang membaca status runtime dan menyiapkan WebView publik…');
  } catch {
    acknowledgement = null;
  }

  let status = '*Status telemetri lokal belum dapat dibaca.*';
  try {
    status = buildKernelStatus(buildPublicKernelSnapshot());
    const published = await publish();
    const body = `${status}\n\nDashboard WebView siap:\n${published.url}\n\nData bersifat publik dan read-only; tidak memuat isi chat atau identitas privat.`;
    if (typeof sock.sendInteractive === 'function') {
      try {
        return await sock.sendInteractive(m.chat, {
          title: 'OCHA LIDYA · KERNEL STATUS',
          subtitle: 'NADI · Live Operational Telemetry',
          body,
          footer: 'PUBLIC READ-ONLY · Refresh otomatis 2,5 detik',
          buttons: [{
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: 'Buka WebView Kernel',
              url: published.url,
              merchant_url: published.url,
              webview_interaction: true
            })
          }]
        }, acknowledgement || m);
      } catch {
        // Keep the URL in the text path for clients without native-flow URL UI.
      }
    }
    return m.reply(body, acknowledgement || m);
  } catch (error) {
    const message = String(error?.message || 'gateway tidak tersedia').slice(0, 320);
    const guidance = [
      '*KERNEL WEBVIEW BELUM TERSEDIA*',
      status,
      'Status lokal sudah diperiksa sejauh komponen runtime mengizinkan, tetapi gateway publik belum siap.',
      'Periksa Code Lab, publicTunnelEnabled, dan instalasi binary cloudflared pada host bot.',
      `Detail: ${message}`,
      '',
      'Coba kembali dengan .kernel setelah gateway pulih.'
    ].join('\n');
    return m.reply(guidance, acknowledgement || m);
  }
}

export default {
  name: 'kernel',
  aliases: ['kernelstatus', 'nadiweb'],
  category: 'general',
  description: 'Dashboard WebView publik realtime untuk status kernel, sirkuit NADI, aktivitas, dan statistik respons',
  usage: '.kernel',
  fullButton: false,
  async execute({ sock, m }) {
    return executeKernelCommand({ sock, m });
  }
};
