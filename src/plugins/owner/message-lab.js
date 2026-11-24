import { proto, generateWAMessageFromContent, prepareWAMessageMedia } from '@whiskeysockets/baileys';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { NUMBERED_TESTS, sendMessageTestMenu } from './message-test-catalog.js';

const sendTestMenu = sendMessageTestMenu;

const OWNER_PHONE = '6283193905842';
const DEFAULT_TEST_URL = 'https://example.com';

const HELP = [
  '*OCHA MESSAGE TEST LAB*',
  'Pilih jenis pengujian dari daftar. Semua media dan contoh pesan sudah disediakan di assets/message-test/.',
  'Tidak perlu mengetik URL, isi poll, teks tombol, atau thumbnail.',
  '',
  'Ketik .test untuk membuka daftar test. Hasil test yang berhasil hanya berupa pesan uji; kegagalan dicatat di log.'
].join('\n');

const TEST_ASSET_DIR = path.resolve(process.cwd(), 'assets', 'message-test');
const TEST_DELAY_MS = 350;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readTestAsset(name) {
  const resolved = path.resolve(TEST_ASSET_DIR, name);
  if (!resolved.startsWith(`${TEST_ASSET_DIR}${path.sep}`)) throw new Error('Path asset test tidak valid.');
  return fs.readFile(resolved);
}

async function logTestDelivery(testId, m, operation) {
  try {
    const result = await operation();
    const resultId = result?.key?.id || result?.messageId || null;
    if (resultId) logger.info({ testId, resultId }, 'Message test payload accepted with result ID');
    else logger.debug({ testId }, 'Message test payload call resolved without a result ID');
    return { success: true, testId, resultId };
  } catch (error) {
    logger.error({ err: error, testId, chat: m.chat }, 'Message test payload failed');
    return { success: false, testId };
  }
}



function requireUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} harus berupa URL HTTP(S) yang valid.`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label} hanya menerima HTTP(S).`);
  return url.toString();
}

function requirePhone(value) {
  const phone = String(value || '').replace(/\D/g, '');
  if (phone.length < 8 || phone.length > 15) throw new Error('Nomor harus 8-15 digit dengan format internasional.');
  return phone;
}

async function sendGenerated(sock, m, content, relayOptions = {}) {
  if (typeof sock.relayMessage !== 'function') throw new Error('Socket tidak memiliki relayMessage().');
  const userJid = sock.user?.id || sock.authState?.creds?.me?.id;
  const generated = generateWAMessageFromContent(m.chat, proto.Message.create(content), {
    userJid,
    timestamp: new Date(),
    quoted: m
  });
  return sock.relayMessage(m.chat, generated.message, { messageId: generated.key.id, ...relayOptions });
}

function nativeFlowNode(name = 'mixed') {
  return [{
    tag: 'biz',
    attrs: {},
    content: [{
      tag: 'interactive',
      attrs: { type: 'native_flow', v: '1' },
      content: [{ tag: 'native_flow', attrs: { v: '9', name } }]
    }]
  }];
}

function nativeButton(name, params) {
  return { name, buttonParamsJson: JSON.stringify(params || {}) };
}

async function sendNativeFlowPage(sock, m, page) {
  const content = {
    messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
    interactiveMessage: {
      ...(page.header ? { header: page.header } : {}),
      body: { text: page.body },
      ...(page.footer ? { footer: { text: page.footer } } : {}),
      nativeFlowMessage: {
        buttons: page.buttons,
        messageParamsJson: JSON.stringify(page.messageParams || {}),
        messageVersion: 1
      }
    }
  };
  return sendGenerated(sock, m, content, { additionalNodes: nativeFlowNode(page.nodeName || 'mixed') });
}

function nativeFlowPages() {
  const github = 'https://github.com/razzaqinspires';
  const address = {
    name: 'Ocha Test',
    phone_number: '6280000000000',
    in_pin_code: '20111',
    address: 'Jl. Contoh Pengujian 1',
    landmark_area: 'Area Pengujian',
    city: 'Medan',
    state: 'Sumatera Utara'
  };
  const order = {
    status: 'pending',
    items: [{ retailer_id: 'SKU-OCHA-TEST-01', name: 'Produk Test', amount: { value: 5000000, offset: 100 }, quantity: 1 }],
    subtotal: { value: 5000000, offset: 100 }
  };
  return [
    {
      header: { title: 'Native Flow Test 1/5', hasMediaAttachment: false },
      body: 'Bagian 1: delapan action native-flow utama. Quick Reply dan pilihan daftar mengirim callback ke bot; CTA lain dieksekusi oleh aplikasi WhatsApp.',
      footer: 'Ocha Lidya AI · Razzaq Ventures',
      buttons: [
        nativeButton('single_select', { title: 'Pilih Menu', sections: [{ title: 'Kategori Utama', highlight_label: 'Populer', rows: [
          { header: 'Header Opsi', title: 'Opsi Pertama', description: 'Deskripsi pilihan pertama', id: '.test response native_select_1' },
          { title: 'Opsi Kedua', description: 'Deskripsi pilihan kedua', id: '.test response native_select_2' }
        ] }] }),
        nativeButton('quick_reply', { display_text: 'Quick Reply', id: '.test response native_quick_reply' }),
        nativeButton('cta_url', { display_text: 'Buka URL', url: github, merchant_url: github, webview_interaction: true }),
        nativeButton('cta_call', { display_text: 'Telepon Owner', phone_number: OWNER_PHONE }),
        nativeButton('cta_copy', { display_text: 'Salin kode', copy_code: 'OCHA-TEST-01' }),
        nativeButton('send_location', { display_text: 'Kirim Lokasi' }),
        nativeButton('cta_reminder', { display_text: 'Ingatkan Saya', id: '.test response native_reminder' }),
        nativeButton('cta_cancel_reminder', { display_text: 'Batal Pengingat', id: '.test response native_cancel_reminder' })
      ]
    },
    {
      header: { title: 'Native Flow Test 2/5', subtitle: 'Complex Flow, Catalog & Address', hasMediaAttachment: false },
      body: 'Bagian 2: Galaxy Flow, Catalog CTA dan formulir alamat. Catalog dan Galaxy Flow memerlukan konfigurasi/fitur akun yang sesuai.',
      footer: 'Ocha Lidya AI · Razzaq Ventures',
      messageParams: { bottom_sheet: { in_thread_buttons_limit: 3, divider_indices: [1, 2], list_title: 'Layanan Bisnis & Form', button_title: 'Pilih Aksi' } },
      buttons: [
        nativeButton('galaxy_message', { flow_message_version: '3', flow_token: 'ocha-flow-token-test-2026', flow_id: '1234567890123456', flow_cta: 'Buka Galaxy Flow', flow_action: 'navigate', mode: 'published', flow_action_payload: { screen: 'BOOKING_SCREEN', data: { user_name: 'Ocha Test', user_jid: '6280000000000@s.whatsapp.net', service: 'Nexora AI Automation', tier: 'Enterprise', order_ref: 'RV-FLOW-TEST-001', is_verified: false } } }),
        nativeButton('cta_catalog', { business_phone_number: OWNER_PHONE, catalog_product_id: '9876543210987654', thumbnail_product_id: '9876543210987654' }),
        nativeButton('address_message', { display_text: 'Isi Alamat Lengkap', id: '.test response native_address', country: 'ID', values: address, saved_addresses: [{ id: 'addr_ocha_test_01', value: { ...address, name: 'Razzaq Ventures Test Address' } }], validation_errors: {} })
      ]
    },
    {
      header: { title: 'Native Flow Test 3/5', subtitle: 'In-App Voice Call', hasMediaAttachment: false },
      body: 'Bagian 3: tombol voice_call. Hasil bergantung pada dukungan akun, perangkat, dan versi WhatsApp penerima.',
      footer: 'Ocha Lidya AI · Razzaq Ventures',
      nodeName: 'voice_call',
      buttons: [nativeButton('voice_call', { display_text: 'Voice Call', ttl_minutes: 10 })]
    },
    {
      body: 'Bagian 4: permintaan izin panggilan suara (Call Permission Request).',
      nodeName: 'call_permission_request',
      buttons: [nativeButton('call_permission_request', { has_multiple_buttons: true })]
    },
    {
      header: { title: 'Native Flow Test 5/5', subtitle: 'Commerce, MPM & Order Checkout', hasMediaAttachment: false },
      body: 'Bagian 5: Multi-Product Message, Review & Pay, dan Order Details. Ini payload dummy; jangan dipakai untuk transaksi sungguhan.',
      footer: 'Ocha Lidya AI · Razzaq Ventures',
      buttons: [
        nativeButton('mpm', { product_list_info: { title: 'Katalog Produk', product_sections: [{ title: 'Produk Unggulan', products: [{ product_retailer_id: 'SKU-001' }, { product_retailer_id: 'SKU-002' }] }], business_owner_jid: `${OWNER_PHONE}@s.whatsapp.net` } }),
        nativeButton('review_and_pay', { currency: 'IDR', total_amount: { value: 5000000, offset: 100 }, reference_id: 'INV-OCHA-TEST-01', type: 'physical-goods', order }),
        nativeButton('order_details', { reference_id: 'ORD-OCHA-TEST-01', type: 'physical-goods', payment_type: 'upi', payment_configuration: 'merchant_config', currency: 'IDR', total_amount: { value: 5000000, offset: 100 }, order: { ...order, items: [{ retailer_id: 'SKU-001', name: 'Nexora AI License', amount: { value: 5000000, offset: 100 }, quantity: 1 }] } })
      ]
    }
  ];
}

async function sendNativeFlowTests(sock, m, selected = 'all') {
  const pages = nativeFlowPages();
  const indexes = selected === 'all' ? [0, 1, 2, 3, 4] : [Number(selected) - 1];
  if (indexes.some(index => !Number.isInteger(index) || index < 0 || index > 4)) throw new Error('Pilihan Native Flow harus all atau nomor 1 sampai 5.');
  const deliveries = [];
  for (const index of indexes) {
    deliveries.push(await logTestDelivery(`nativeflow-${index + 1}`, m, () => sendNativeFlowPage(sock, m, pages[index])));
    if (indexes.length > 1) await sleep(450);
  }
  return { handled: true, test: 'nativeflow', pages: indexes.length, success: deliveries.every(item => item.success), resultIds: deliveries.map(item => item.resultId).filter(Boolean) };
}

async function sendQuickReplyAndList(sock, m) {
  const deliveries = [];
  deliveries.push(await logTestDelivery('quick-reply', m, () => sock.buttonBuilder()
    .setTitle('Quick Reply Test')
    .setBody('Pilih tombol untuk menguji callback quick-reply.')
    .setFooter('Ocha Message Test Lab')
    .addReply('Pilih A', '.test response quick_a')
    .addReply('Pilih B', '.test response quick_b')
    .send(m.chat, { quoted: m })));
  await sleep(TEST_DELAY_MS);
  deliveries.push(await logTestDelivery('single-select', m, () => sock.buttonBuilder()
    .setTitle('Single Select Test')
    .setBody('Buka daftar dan pilih salah satu baris.')
    .addSelection('Pilih opsi')
    .makeSection('Pilihan')
    .makeRow('', 'Opsi pertama', 'Baris pertama', '.test response list_first')
    .makeRow('', 'Opsi kedua', 'Baris kedua', '.test response list_second')
    .send(m.chat, { quoted: m })));
  return { handled: true, test: 'quick-and-list', success: deliveries.every(item => item.success), resultIds: deliveries.map(item => item.resultId).filter(Boolean) };
}

async function sendMediaPack(sock, m) {
  const image = await readTestAsset('sample-image.png');
  const video = await readTestAsset('sample-video.mp4');
  const audio = await readTestAsset('sample-audio.wav');
  const document = await readTestAsset('sample-document.pdf');
  const sticker = await readTestAsset('sample-sticker.webp');
  const tests = [
    ['image', () => sock.sendMessage(m.chat, { image, mimetype: 'image/png', caption: 'Ocha local image test asset' }, { quoted: m })],
    ['video', () => sock.sendMessage(m.chat, { video, mimetype: 'video/mp4', caption: 'Ocha local video test asset' }, { quoted: m })],
    ['audio', () => sock.sendMessage(m.chat, { audio, mimetype: 'audio/wav', ptt: false }, { quoted: m })],
    ['document', () => sock.sendMessage(m.chat, { document, mimetype: 'application/pdf', fileName: 'ocha-message-test.pdf', caption: 'Ocha local PDF test asset' }, { quoted: m })],
    ['sticker', () => sock.sendMessage(m.chat, { sticker }, { quoted: m })],
    ['view-once', () => sock.sendMessage(m.chat, { image, mimetype: 'image/png', viewOnce: true, caption: 'View-once fixture' }, { quoted: m })],
    ['ptv', () => sock.sendMessage(m.chat, { video, mimetype: 'video/mp4', ptv: true }, { quoted: m })]
  ];
  const deliveries = [];
  for (const [testId, send] of tests) {
    deliveries.push(await logTestDelivery(testId, m, send));
    await sleep(TEST_DELAY_MS);
  }
  return { handled: true, test: 'media-pack', total: tests.length, success: deliveries.every(item => item.success), resultIds: deliveries.map(item => item.resultId).filter(Boolean) };
}

async function sendCarouselTest(sock, m) {
  const [imageOne, imageTwo] = await Promise.all([
    readTestAsset('carousel-01.png'), readTestAsset('carousel-02.png')
  ]);
  const builder = sock.carouselBuilder()
    .setTitle('Ocha Message Test Carousel')
    .setBody('Uji dua kartu media dan callback tombol pada setiap kartu.')
    .setFooter('Ocha Lidya AI · Local Assets');
  builder.addCard([
    {
      header: { title: 'Card 1 · Nexora AI', subtitle: 'WhatsApp Automation', image: imageOne },
      body: { text: 'Kartu pertama menggunakan gambar lokal.' },
      footer: { text: 'Kartu 1/2' },
      nativeFlowMessage: { buttons: [nativeButton('quick_reply', { display_text: 'Pilih Nexora', id: '.test response carousel_nexora' })] }
    },
    {
      header: { title: 'Card 2 · Lumóra', subtitle: 'Aromatherapy & Lifestyle', image: imageTwo },
      body: { text: 'Kartu kedua menggunakan gambar lokal.' },
      footer: { text: 'Kartu 2/2' },
      nativeFlowMessage: { buttons: [nativeButton('quick_reply', { display_text: 'Pilih Lumóra', id: '.test response carousel_lumora' })] }
    }
  ]);
  const delivery = await logTestDelivery('carousel', m, () => builder.send(m.chat, { quoted: m }));
  return { handled: true, test: 'carousel', success: delivery.success, resultId: delivery.resultId || null, resultIds: delivery.resultId ? [delivery.resultId] : [] };
}

async function sendExtraTests(sock, m) {
  const tests = [
    ['location', () => sock.sendMessage(m.chat, { location: { degreesLatitude: 0, degreesLongitude: 0, name: 'Ocha Test Coordinate' } }, { quoted: m })],
    ['contact', () => m.sendContact({ number: OWNER_PHONE, displayName: 'Ocha Test Contact', organization: 'Razzaq Ventures' }, { quoted: m })],
    ['event', () => sock.sendMessage(m.chat, { event: { name: 'Ocha Calendar Test', description: 'Synthetic calendar event test.', startDate: new Date(Date.now() + 60 * 60_000), endDate: new Date(Date.now() + 2 * 60 * 60_000), extraGuestsAllowed: true } }, { quoted: m })]
  ];
  const deliveries = [];
  for (const [testId, send] of tests) {
    deliveries.push(await logTestDelivery(testId, m, send));
    await sleep(TEST_DELAY_MS);
  }
  return { handled: true, test: 'extras', total: tests.length, success: deliveries.every(item => item.success), resultIds: deliveries.map(item => item.resultId).filter(Boolean) };
}

function testMessageContext() {
  return { deviceListMetadata: {}, deviceListMetadataVersion: 2, messageSecret: randomBytes(32) };
}

async function relayTestPayload(sock, m, message, nodeName = 'mixed') {
  if (typeof sock.relayMessage !== 'function') throw new Error('Socket tidak memiliki relayMessage().');
  return sock.relayMessage(m.chat, message, { additionalNodes: nativeFlowNode(nodeName) });
}

async function runNumberedTest(sock, m, number) {
  const deliver = (id, operation) => logTestDelivery(`test-${String(number).padStart(2, '0')}-${id}`, m, operation);
  const ownerJid = `${OWNER_PHONE}@s.whatsapp.net`;
  const github = 'https://github.com/razzaqinspires';
  const order = {
    status: 'pending',
    items: [{ retailer_id: 'OCHA-TEST-SKU-01', name: 'Synthetic Test Product', amount: { value: 10000, offset: 100 }, quantity: 1 }],
    subtotal: { value: 10000, offset: 100 }
  };
  switch (number) {
    case 1:
      return deliver('legacy-buttons', () => relayTestPayload(sock, m, {
        messageContextInfo: testMessageContext(),
        buttonsMessage: {
          contentText: 'Uji Legacy buttonsMessage polos (Type 1).',
          footerText: 'Ocha Lidya AI · Legacy Compatibility', headerType: 1,
          buttons: [
            { buttonId: '.test response legacy_1', buttonText: { displayText: 'Legacy Tombol 1' }, type: 1 },
            { buttonId: '.test response legacy_2', buttonText: { displayText: 'Legacy Tombol 2' }, type: 1 }
          ]
        }
      }));

    case 2:
      return deliver('legacy-list', () => relayTestPayload(sock, m, {
        messageContextInfo: testMessageContext(),
        listMessage: {
          title: 'Legacy List Menu', description: 'Struktur listMessage klasik dengan sections dan rows.',
          buttonText: 'Buka Daftar Legacy', listType: 1, footerText: 'Ocha Lidya AI · Legacy Compatibility',
          sections: [{ title: 'Kategori Utama', rows: [
            { title: 'Opsi Legacy A', rowId: '.test response legacy_row_a', description: 'Baris pertama' },
            { title: 'Opsi Legacy B', rowId: '.test response legacy_row_b', description: 'Baris kedua' }
          ] }]
        }
      }));

    case 3:
      return deliver('legacy-template', () => relayTestPayload(sock, m, {
        messageContextInfo: testMessageContext(),
        templateMessage: {
          hydratedTemplate: {
            hydratedContentText: 'Uji Legacy hydratedTemplateMessage.',
            hydratedFooterText: 'Ocha Lidya AI · Hydrated Template',
            hydratedButtons: [
              { index: 1, urlButton: { displayText: 'URL Legacy', url: github } },
              { index: 2, callButton: { displayText: 'Call Test', phoneNumber: '+6280000000000' } },
              { index: 3, quickReplyButton: { displayText: 'Reply Legacy', id: '.test response legacy_template' } }
            ]
          }
        }
      }));

    case 4:
      return deliver('button-v2', () => sock.relayMessage(m.chat, {
        viewOnceMessage: {
          message: {
            messageContextInfo: testMessageContext(),
            buttonsMessage: {
              contentText: 'ButtonV2 test: viewOnce + headerType 6 location.',
              footerText: 'Ocha Lidya AI · ButtonV2', headerType: 6,
              locationMessage: { degreesLatitude: 3.635, degreesLongitude: 98.675, name: 'Razzaq Ventures Lab', address: 'Medan, Indonesia' },
              buttons: [
                { buttonId: '.test response v2_ping', buttonText: { displayText: 'Cek Server' }, type: 1 },
                { buttonId: '.test response v2_menu', buttonText: { displayText: 'Buka Menu' }, type: 1 }
              ]
            }
          }
        }
      }, {}));

    case 5: {
      const image = await readTestAsset('sample-image.png');
      return deliver('image-adreply', () => sock.sendMessage(m.chat, {
        image, mimetype: 'image/png', caption: 'Image Message + ExternalAdReply · local test asset',
        contextInfo: { externalAdReply: {
          title: 'Ocha Lidya AI · Nexora 0.1', body: 'WhatsApp Automation & Craft Studio',
          mediaType: 1, thumbnail: image, sourceUrl: github, renderLargerThumbnail: true
        } }
      }, { quoted: m }));
    }

    case 6: {
      const assets = [
        ['video', async () => sock.sendMessage(m.chat, { video: await readTestAsset('sample-video.mp4'), mimetype: 'video/mp4', caption: 'Video Message URL/Buffer Test' }, { quoted: m })],
        ['audio', async () => sock.sendMessage(m.chat, { audio: await readTestAsset('sample-audio.wav'), mimetype: 'audio/wav', ptt: false }, { quoted: m })],
        ['document', async () => sock.sendMessage(m.chat, { document: await readTestAsset('sample-document.pdf'), mimetype: 'application/pdf', fileName: 'Ocha_Test_Document.pdf', caption: 'Document Message Test' }, { quoted: m })]
      ];
      const results = [];
      for (const [id, operation] of assets) { results.push(await deliver(id, operation)); await sleep(700); }
      return { handled: true, test: 'test-06-media', success: results.every(item => item.success), resultIds: results.map(item => item.resultId).filter(Boolean) };
    }

    case 7: {
      const results = [];
      results.push(await deliver('location', () => sock.sendMessage(m.chat, { location: { degreesLatitude: 3.635, degreesLongitude: 98.675, name: 'Razzaq Ventures Lab', address: 'Medan, Indonesia' } }, { quoted: m })));
      await sleep(700);
      results.push(await deliver('contact', () => m.sendContact({ number: OWNER_PHONE, displayName: 'Ocha Test Contact', organization: 'Razzaq Ventures' }, { quoted: m })));
      await sleep(700);
      results.push(await deliver('poll-v3', () => relayTestPayload(sock, m, {
        messageContextInfo: testMessageContext(),
        pollCreationMessageV3: { name: '📊 Ocha Native Message Test', options: [
          { optionName: 'Native Flow Interactive' }, { optionName: 'AIRich Response' },
          { optionName: 'Carousel Media Cards' }, { optionName: 'Media & Poll Native' }
        ], selectableOptionsCount: 1 }
      })));
      await sleep(700);
      results.push(await deliver('event', () => relayTestPayload(sock, m, {
        messageContextInfo: testMessageContext(),
        eventMessage: { isCanceled: false, name: 'Ocha Message Test Event', description: 'Synthetic RSVP event; not a real appointment.', location: { degreesLatitude: 3.635, degreesLongitude: 98.675, name: 'Medan, Indonesia' }, startTime: String(Math.floor(Date.now() / 1000) + 7200) }
      })));
      await sleep(700);
      results.push(await deliver('scheduled-call', () => relayTestPayload(sock, m, {
        messageContextInfo: testMessageContext(),
        scheduledCallCreationMessage: { scheduledTimestampMs: String(Date.now() + 3600000), callType: 1, title: 'Ocha Test Voice Sync' }
      })));
      return { handled: true, test: 'test-07-utilities', success: results.every(item => item.success), resultIds: results.map(item => item.resultId).filter(Boolean) };
    }

    case 8: {
      const buttons = [
        nativeButton('single_select', { title: 'Menu Pilihan', sections: [{ title: 'Modul Sistem', highlight_label: 'Stable', rows: [
          { header: 'Core', title: 'Telemetry Live', description: 'Pantau CPU dan RAM', id: '.test response nf_telemetry' },
          { header: 'System', title: 'Ocha Menu', description: 'Buka command directory', id: '.menu' }
        ] }] }),
        nativeButton('quick_reply', { display_text: 'Balas Cepat', id: '.test response nf_quick_reply' }),
        nativeButton('cta_url', { display_text: 'Kunjungi GitHub', url: github, merchant_url: github, webview_interaction: true }),
        nativeButton('cta_call', { display_text: 'Call Test Number', phone_number: '6280000000000' }),
        nativeButton('cta_copy', { display_text: 'Salin Token', copy_code: 'OCHA-NEXORA-TEST-2026' }),
        nativeButton('send_location', { display_text: 'Kirim Lokasi Saya' }),
        nativeButton('cta_reminder', { display_text: 'Aktifkan Pengingat', id: '.test response nf_reminder' }),
        nativeButton('cta_cancel_reminder', { display_text: 'Batalkan Pengingat', id: '.test response nf_cancel_reminder' })
      ];
      return deliver('native-flow-core', () => relayTestPayload(sock, m, {
        messageContextInfo: testMessageContext(),
        interactiveMessage: {
          header: { title: 'Native Flow Core Suite', subtitle: '8 Action Buttons', hasMediaAttachment: false },
          body: { text: 'Uji delapan tipe action Native Flow inti.' },
          footer: { text: 'Ocha Lidya AI · Nexora 0.1' },
          nativeFlowMessage: { buttons, messageParamsJson: '{}', messageVersion: 1 }
        }
      }));
    }

    case 9: {
      const image = await readTestAsset('sample-image.png');
      if (typeof sock.waUploadToServer !== 'function') throw new Error('sock.waUploadToServer tidak tersedia untuk media header.');
      const uploaded = await prepareWAMessageMedia({ image }, { upload: sock.waUploadToServer });
      if (!uploaded?.imageMessage) throw new Error('Upload image header gagal.');
      return deliver('native-flow-media-header', () => relayTestPayload(sock, m, {
        messageContextInfo: testMessageContext(),
        interactiveMessage: {
          header: { title: 'Ocha Media Header Test', subtitle: 'Local image upload', hasMediaAttachment: true, imageMessage: uploaded.imageMessage },
          body: { text: 'Native Flow dengan header gambar lokal yang diunggah ke WhatsApp.' },
          footer: { text: 'Ocha Lidya AI · Media Header' },
          nativeFlowMessage: { buttons: [
            nativeButton('quick_reply', { display_text: 'Pilih Test', id: '.test response media_header' }),
            nativeButton('cta_url', { display_text: 'Buka Repo', url: github, merchant_url: github })
          ], messageParamsJson: JSON.stringify({ bottom_sheet: { in_thread_buttons_limit: 2, list_title: 'Pilihan', button_title: 'Buka Menu' } }), messageVersion: 1 }
        }
      }));
    }

    case 10:
      return deliver('galaxy-catalog-address', () => relayTestPayload(sock, m, {
        messageContextInfo: testMessageContext(),
        interactiveMessage: {
          header: { title: 'Galaxy Flow & Address Form', hasMediaAttachment: false },
          body: { text: 'Uji Galaxy Flow v3, Catalog CTA, dan Address Message menggunakan data dummy.' },
          footer: { text: 'Ocha Lidya AI · Nexora' },
          nativeFlowMessage: { buttons: [
            nativeButton('galaxy_message', { flow_message_version: '3', flow_token: 'ocha-flow-test-token', flow_id: '1234567890123456', flow_cta: 'Buka Galaxy Flow', flow_action: 'navigate', mode: 'published', flow_action_payload: { screen: 'START', data: { user_name: 'Ocha Test', order_ref: 'OCHA-FLOW-TEST' } } }),
            nativeButton('cta_catalog', { business_phone_number: OWNER_PHONE, catalog_product_id: '9876543210987654', thumbnail_product_id: '9876543210987654' }),
            nativeButton('address_message', { display_text: 'Form Alamat Test', id: '.test response address_form', country: 'ID', values: { name: 'Ocha Test', phone_number: '6280000000000', in_pin_code: '20111', address: 'Alamat Pengujian', city: 'Medan', state: 'Sumatera Utara' } })
          ], messageParamsJson: '{}', messageVersion: 1 }
        }
      }));

    case 11:
      return deliver('voice-call-permission', () => relayTestPayload(sock, m, {
        messageContextInfo: testMessageContext(),
        interactiveMessage: {
          header: { title: 'Voice Call & Permission', hasMediaAttachment: false },
          body: { text: 'Uji voice_call dan permintaan izin panggilan.' },
          footer: { text: 'Ocha Lidya AI · Experimental' },
          nativeFlowMessage: { buttons: [
            nativeButton('voice_call', { display_text: 'Voice Call Test', ttl_minutes: 10 }),
            nativeButton('call_permission_request', { has_multiple_buttons: true })
          ], messageParamsJson: '{}', messageVersion: 1 }
        }
      }, 'voice_call'));

    case 12:
      return deliver('commerce-payment', () => relayTestPayload(sock, m, {
        messageContextInfo: testMessageContext(),
        interactiveMessage: {
          header: { title: 'Commerce & Payment Test', hasMediaAttachment: false },
          body: { text: 'Payload dummy untuk pemeriksaan struktur commerce. Bukan invoice atau transaksi nyata.' },
          footer: { text: 'Ocha Lidya AI · TEST ONLY' },
          nativeFlowMessage: { buttons: [
            nativeButton('mpm', { product_list_info: { title: 'Ocha Test Catalog', product_sections: [{ title: 'Synthetic Products', products: [{ product_retailer_id: 'OCHA-TEST-SKU-01' }] }], business_owner_jid: ownerJid } }),
            nativeButton('review_and_pay', { currency: 'IDR', total_amount: { value: 10000, offset: 100 }, reference_id: 'OCHA-TEST-INV-01', type: 'physical-goods', order }),
            nativeButton('payment_info', { payment_settings: [{ type: 'pix_static_code', pix_static_code: { merchant_name: 'OCHA TEST ONLY', key: 'TEST-NOT-A-REAL-PAYMENT-KEY', key_type: 'PHONE' } }] }),
            nativeButton('payment_status', { reference_id: 'OCHA-TEST-INV-01', payment_status: 'pending', payment_timestamp: Math.floor(Date.now() / 1000) })
          ], messageParamsJson: '{}', messageVersion: 1 }
        }
      }));

    case 13:
      return deliver('extended-cta', () => relayTestPayload(sock, m, {
        messageContextInfo: testMessageContext(),
        interactiveMessage: {
          header: { title: 'Extended CTA Actions', hasMediaAttachment: false },
          body: { text: 'Uji OTP, prefilled message, Webview, WhatsApp Channel dan request phone.' },
          footer: { text: 'Ocha Lidya AI · Experimental CTA' },
          nativeFlowMessage: { buttons: [
            nativeButton('cta_otp', { display_text: 'Salin OTP Test', copy_code: '849201' }),
            nativeButton('cta_message', { display_text: 'Chat Test Number', phone_number: '6280000000000', text: 'Halo Ocha Test' }),
            nativeButton('open_webview', { title: 'Buka Webview', link: { url: 'https://example.com' } }),
            nativeButton('cta_whatsapp_channel', { display_text: 'Channel Test', newsletter_jid: '120363000000000000@newsletter', newsletter_name: 'Ocha Test Channel' }),
            nativeButton('request_phone_number', { display_text: 'Kirim Nomor HP' })
          ], messageParamsJson: '{}', messageVersion: 1 }
        }
      }));

    case 14:
      return sendCarouselTest(sock, m);

    case 15: {
      const first = await deliver('shop-storefront', () => relayTestPayload(sock, m, {
        messageContextInfo: testMessageContext(),
        interactiveMessage: {
          body: { text: 'Etalase toko Ocha Test (shopStorefrontMessage).' },
          footer: { text: 'Ocha Lidya AI' },
          shopStorefrontMessage: { surface: 1, id: 'shop-ocha-test', messageVersion: 1 }
        }
      }));
      await sleep(700);
      const second = await deliver('collection', () => relayTestPayload(sock, m, {
        messageContextInfo: testMessageContext(),
        interactiveMessage: {
          body: { text: 'Koleksi katalog Ocha Test (collectionMessage).' },
          footer: { text: 'Ocha Lidya AI' },
          collectionMessage: { bizJid: ownerJid, id: 'collection-ocha-test', messageVersion: 1 }
        }
      }));
      return { handled: true, test: 'test-15-storefront', success: first.success && second.success, resultIds: [first.resultId, second.resultId].filter(Boolean) };
    }

    case 16: {
      const aiHtml = '<div style="background:#101726;color:#f1f5f9;padding:13px;border-radius:14px;font-family:sans-serif;border:1px solid #263148"><b style="color:#38bdf8">OCHA · AIRICH TEST</b><p style="font-size:11px;color:#94a3b8">Uji richResponseMessage dan inline HTML tanpa script.</p></div>';
      return deliver('ai-rich-response', () => sock.relayMessage(m.chat, {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2, botMessageSecret: randomBytes(32) },
        botForwardedMessage: { message: { richResponseMessage: {
          messageType: 1,
          submessages: [{ messageType: 2, messageText: '✅ Ocha AIRich Response Test · Razzaq Ventures' }],
          unifiedResponse: { data: new TextEncoder().encode(JSON.stringify({
            title: 'OCHA AIRICH TEST', footer: 'Ocha Lidya AI · Razzaq Ventures',
            sections: [{ view_model: { __typename: 'GenAISingleLayoutViewModel', primitive: { __typename: 'FOAHtmlPrimitiveDemoDONOTUSE', trusted_sources: [], payload: aiHtml } } }]
          })) },
          contextInfo: { forwardingScore: 1, isForwarded: true, forwardedAiBotMessageInfo: { botJid: '13135550002@s.whatsapp.net', botName: 'Meta AI' } }
        } } }
      }, {}));
    }
    default:
      throw new Error('Nomor test harus 1 sampai 16.');
  }
}

async function runTestSelection(sock, m, selection) {
  const key = String(selection || '').toLowerCase();
  if (!key || key === 'menu') return sendTestMenu(sock, m);
  if (key === 'all') {
    const results = [];
    for (let number = 1; number <= NUMBERED_TESTS.length; number += 1) {
      results.push(await runNumberedTest(sock, m, number));
      await sleep(850);
    }
    return { handled: true, test: 'all-numbered', success: results.every(item => item.success !== false), resultIds: results.flatMap(item => item.resultIds || (item.resultId ? [item.resultId] : [])) };
  }
  const number = Number(key);
  if (Number.isInteger(number) && number >= 1 && number <= NUMBERED_TESTS.length) return runNumberedTest(sock, m, number);
  const legacySelections = {
    'full-buttons': async () => runNumberedTest(sock, m, 8),
    nativeflow: async () => runNumberedTest(sock, m, 8),
    quick: () => sendQuickReplyAndList(sock, m),
    poll: async () => {
      const result = await logTestDelivery('poll', m, () => runTest(sock, m, 'poll', []));
      return { handled: true, test: 'poll', success: result.success, resultIds: result.resultId ? [result.resultId] : [] };
    },
    carousel: () => runNumberedTest(sock, m, 14),
    media: () => runNumberedTest(sock, m, 6),
    legacy: async () => {
      const first = await runNumberedTest(sock, m, 1);
      await sleep(700);
      const second = await runNumberedTest(sock, m, 3);
      return { handled: true, test: 'legacy', success: first.success && second.success, resultIds: [...(first.resultIds || []), ...(second.resultIds || [])] };
    },
    extras: () => runNumberedTest(sock, m, 7),
    rich: () => runNumberedTest(sock, m, 16)
  };
  if (legacySelections[key]) return legacySelections[key]();
  return sendTestMenu(sock, m);
}


function listStubTypes() {
  const entries = Object.entries(proto?.WebMessageInfo?.StubType || {})
    .filter(([name, value]) => !/^\d+$/.test(name) && Number.isInteger(value))
    .sort((a, b) => a[1] - b[1]);
  return entries.map(([name, value]) => `${value}. ${name}`).join('\n') || '(Enum StubType tidak tersedia pada build ini)';
}

const MESSAGE_TYPES = [
  'conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'ptvMessage',
  'audioMessage', 'documentMessage', 'stickerMessage', 'contactMessage', 'contactsArrayMessage',
  'locationMessage', 'liveLocationMessage', 'templateMessage', 'buttonsMessage',
  'interactiveMessage', 'interactiveResponseMessage', 'eventMessage', 'pollCreationMessage',
  'pollCreationMessageV2', 'pollCreationMessageV3', 'albumMessage', 'requestPhoneNumberMessage',
  'newsletterAdminInviteMessage', 'productMessage', 'listMessage', 'listResponseMessage',
  'buttonsResponseMessage', 'templateButtonReplyMessage', 'richResponseMessage', 'botForwardedMessage'
];

async function runTest(sock, m, type, args) {
  const text = args.join(' ').trim();
  switch (type) {
    case 'help':
    case 'menu':
    case '':
      return sendTestMenu(sock, m);

    case 'select':
      return runTestSelection(sock, m, args[0]);

    case 'types':
    case 'messagetypes':
      return m.reply(`*MessageType reference*\n${MESSAGE_TYPES.join('\n')}\n\nMessageType di Baileys adalah keyof proto.Message. Daftar ini merangkum format yang relevan untuk serializer dan test lab; bukan jaminan semua format dapat dikirim oleh setiap akun/client.`);

    case 'stubtypes':
    case 'stubs':
      return m.reply(`*WAMessageStubType*\n${listStubTypes()}\n\nStub type adalah event sistem (misalnya perubahan grup/anggota), bukan payload pesan yang dapat dipalsukan melalui sendMessage().`);

    case 'identity':
    case 'identitas': {
      if (m.isGroup) return m.reply('`.test identity` hanya dapat dijalankan di chat pribadi owner agar JID/nomor identitas tidak tampil di grup.');
      const identity = m.identity || {};
      const chat = identity.chat || {};
      const sender = identity.sender || {};
      const bot = identity.bot || {};
      return m.reply([
        '*IDENTITY / SERIALIZER INSPECTOR*',
        '',
        '*Chat*',
        `JID: ${chat.jid || m.key?.remoteJid || '-'}`,
        `JID alternatif: ${chat.jidAlt || m.key?.remoteJidAlt || '-'}`,
        `JID PN: ${chat.jidPn || m.key?.remoteJidPn || '-'}`,
        `JID normalisasi: ${chat.normalizedJid || m.chat || '-'}`,
        `Addressing mode: ${chat.addressingMode || m.key?.addressingMode || '-'}`,
        `Tipe chat: ${(chat.isGroup ?? m.isGroup) ? 'Grup' : 'Pribadi'}`,
        '',
        '*Pengirim*',
        `Push name: ${sender.pushName || m.pushName || '-'}`,
        `JID mentah: ${sender.jid || m.key?.participant || m.key?.remoteJid || '-'}`,
        `JID alternatif: ${sender.jidAlt || m.key?.participantAlt || '-'}`,
        `JID PN: ${sender.jidPn || m.key?.participantPn || m.key?.senderPn || '-'}`,
        `JID normalisasi: ${sender.normalizedJid || m.sender || '-'}`,
        `From me: ${sender.isFromMe ?? m.fromMe ?? false}`,
        '',
        '*Bot*',
        `PN/JID: ${bot.jid || sock.user?.id || '-'}`,
        `LID: ${bot.lid || sock.user?.lid || '-'}`,
        '',
        '*Pesan*',
        `ID: ${identity.message?.id || m.id || '-'}`,
        `Jenis: ${identity.message?.type || m.type || '-'}`,
        `Timestamp: ${identity.message?.timestamp || m.messageTimestamp || '-'}`,
        `Stub: ${m.stubTypeName || '-'}`
      ].join('\n'));
    }

    case 'inspect':
    case 'serialize': {
      if (m.isGroup) return m.reply('`.test inspect` hanya dapat dijalankan di chat pribadi owner karena dapat menampilkan metadata dan parameter payload.');
      const response = m.interactiveResponse || null;
      return m.reply([
        '*SERIALIZER MESSAGE INSPECTOR*',
        `Type: ${m.type || '-'}`,
        `Body: ${m.body || '(kosong)'}`,
        `Button name: ${m.buttonName || '-'}`,
        `Button ID: ${m.buttonId || '-'}`,
        `Selected row: ${m.selectedRowId || '-'}`,
        `Native Flow params: ${response ? JSON.stringify(response.params).slice(0, 2500) : '-'}`,
        `Quoted message: ${m.quoted?.id || '-'}`,
        `Mentions: ${(m.mentionedJid || []).join(', ') || '-'}`
      ].join('\n'));
    }

    case 'response':
    case 'callback': {
      const label = text || m.buttonId || m.body || 'tidak diketahui';
      logger.info({ testId: 'nativeflow-callback', action: m.buttonName || 'unknown', selectedId: label, messageId: m.id || null }, 'Native-flow test callback received');
      return { handled: true, test: 'callback' };
    }

    case 'nativeflow1':
    case 'nf1': return sendNativeFlowTests(sock, m, '1');
    case 'nativeflow2':
    case 'nf2': return sendNativeFlowTests(sock, m, '2');
    case 'nativeflow3':
    case 'nf3': return sendNativeFlowTests(sock, m, '3');
    case 'nativeflow4':
    case 'nf4': return sendNativeFlowTests(sock, m, '4');
    case 'nativeflow5':
    case 'nf5': return sendNativeFlowTests(sock, m, '5');
    case 'nativeflowall':
    case 'nf': return sendNativeFlowTests(sock, m, 'all');

    case 'button': {
      const label = text || 'Halo dari Ocha';
      return sock.buttonBuilder()
        .setTitle('Button Builder Test')
        .setBody(label)
        .setFooter('Native Flow · Quick Reply')
        .addReply('Balas HALO', '.test response button_halo')
        .send(m.chat, { quoted: m });
    }

    case 'quick_reply':
    case 'quick-reply': {
      return sock.buttonBuilder()
        .setTitle('Quick Reply Test')
        .setBody(text || 'Tekan tombol untuk mengirim respons cepat.')
        .addReply('Pilih 1', '.test response quick_1')
        .addReply('Pilih 2', '.test response quick_2')
        .send(m.chat, { quoted: m });
    }

    case 'nativeflow': {
      const target = String(args[0] || '').toLowerCase();
      if (target === 'all' || /^[1-5]$/.test(target)) return sendNativeFlowTests(sock, m, target);
      const url = requireUrl(args[0] || DEFAULT_TEST_URL, 'URL');
      return sock.buttonBuilder()
        .setTitle('Native Flow Test')
        .setBody('Pengujian beberapa action native-flow dalam satu pesan.')
        .setFooter('Quick reply · URL · Call · Copy')
        .addReply('Quick Reply', '.test response native_quick_reply')
        .addUrl('Buka URL', url)
        .addCall('Telepon Owner', OWNER_PHONE)
        .addCopy('Salin kode', 'OCHA-TEST-01')
        .send(m.chat, { quoted: m });
    }

    case 'cta_url':
    case 'url': {
      const url = requireUrl(args[0] || DEFAULT_TEST_URL, 'URL');
      return sock.buttonBuilder()
        .setTitle('CTA URL Test')
        .setBody('Tombol membuka URL melalui handler WhatsApp.')
        .addUrl('Buka tautan', url)
        .send(m.chat, { quoted: m });
    }

    case 'cta_call':
    case 'call': {
      const phone = requirePhone(args[0] || OWNER_PHONE);
      return sock.buttonBuilder()
        .setTitle('CTA Call Test')
        .setBody(`Uji action panggilan ke +${phone}.`)
        .addCall('Telepon', phone)
        .send(m.chat, { quoted: m });
    }

    case 'selection': {
      return sock.buttonBuilder()
        .setTitle('Native Flow Selection Test')
        .setBody('Pilih salah satu opsi dari daftar.')
        .addSelection('Pilih opsi')
        .makeSection('Pilihan')
        .makeRow('', 'Opsi pertama', 'Baris pertama', '.test response selection_1')
        .makeRow('', 'Opsi kedua', 'Baris kedua', '.test response selection_2')
        .send(m.chat, { quoted: m });
    }

    case 'location_button':
    case 'send_location_button': {
      return sock.buttonBuilder()
        .setTitle('Location Request Test')
        .setBody('Uji tombol native-flow untuk meminta lokasi.')
        .addButton('send_location', { display_text: 'Kirim lokasi' })
        .send(m.chat, { quoted: m });
    }

    case 'address_button': {
      return sock.buttonBuilder()
        .setTitle('Address Message Test')
        .setBody('Uji action address_message pada native-flow.')
        .addButton('address_message', { display_text: 'Isi alamat', id: '.test response address_form' })
        .send(m.chat, { quoted: m });
    }

    case 'catalog_button': {
      return sock.buttonBuilder()
        .setTitle('Catalog CTA Test')
        .setBody('Uji CTA katalog; hasil bergantung pada fitur katalog akun WhatsApp.')
        .addButton('cta_catalog', { business_phone_number: OWNER_PHONE })
        .send(m.chat, { quoted: m });
    }

    case 'legacy_button': {
      return sendGenerated(sock, m, {
        buttonsMessage: {
          contentText: text || 'Legacy buttonsMessage test (compatibility only).',
          footerText: 'Legacy / buttonsMessage',
          headerType: 1,
          buttons: [
            { buttonId: '.test response legacy_1', buttonText: { displayText: 'Tombol lama 1' }, type: 1 },
            { buttonId: '.test response legacy_2', buttonText: { displayText: 'Tombol lama 2' }, type: 1 }
          ]
        }
      });
    }

    case 'image': {
      const image = args[0] ? { url: requireUrl(args[0], 'Image URL') } : await readTestAsset('sample-image.png');
      return sock.sendMessage(m.chat, { image, caption: 'Ocha image test asset' }, { quoted: m });
    }

    case 'video': {
      const video = args[0] ? { url: requireUrl(args[0], 'Video URL') } : await readTestAsset('sample-video.mp4');
      return sock.sendMessage(m.chat, { video, mimetype: 'video/mp4', caption: 'Ocha video test asset' }, { quoted: m });
    }

    case 'audio': {
      const audio = args[0] ? { url: requireUrl(args[0], 'Audio URL') } : await readTestAsset('sample-audio.wav');
      return sock.sendMessage(m.chat, { audio, mimetype: 'audio/wav', ptt: false }, { quoted: m });
    }

    case 'document': {
      const document = args[0] ? { url: requireUrl(args[0], 'Document URL') } : await readTestAsset('sample-document.pdf');
      const fileName = args[1] || 'ocha-message-test.pdf';
      return sock.sendMessage(m.chat, { document, fileName, mimetype: 'application/pdf', caption: 'Ocha local document test asset' }, { quoted: m });
    }

    case 'sticker': {
      const sticker = args[0] ? { url: requireUrl(args[0], 'Sticker URL') } : await readTestAsset('sample-sticker.webp');
      return sock.sendMessage(m.chat, { sticker }, { quoted: m });
    }

    case 'location': {
      const latitude = args[0] === undefined ? 0 : Number(args[0]);
      const longitude = args[1] === undefined ? 0 : Number(args[1]);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw new Error('Koordinat harus dalam rentang geografis yang valid.');
      }
      const name = args.slice(2).join(' ') || 'Ocha Test Coordinate';
      return sock.sendMessage(m.chat, { location: { degreesLatitude: latitude, degreesLongitude: longitude, name } }, { quoted: m });
    }

    case 'contact': {
      return m.sendContact({ number: OWNER_PHONE, displayName: 'Owner Ocha Lidya', organization: 'Razzaq Ventures' }, { quoted: m });
    }

    case 'reminder': {
      return sock.buttonBuilder()
        .setTitle('Reminder Button Test')
        .setBody(text || 'Uji tombol pengingat pada klien WhatsApp yang mendukung native-flow reminder.')
        .addReminder('Atur pengingat', { id: '.test response reminder_set' })
        .addCancelReminder('Batalkan pengingat', { id: '.test response reminder_cancel' })
        .send(m.chat, { quoted: m });
    }

    case 'hydrated':
    case 'template': {
      const body = text || 'Contoh Hydrated Four Row Template dari WAProto.';
      return sendGenerated(sock, m, {
        templateMessage: {
          hydratedTemplate: {
            hydratedTitleText: 'Hydrated Template Test',
            hydratedContentText: body,
            hydratedFooterText: 'Template Button · Baileys',
            hydratedButtons: [
              { index: 0, quickReplyButton: { displayText: 'Quick Reply', id: '.test response hydrated_reply' } },
              { index: 1, urlButton: { displayText: 'Buka URL', url: DEFAULT_TEST_URL } },
              { index: 2, callButton: { displayText: 'Telepon Owner', phoneNumber: OWNER_PHONE } }
            ]
          }
        }
      });
    }

    case 'event':
    case 'date': {
      const dateIndex = args.findIndex(value => /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value));
      const name = (dateIndex >= 0 ? args.slice(0, dateIndex) : args).join(' ') || 'Ocha Calendar Test';
      const dateValue = dateIndex >= 0 ? args[dateIndex] : '';
      const parsedDate = dateValue ? new Date(dateValue) : new Date(Date.now() + 60 * 60_000);
      if (Number.isNaN(parsedDate.getTime())) throw new Error('Tanggal tidak valid. Gunakan ISO-8601, contoh 2026-11-20T10:00:00+07:00.');
      const endDate = new Date(parsedDate.getTime() + 60 * 60_000);
      return sock.sendMessage(m.chat, {
        event: {
          name,
          description: 'Pengujian Event Message / tanggal dan waktu.',
          startDate: parsedDate,
          endDate,
          extraGuestsAllowed: true
        }
      }, { quoted: m });
    }

    case 'poll': {
      const parts = text.split('|').map(part => part.trim()).filter(Boolean);
      const name = parts[0] || 'Apakah test poll berjalan?';
      const values = parts.length > 1 ? parts.slice(1) : ['Berjalan', 'Tidak berjalan'];
      if (values.length < 2 || values.length > 12) throw new Error('Poll harus memiliki 2-12 opsi. Format: .test poll Pertanyaan | Opsi A | Opsi B');
      return sock.sendMessage(m.chat, { poll: { name, values, selectableCount: 1 } }, { quoted: m });
    }

    case 'circle':
    case 'ptv': {
      const url = requireUrl(args[0] || '', 'Video URL');
      return sock.sendMessage(m.chat, { video: { url }, ptv: true }, { quoted: m });
    }

    case 'viewonce':
    case 'view_once': {
      const url = requireUrl(args[0] || '', 'Image URL');
      return sock.sendMessage(m.chat, { image: { url }, viewOnce: true, caption: 'View Once test' }, { quoted: m });
    }

    case 'airich':
    case 'rich': {
      const rich = sock.airich()
        .setTitle('Nexora AI Rich Test')
        .setBody(text || 'Rich response test')
        .addText(text || 'Contoh AI Rich text dengan markdown dan hyperlink.')
        .addCode('javascript', 'const answer = "Nexora";\nconsole.log(answer);');
      return rich.send(m.chat, { quoted: m, forwarded: false, notification: false });
    }

    case 'carousel':
      return sendCarouselTest(sock, m);

    default:
      return sendTestMenu(sock, m);
  }
}

export const messageTestTestHooks = Object.freeze({
  catalog: () => NUMBERED_TESTS.map(item => ({ ...item })),
  sendTestMenu,
  runNumberedTest,
  runTestSelection
});

export default {
  name: 'test',
  fullButton: false,
  aliases: ['testmsg', 'messagetest'],
  category: 'owner',
  ownerOnly: true,
  privateOnly: true,
  usage: '[pilihan dari daftar]',
  description: 'Message Test Lab: daftar native-flow, buttons, poll, media, carousel, dan format pesan WhatsApp',
  async execute({ sock, m, args }) {
    const [type = 'menu', ...options] = args;
    const normalizedType = String(type || 'menu').toLowerCase();
    try {
      if (normalizedType === 'menu' || normalizedType === 'help') return await sendTestMenu(sock, m, 1);
      if (normalizedType === 'page') return await sendTestMenu(sock, m, options[0]);
      if (normalizedType === 'select') return await runTestSelection(sock, m, options[0]);
      const result = await runTest(sock, m, normalizedType, options);
      if (result?.handled) {
        const resultIds = result.resultIds || (result.resultId ? [result.resultId] : result.key?.id ? [result.key.id] : []);
        if (resultIds.length) logger.info({ testId: result.test || normalizedType, resultIds, success: result.success !== false }, 'Message test payloads completed');
        else logger.debug({ testId: result.test || normalizedType, success: result.success !== false }, 'Message test completed without a result ID');
      }
      return result;
    } catch (error) {
      logger.error({ err: error, testId: normalizedType, chat: m.chat }, 'Message test command failed');
      return { handled: true, test: normalizedType, success: false };
    }
  }
};
