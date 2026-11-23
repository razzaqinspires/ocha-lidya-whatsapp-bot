import { proto, generateWAMessageFromContent } from '@whiskeysockets/baileys';

const OWNER_PHONE = '6283193905842';
const DEFAULT_TEST_URL = 'https://example.com';

const HELP = [
  '*OCHA TEST MESSAGE LAB*',
  'Command owner-only untuk menguji format pesan Baileys.',
  '',
  '.test types',
  '.test identity  (JID PN/LID, addressing mode, sender, bot, message)',
  '.test inspect   (payload serializer dan tombol terpilih)',
  '.test button [teks]',
  '.test hydrated [teks]',
  '.test nativeflow [url] | all | 1-5',
  '.test quick_reply [teks]',
  '.test cta_url <https-url>',
  '.test cta_call <nomor>',
  '.test selection',
  '.test location_button',
  '.test address_button',
  '.test catalog_button',
  '.test legacy_button [teks]',
  '.test image <url>',
  '.test video <url>',
  '.test audio <url>',
  '.test document <url>',
  '.test sticker <webp-url>',
  '.test location <latitude> <longitude> [nama]',
  '.test contact',
  '.test reminder [teks]',
  '.test date [nama acara] [ISO-date]',
  '.test event [nama acara] [ISO-date]',
  '.test poll [pertanyaan | opsi 1 | opsi 2]',
  '.test circle <video-url>',
  '.test viewonce <image-url>',
  '.test airich [teks]',
  '.test carousel [thumbnail-url-1] [thumbnail-url-2]',
  '.test nativeflow all | 1 | 2 | 3 | 4 | 5',
  '.test identity',
  '.test inspect',
  '.test response <label>  (dipanggil saat quick-reply/list test diklik)',
  '.test stubtypes',
  '',
  'Media URL wajib dapat diakses server dan memiliki MIME type yang sesuai.'
].join('\n');

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
  if (indexes.some(index => !Number.isInteger(index) || index < 0 || index > 4)) throw new Error('Pilih .test nativeflow all atau nomor 1 sampai 5.');
  const results = [];
  for (const index of indexes) {
    const page = pages[index];
    try {
      await sendNativeFlowPage(sock, m, page);
      results.push(`Bagian ${index + 1}/5: terkirim ke relay`);
    } catch (error) {
      results.push(`Bagian ${index + 1}/5: gagal — ${String(error.message || error).slice(0, 180)}`);
    }
    if (indexes.length > 1) await new Promise(resolve => setTimeout(resolve, 450));
  }
  return m.reply(`*Hasil Native Flow Test*\n${results.join('\n')}\n\nStatus relay bukan bukti bahwa semua tombol akan dirender atau berfungsi pada setiap klien WhatsApp.`);
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
    case '':
      return m.reply(HELP);

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
      return m.reply(`*Native Flow callback diterima*\nAction: ${m.buttonName || 'quick_reply / single_select'}\nID: ${label}\nSender: ${m.sender || '-'}\nChat: ${m.chat || '-'}\n\nSerializer berhasil mengubah respons tombol menjadi teks command yang dapat diproses dispatcher.`);
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
      const url = requireUrl(args[0] || '', 'Image URL');
      return sock.sendMessage(m.chat, { image: { url }, caption: args.slice(1).join(' ').trim() || 'Image message test' }, { quoted: m });
    }

    case 'video': {
      const url = requireUrl(args[0] || '', 'Video URL');
      return sock.sendMessage(m.chat, { video: { url }, caption: args.slice(1).join(' ').trim() || 'Video message test' }, { quoted: m });
    }

    case 'audio': {
      const url = requireUrl(args[0] || '', 'Audio URL');
      return sock.sendMessage(m.chat, { audio: { url }, mimetype: 'audio/mpeg', ptt: false }, { quoted: m });
    }

    case 'document': {
      const url = requireUrl(args[0] || '', 'Document URL');
      const fileName = args[1] || 'ocha-message-test.pdf';
      return sock.sendMessage(m.chat, { document: { url }, fileName, mimetype: 'application/pdf', caption: 'Document test' }, { quoted: m });
    }

    case 'sticker': {
      const url = requireUrl(args[0] || '', 'Sticker URL');
      return sock.sendMessage(m.chat, { sticker: { url } }, { quoted: m });
    }

    case 'location': {
      const latitude = Number(args[0]);
      const longitude = Number(args[1]);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw new Error('Gunakan .test location <latitude> <longitude> [nama]. Koordinat harus dalam rentang geografis yang valid.');
      }
      const name = args.slice(2).join(' ') || 'Test location';
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

    case 'carousel': {
      const images = [
        requireUrl(args[0] || 'https://github.com/razzaqinspires.png', 'Thumbnail 1'),
        requireUrl(args[1] || 'https://avatars.githubusercontent.com/u/9919?v=4', 'Thumbnail 2')
      ];
      const builder = sock.carouselBuilder()
        .setTitle('Carousel Test')
        .setBody('Uji carousel native interaktif dengan gambar yang diunggah sebagai imageMessage.')
        .setFooter('Ocha Lidya AI · Razzaq Ventures');
      builder.addCard([
        {
          header: { title: 'Card 1 · Nexora AI', subtitle: 'WhatsApp Automation', imageUrl: images[0] },
          body: { text: 'Uji gambar carousel, body, footer dan callback quick-reply.' },
          footer: { text: 'Kartu 1/2' },
          nativeFlowMessage: { buttons: [nativeButton('quick_reply', { display_text: 'Pilih Nexora', id: '.test response carousel_nexora' }), nativeButton('cta_url', { display_text: 'Buka GitHub', url: 'https://github.com/razzaqinspires', merchant_url: 'https://github.com/razzaqinspires' })] }
        },
        {
          header: { title: 'Card 2 · Lumóra', subtitle: 'Aromatherapy Craft', imageUrl: images[1] },
          body: { text: 'Kartu kedua untuk memastikan gambar dan tombol tiap kartu tidak tertukar.' },
          footer: { text: 'Kartu 2/2' },
          nativeFlowMessage: { buttons: [nativeButton('quick_reply', { display_text: 'Pilih Lumóra', id: '.test response carousel_lumora' }), nativeButton('cta_copy', { display_text: 'Salin Kode', copy_code: 'LUMORA-01' })] }
        }
      ]);
      return builder.send(m.chat, { quoted: m });
    }

    default:
      return m.reply(`Tipe test tidak dikenal: *${type}*\n\n${HELP}`);
  }
}

export default {
  name: 'test',
  fullButton: false, aliases: ['testmsg', 'messagetest'], category: 'owner', ownerOnly: true, usage: '<type> [args]',
  description: 'Laboratorium uji serializer dan format pesan Baileys',
  async execute({ sock, m, args }) {
    const [type = 'help', ...options] = args;
    try {
      await runTest(sock, m, type.toLowerCase(), options);
    } catch (error) {
      await m.reply(`Test *${type}* gagal dijalankan.\n${error.message || error}`);
    }
  }
};
