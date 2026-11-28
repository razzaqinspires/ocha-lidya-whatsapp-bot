import { getConfig, updateConfig, configDefaults } from '../../config.js';
import { getPrefixes } from '../../core/prefix.js';
import { isVerifiedOwnerMessage } from '../../core/identity.js';
import { MENU_FONTS, MENU_TEMPLATES, applyMenuFont } from '../../core/menu-renderer.js';

const TEMPLATE_NAMES = Object.keys(MENU_TEMPLATES);
const FONT_NAMES = Object.keys(MENU_FONTS);

function commandPrefix() {
  return getPrefixes()[0] || '';
}

function makeRows(items, prefix, groupSize = 8) {
  const sections = [];
  for (let offset = 0; offset < items.length; offset += groupSize) {
    sections.push({
      title: items.length > groupSize ? `Pilihan ${Math.floor(offset / groupSize) + 1}` : 'Pilihan',
      rows: items.slice(offset, offset + groupSize),
    });
  }
  return sections;
}

function row(prefix, title, description, command) {
  return {
    id: `${prefix}${command}`,
    title: String(title).slice(0, 24),
    description: String(description || '').slice(0, 72),
  };
}

function buildSettingsSections(menu, prefix) {
  const templateRows = TEMPLATE_NAMES.map(name =>
    row(prefix, `${menu.template === name ? '✓ ' : ''}${name}`, `Terapkan tema ${name}`, `setmenu template ${name}`),
  );
  const fontRows = FONT_NAMES.map(name =>
    row(
      prefix,
      `${menu.font === name ? '✓ ' : ''}${name}`,
      `Preview: ${applyMenuFont('Ocha Menu 0123', name)}`,
      `setmenu font ${name}`,
    ),
  );
  const layoutRows = [
    row(prefix, `Urutan: ${menu.order}`, 'Pilih urutan kategori, A–Z, atau Z–A', 'setmenu order'),
    row(
      prefix,
      `Deskripsi: ${menu.showDescriptions ? 'ON' : 'OFF'}`,
      'Tampilkan deskripsi setiap command',
      `setmenu descriptions ${menu.showDescriptions ? 'off' : 'on'}`,
    ),
    row(
      prefix,
      `Garis atas: ${menu.topBorder !== false ? 'ON' : 'OFF'}`,
      'Tampilkan garis pembuka tema',
      `setmenu border top ${menu.topBorder === false ? 'on' : 'off'}`,
    ),
    row(
      prefix,
      `Garis bawah: ${menu.bottomBorder !== false ? 'ON' : 'OFF'}`,
      'Tampilkan garis penutup tema',
      `setmenu border bottom ${menu.bottomBorder === false ? 'on' : 'off'}`,
    ),
    row(prefix, `Jarak antarbaris: ${menu.spacing ?? 0}`, 'Pilih tingkat jarak 0–3', 'setmenu spacing'),
    row(
      prefix,
      `Pagination teks: ${menu.pagination.enabled ? 'ON' : 'OFF'}`,
      'Aktifkan halaman pada menu teks; Flow native tetap memakai halaman agar sesuai batas baris WhatsApp',
      `setmenu pages ${menu.pagination.enabled ? 'off' : 'on'}`,
    ),
    row(
      prefix,
      `Batas halaman teks: ${menu.pagination.pageSize}`,
      'Pilih jumlah command per halaman pada fallback teks',
      'setmenu limit',
    ),
    row(prefix, 'Ringkasan konfigurasi', 'Lihat pengaturan yang tersimpan', 'setmenu status'),
    row(prefix, 'Reset tampilan menu', 'Kembalikan konfigurasi menu ke default Ocha', 'setmenu reset'),
  ];
  const orderRows = ['category', 'az', 'za'].map(order =>
    row(
      prefix,
      `${menu.order === order ? '✓ ' : ''}${order.toUpperCase()}`,
      `Gunakan urutan ${order}`,
      `setmenu order ${order}`,
    ),
  );
  const spacingRows = [0, 1, 2, 3].map(spacing =>
    row(
      prefix,
      `${menu.spacing === spacing ? '✓ ' : ''}Jarak ${spacing}`,
      `Jarak antarbaris: ${spacing}`,
      `setmenu spacing ${spacing}`,
    ),
  );
  const limitRows = [10, 25, 50, 100, 200].map(limit =>
    row(
      prefix,
      `${menu.pagination.pageSize === limit ? '✓ ' : ''}${limit} command`,
      `Batas per halaman: ${limit}`,
      `setmenu limit ${limit}`,
    ),
  );
  return [
    ...makeRows(templateRows, prefix).map((section, index) => ({ ...section, title: `Tema ${index + 1}` })),
    ...makeRows(fontRows, prefix).map((section, index) => ({ ...section, title: `Font ${index + 1}` })),
    { title: 'Tata letak & konten', rows: layoutRows },
    { title: 'Urutan command', rows: orderRows },
    { title: 'Jarak antarbaris', rows: spacingRows },
    { title: 'Batas halaman', rows: limitRows },
  ];
}

function settingsSummary(menu) {
  return [
    'GLOBAL MENU SETTINGS',
    `Tema: ${menu.template}`,
    `Font: ${menu.font}`,
    `Urutan: ${menu.order}`,
    `Deskripsi: ${menu.showDescriptions ? 'ON' : 'OFF'}`,
    `Garis atas/bawah: ${menu.topBorder !== false ? 'ON' : 'OFF'} / ${menu.bottomBorder !== false ? 'ON' : 'OFF'}`,
    `Jarak: ${menu.spacing}`,
    `Pagination teks: ${menu.pagination.enabled ? 'ON' : 'OFF'}`,
    `Batas halaman teks: ${menu.pagination.pageSize}`,
    'Flow native: halaman otomatis (7 command per halaman) mengikuti batas baris WhatsApp.',
    '',
    'Perubahan berlaku global setelah disimpan ke config event store Ocha.',
  ].join('\n');
}

async function showPicker(sock, m, menu) {
  const prefix = commandPrefix();
  const payload = {
    title: 'OCHA LIDYA · MENU DESIGN',
    subtitle: 'NEXORA · GLOBAL DISPLAY SETTINGS',
    body: `${settingsSummary(menu)}\n\nPilih tema atau pengaturan melalui daftar. Command dan alias tetap berasal dari plugin registry Ocha.`,
    footer: 'OWNER ONLY · PRIVATE CHAT',
    buttons: [
      {
        name: 'single_select',
        buttonParamsJson: JSON.stringify({
          title: 'Pengaturan Menu',
          sections: buildSettingsSections(menu, prefix),
        }),
      },
    ],
  };
  if (typeof sock?.sendInteractive === 'function') {
    try {
      return await sock.sendInteractive(m.chat, payload, m);
    } catch {}
  }
  return m.reply(`${settingsSummary(menu)}\n\n${usageText(prefix)}`);
}

function usageText(prefix) {
  return [
    'SET MENU · COMMANDS',
    `${prefix}setmenu`,
    `${prefix}setmenu template <${TEMPLATE_NAMES.join('|')}>`,
    `${prefix}setmenu font <${FONT_NAMES.join('|')}>`,
    `${prefix}setmenu order <category|az|za>`,
    `${prefix}setmenu descriptions <on|off>`,
    `${prefix}setmenu pages <on|off>`,
    `${prefix}setmenu limit <10-200>`,
    `${prefix}setmenu spacing <0-3>`,
    `${prefix}setmenu border <top|bottom> <on|off>`,
    `${prefix}setmenu status`,
    `${prefix}setmenu reset`,
  ].join('\n');
}

async function persistMenuSetting(m, mutate, reason) {
  await updateConfig(
    config => {
      config.menu ||= structuredClone(configDefaults.menu);
      mutate(config.menu);
    },
    { actor: m.sender || 'verified-owner', reason },
  );
}

export default {
  name: 'setmenu',
  aliases: ['menuset', 'menuconfig'],
  category: 'owner',
  ownerOnly: true,
  privateOnly: true,
  usage: '[template|font|order|descriptions|pages|limit|spacing|border|status|reset]',
  description: 'Atur desain dan tata letak menu command Ocha secara global.',
  async execute({ sock, m, args }) {
    const config = getConfig();
    if (!isVerifiedOwnerMessage(m, config.bot.owner)) {
      return m.reply('Akses ditolak. Identitas owner tidak dapat diverifikasi.');
    }
    if (m.isGroup || String(m.chat || '').endsWith('@g.us')) {
      return m.reply('Pengaturan menu hanya dapat dijalankan melalui chat pribadi owner.');
    }

    const [rawKey = 'menu', rawValue = '', rawExtra = ''] = args;
    const key = String(rawKey).toLowerCase();
    const value = String(rawValue).toLowerCase();
    const extra = String(rawExtra).toLowerCase();
    const menu = config.menu || structuredClone(configDefaults.menu);
    const prefix = commandPrefix();

    if (['menu', 'show', 'help'].includes(key)) return showPicker(sock, m, menu);
    if (['status', 'summary'].includes(key)) return m.reply(settingsSummary(menu));

    if (key === 'template') {
      if (!TEMPLATE_NAMES.includes(value)) return m.reply(`Tema tidak dikenal.\n${usageText(prefix)}`);
      await persistMenuSetting(
        m,
        target => {
          target.template = value;
        },
        `menu template changed to ${value}`,
      );
    } else if (key === 'font') {
      if (!FONT_NAMES.includes(value)) return m.reply(`Font tidak dikenal.\n${usageText(prefix)}`);
      await persistMenuSetting(
        m,
        target => {
          target.font = value;
        },
        `menu font changed to ${value}`,
      );
    } else if (key === 'order') {
      if (!['category', 'az', 'za'].includes(value)) {
        const rows = ['category', 'az', 'za'].map(order =>
          row(
            prefix,
            `${menu.order === order ? '✓ ' : ''}${order.toUpperCase()}`,
            `Urutkan menu: ${order}`,
            `setmenu order ${order}`,
          ),
        );
        const payload = {
          title: 'Urutan Command',
          body: `Urutan aktif: ${menu.order}`,
          footer: 'Pilih pola pengurutan.',
          buttons: [
            {
              name: 'single_select',
              buttonParamsJson: JSON.stringify({ title: 'Urutan', sections: [{ title: 'Pola', rows }] }),
            },
          ],
        };
        if (typeof sock?.sendInteractive === 'function') {
          try {
            return await sock.sendInteractive(m.chat, payload, m);
          } catch {}
        }
        return m.reply(`Urutan saat ini: ${menu.order}\nGunakan .setmenu order category|az|za`);
      }
      await persistMenuSetting(
        m,
        target => {
          target.order = value;
        },
        `menu order changed to ${value}`,
      );
    } else if (key === 'descriptions' || key === 'pages') {
      if (!['on', 'off'].includes(value)) return m.reply(`Gunakan: ${prefix}setmenu ${key} on|off`);
      await persistMenuSetting(
        m,
        target => {
          if (key === 'descriptions') target.showDescriptions = value === 'on';
          else target.pagination.enabled = value === 'on';
        },
        `menu ${key} ${value}`,
      );
    } else if (key === 'limit') {
      if (!rawValue) {
        const rows = [10, 25, 50, 100, 200].map(limit =>
          row(
            prefix,
            `${menu.pagination.pageSize === limit ? '✓ ' : ''}${limit} command`,
            `Batas per halaman ${limit}`,
            `setmenu limit ${limit}`,
          ),
        );
        const payload = {
          title: 'Batas Halaman Menu',
          body: `Batas saat ini: ${menu.pagination.pageSize}`,
          footer: 'Pilih jumlah command per halaman.',
          buttons: [
            {
              name: 'single_select',
              buttonParamsJson: JSON.stringify({ title: 'Pilih batas', sections: [{ title: 'Batas halaman', rows }] }),
            },
          ],
        };
        if (typeof sock?.sendInteractive === 'function') {
          try {
            return await sock.sendInteractive(m.chat, payload, m);
          } catch {}
        }
        return m.reply(`${usageText(prefix)}\nBatas saat ini: ${menu.pagination.pageSize}`);
      }
      const limit = Number(rawValue);
      if (!Number.isInteger(limit) || limit < 10 || limit > 200)
        return m.reply(`Batas halaman harus bilangan bulat 10–200. Contoh: ${prefix}setmenu limit 50`);
      await persistMenuSetting(
        m,
        target => {
          target.pagination.pageSize = limit;
        },
        `menu page size changed to ${limit}`,
      );
    } else if (key === 'spacing') {
      if (!rawValue) {
        const rows = [0, 1, 2, 3].map(spacing =>
          row(
            prefix,
            `${menu.spacing === spacing ? '✓ ' : ''}Jarak ${spacing}`,
            `Tingkat jarak ${spacing}`,
            `setmenu spacing ${spacing}`,
          ),
        );
        const payload = {
          title: 'Jarak Menu',
          body: `Jarak saat ini: ${menu.spacing}`,
          footer: 'Pilih jarak antarbaris.',
          buttons: [
            {
              name: 'single_select',
              buttonParamsJson: JSON.stringify({ title: 'Pilih jarak', sections: [{ title: 'Jarak', rows }] }),
            },
          ],
        };
        if (typeof sock?.sendInteractive === 'function') {
          try {
            return await sock.sendInteractive(m.chat, payload, m);
          } catch {}
        }
        return m.reply(`${usageText(prefix)}\nJarak saat ini: ${menu.spacing}`);
      }
      const spacing = Number(rawValue);
      if (!Number.isInteger(spacing) || spacing < 0 || spacing > 3)
        return m.reply(`Jarak harus bilangan bulat 0–3. Contoh: ${prefix}setmenu spacing 1`);
      await persistMenuSetting(
        m,
        target => {
          target.spacing = spacing;
        },
        `menu spacing changed to ${spacing}`,
      );
    } else if (key === 'border') {
      if (!['top', 'bottom'].includes(value) || !['on', 'off'].includes(extra))
        return m.reply(`Gunakan: ${prefix}setmenu border top|bottom on|off`);
      await persistMenuSetting(
        m,
        target => {
          target[value === 'top' ? 'topBorder' : 'bottomBorder'] = extra === 'on';
        },
        `menu ${value} border ${extra}`,
      );
    } else if (key === 'reset') {
      await persistMenuSetting(
        m,
        target => {
          Object.assign(target, structuredClone(configDefaults.menu));
        },
        'menu display settings reset to shipped defaults',
      );
    } else {
      return m.reply(usageText(prefix));
    }

    const updated = getConfig().menu;
    return m.reply(
      `Pengaturan menu berhasil disimpan.\n\n${settingsSummary(updated)}\n\nJalankan ${prefix}menu untuk melihat hasilnya.`,
    );
  },
};

export const setMenuTestHooks = Object.freeze({ buildSettingsSections, settingsSummary, usageText });
