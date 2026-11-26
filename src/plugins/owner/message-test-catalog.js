export const __OCHA_PLUGIN_HELPER__ = true;

import { logger } from '../../core/logger.js';

export const NUMBERED_TESTS = Object.freeze([
  {
    number: 1,
    id: 'legacy-buttons',
    title: 'Legacy buttonsMessage',
    description: 'Tombol klasik polos · kompatibilitas client lama',
  },
  {
    number: 2,
    id: 'legacy-list',
    title: 'Legacy ListMessage',
    description: 'Single Select klasik · sections dan rows',
  },
  {
    number: 3,
    id: 'legacy-template',
    title: 'Legacy TemplateMessage',
    description: 'Hydrated template · Quick Reply, URL, Call',
  },
  {
    number: 4,
    id: 'button-v2',
    title: 'ButtonV2 Location Header',
    description: 'viewOnce + buttonsMessage + headerType 6',
  },
  {
    number: 5,
    id: 'image-adreply',
    title: 'Image + ExternalAdReply',
    description: 'Gambar lokal dan kartu pratinjau tautan',
  },
  {
    number: 6,
    id: 'media-url-pack',
    title: 'Video, Audio & Document',
    description: 'MP4, audio WAV/MP3 dan PDF lokal',
  },
  {
    number: 7,
    id: 'native-utilities',
    title: 'Poll, Event, Location & Contact',
    description: 'Poll V3, event, lokasi, vCard, scheduled call',
  },
  {
    number: 8,
    id: 'native-flow-core',
    title: 'Native Flow Core · 8 Actions',
    description: 'Select, Reply, URL, Call, Copy, Location, Reminder',
  },
  {
    number: 9,
    id: 'native-flow-media',
    title: 'Native Flow Media Header',
    description: 'Upload gambar lokal ke header kartu interaktif',
  },
  {
    number: 10,
    id: 'galaxy-catalog-address',
    title: 'Galaxy Flow, Catalog & Address',
    description: 'Flow v3, CTA katalog, formulir alamat',
  },
  {
    number: 11,
    id: 'voice-call-permission',
    title: 'Voice Call & Permission',
    description: 'voice_call dan call_permission_request',
  },
  {
    number: 12,
    id: 'commerce-payment',
    title: 'Commerce & Payment Suite',
    description: 'MPM, Review & Pay, Payment Info/Status · dummy',
  },
  {
    number: 13,
    id: 'extended-cta',
    title: 'Extended CTA Actions',
    description: 'OTP, message, webview, channel, request phone',
  },
  { number: 14, id: 'carousel', title: 'Carousel · 2 Cards', description: 'CarouselBuilder serializer · media lokal' },
  {
    number: 15,
    id: 'storefront-collection',
    title: 'Storefront & Collection',
    description: 'Shop storefront dan collection payload',
  },
  { number: 16, id: 'ai-rich', title: 'AIRich Response', description: 'botForwardedMessage dan richResponseMessage' },
]);
const TEST_MENU_PAGE_SIZE = 8;

export async function sendMessageTestMenu(sock, m, requestedPage = 1) {
  const page = Math.max(1, Math.min(2, Math.floor(Number(requestedPage) || 1)));
  const selected = NUMBERED_TESTS.slice((page - 1) * TEST_MENU_PAGE_SIZE, page * TEST_MENU_PAGE_SIZE);
  const builderFactory = sock.buttonBuilder;
  if (typeof builderFactory === 'function') {
    try {
      const builder = builderFactory
        .call(sock)
        .setTitle('OCHA · MESSAGE TEST LAB')
        .setSubtitle(`OWNER ONLY · KATALOG 16 PENGUJIAN · HALAMAN ${page}/2`)
        .setBody(
          'Pilih nomor pengujian. Payload dan data contoh sudah disediakan. Tidak perlu memasukkan URL, teks poll, atau parameter tambahan.',
        )
        .setFooter('Ocha Lidya AI · Serializer ButtonBuilder');
      builder
        .addSelection('Pilih pengujian')
        .makeSection(page === 1 ? '01–08 · LEGACY & NATIVE' : '09–16 · MEDIA, COMMERCE & RICH');
      for (const item of selected) {
        builder.makeRow(
          String(item.number).padStart(2, '0'),
          `${String(item.number).padStart(2, '0')}. ${item.title}`,
          item.description,
          `.test select ${item.number}`,
        );
      }
      if (page === 1) builder.makeRow('', 'Halaman 2 →', 'Lihat pengujian 09 sampai 16', '.test page 2');
      else {
        builder.makeRow('', 'Jalankan semua 16', 'Mengirim seluruh tipe uji secara bertahap', '.test select all');
        builder.makeRow('', '← Halaman 1', 'Kembali ke pengujian 01 sampai 08', '.test page 1');
      }
      return await builder.send(m.chat, { quoted: m });
    } catch (error) {
      logger.warn(
        { err: error, chat: m.chat, page },
        'Message Test Lab serializer menu failed; using numbered text fallback',
      );
    }
  }
  const body = [
    '*OCHA · MESSAGE TEST LAB*',
    `OWNER ONLY · HALAMAN ${page}/2`,
    ...selected.map(
      item =>
        `${String(item.number).padStart(2, '0')}. ${item.title} — ${item.description}\n.test select ${item.number}`,
    ),
    page === 1 ? '\n.test page 2' : '\n.test select all\n.test page 1',
  ].join('\n');
  return m.reply(body);
}
