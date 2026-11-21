import { proto, generateWAMessageFromContent } from '@whiskeysockets/baileys';

const OWNER_PHONE = '6283193905842';
const DEFAULT_TEST_URL = 'https://example.com';

const HELP = [
  '*OCHA TEST MESSAGE LAB*',
  'Command owner-only untuk menguji format pesan Baileys.',
  '',
  '.test types',
  '.test button [teks]',
  '.test hydrated [teks]',
  '.test nativeflow [url]',
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
  '.test carousel',
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

async function sendGenerated(sock, m, content) {
  if (typeof sock.relayMessage !== 'function') throw new Error('Socket tidak memiliki relayMessage().');
  const userJid = sock.user?.id || sock.authState?.creds?.me?.id;
  const generated = generateWAMessageFromContent(m.chat, proto.Message.create(content), {
    userJid,
    timestamp: new Date(),
    quoted: m
  });
  return sock.relayMessage(m.chat, generated.message, { messageId: generated.key.id });
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

    case 'button': {
      const label = text || 'Halo dari Ocha';
      return sock.buttonBuilder()
        .setTitle('Button Builder Test')
        .setBody(label)
        .setFooter('Native Flow · Quick Reply')
        .addReply('Balas HALO', 'test:button:halo')
        .send(m.chat, { quoted: m });
    }

    case 'quick_reply':
    case 'quick-reply': {
      return sock.buttonBuilder()
        .setTitle('Quick Reply Test')
        .setBody(text || 'Tekan tombol untuk mengirim respons cepat.')
        .addReply('Pilih 1', 'test:quick:1')
        .addReply('Pilih 2', 'test:quick:2')
        .send(m.chat, { quoted: m });
    }

    case 'nativeflow': {
      const url = requireUrl(args[0] || DEFAULT_TEST_URL, 'URL');
      return sock.buttonBuilder()
        .setTitle('Native Flow Test')
        .setBody('Pengujian beberapa action native-flow dalam satu pesan.')
        .setFooter('Quick reply · URL · Call · Copy')
        .addReply('Quick Reply', 'test:native:quick')
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
        .makeRow('', 'Opsi pertama', 'Baris pertama', 'test:selection:1')
        .makeRow('', 'Opsi kedua', 'Baris kedua', 'test:selection:2')
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
        .addButton('address_message', { display_text: 'Isi alamat' })
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
            { buttonId: 'test:legacy:1', buttonText: { displayText: 'Tombol lama 1' }, type: 1 },
            { buttonId: 'test:legacy:2', buttonText: { displayText: 'Tombol lama 2' }, type: 1 }
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
        .addReminder('Atur pengingat')
        .addCancelReminder('Batalkan pengingat')
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
              { index: 0, quickReplyButton: { displayText: 'Quick Reply', id: 'test:hydrated:reply' } },
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
      const builder = sock.carouselBuilder()
        .setTitle('Carousel Test')
        .setBody('Uji carousel multi-card native interactive message.')
        .setFooter('Carousel · 2 cards');
      builder.addCard([
        {
          header: { title: 'Card 1', hasMediaAttachment: false },
          body: { text: 'Kartu pertama untuk pengujian.' },
          footer: { text: 'Ocha Lidya' },
          nativeFlowMessage: { buttons: [{ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Pilih 1', id: 'test:carousel:1' }) }] }
        },
        {
          header: { title: 'Card 2', hasMediaAttachment: false },
          body: { text: 'Kartu kedua untuk pengujian.' },
          footer: { text: 'Nexora' },
          nativeFlowMessage: { buttons: [{ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Pilih 2', id: 'test:carousel:2' }) }] }
        }
      ]);
      return builder.send(m.chat, { quoted: m });
    }

    default:
      return m.reply(`Tipe test tidak dikenal: *${type}*\n\n${HELP}`);
  }
}

export default {
  name: 'test', aliases: ['testmsg', 'messagetest'], category: 'owner', ownerOnly: true, usage: '<type> [args]',
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
