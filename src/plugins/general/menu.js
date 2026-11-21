import { sendCommandList } from '../../core/ui.js';
import { getPrefixes } from '../../core/prefix.js';

export default {
  name: 'menu', aliases: ['help', 'commands'], category: 'general', description: 'Daftar perintah Ocha Lidya',
  async execute({ sock, m, config }) {
    const prefix = getPrefixes()[0] || '';
    const body = [
      '*GENERAL*',
      `${prefix}menu · daftar perintah`,
      `${prefix}ping · latency`,
      `${prefix}owner · kontak owner`,
      `${prefix}about · informasi bot dan pembuat`,
      `${prefix}profile · XP, level, role, dan rank`,
      `${prefix}runtime · informasi runtime`,
      `${prefix}run python/node/html · jalankan kode & buat preview web sementara`,
      `${prefix}project list/status · repository website pribadimu`,
      `${prefix}project use <slug> · lanjutkan repository`,
      `${prefix}project zip · ekspor source repository saja`,
      `${prefix}project export ask/always/off · atur pengiriman ZIP`,
      `${prefix}groupinfo · daftar grup dan status aktif/mute`,
      '',
      '*OWNER / DEVELOPER*',
      `${prefix}setmode · public/self`,
      `${prefix}setprefix · konfigurasi prefix`,
      `${prefix}setbotname · ubah nama bot`,
      `${prefix}plugins · daftar plugin`,
      `${prefix}reload · reload plugin`,
      `${prefix}jid · inspect PN/LID`,
      `${prefix}dbstatus · kesehatan database`,
      `${prefix}dbsearch · cari arsip`,
      `${prefix}aistatus / ${prefix}aiset · pengaturan AI`,
      `${prefix}buttons on/off · mode tombol`,
      `${prefix}master status · status console runner`,
      `${prefix}joingc <url> · bot bergabung ke grup (owner)`,
      `${prefix}mute on/off/status · atur grup ini langsung dari dalam grup (owner)`,
      `${prefix}nexora status · panel kontrol Nexora global (owner)`,
      `${prefix}nexora all on/off · aktif/nonaktifkan semua fitur Nexora (owner)`,
      '',
      '*MASTER CONSOLE · OWNER ONLY*',
      '> JavaScript eval',
      '=> JavaScript return',
      '$ CLI · >> Python · >>> Go',
      '.master cli on/off · mengaktifkan CLI langsung (tanpa exec)',
      '',
      `Prefix: ${config.prefix.mode} · Bot mode: ${config.mode}`
    ].join('\n');
    const sections = [
      { title: 'General', rows: [
        { title: 'Ping', description: 'Ukur respons bot', id: `${prefix}ping` },
        { title: 'Owner', description: 'Kontak owner bot', id: `${prefix}owner` },
        { title: 'About', description: 'Informasi bot dan pembuat', id: `${prefix}about` },
        { title: 'My profile', description: 'XP, level, role, dan rank', id: `${prefix}profile` },
        { title: 'Group info', description: 'Metadata grup dan status aktif/mute', id: `${prefix}groupinfo` },
        { title: 'Runtime', description: 'Status runtime', id: `${prefix}runtime` },
        { title: 'Run code', description: 'Jalankan kode pada worker terisolasi', id: `${prefix}run` },
        { title: 'My projects', description: 'Repository website pribadi dan project memory', id: `${prefix}project list` }
      ]},
      { title: 'Owner & developer', rows: [
        { title: 'AI status', description: 'Provider dan fallback AI', id: `${prefix}aistatus` },
        { title: 'Database', description: 'Status database JSONL', id: `${prefix}dbstatus` },
        { title: 'Plugins', description: 'Daftar plugin', id: `${prefix}plugins` },
        { title: 'Master status', description: 'Status runner developer', id: `${prefix}master status` },
        { title: 'Button mode', description: 'Status tombol interaktif', id: `${prefix}buttons status` },
        { title: 'Group mute', description: 'Mute/unmute seluruh interaksi grup (owner)', id: `${prefix}mute status` },
        { title: 'Nexora capabilities', description: 'Kelola Code Lab dan worker AI (owner)', id: `${prefix}nexora status` }
      ]}
    ];
    return sendCommandList(sock, m, { title: config.bot.name, body, sections });
  }
};
