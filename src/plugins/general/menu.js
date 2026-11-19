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
      `${prefix}about · informasi bot`,
      `${prefix}runtime · informasi runtime`,
      `${prefix}groupinfo · metadata grup tersimpan`,
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
      `${prefix}master status · developer runner`,
      '',
      '*MASTER CONSOLE · OWNER ONLY*',
      '> JavaScript eval',
      '=> JavaScript return',
      '$ CLI · >> Python · >>> Go',
      '',
      `Prefix: ${config.prefix.mode} · Bot mode: ${config.mode}`
    ].join('\n');
    const sections = [
      { title: 'General', rows: [
        { title: 'Ping', description: 'Ukur respons bot', id: `${prefix}ping` },
        { title: 'Owner', description: 'Kontak owner bot', id: `${prefix}owner` },
        { title: 'About', description: 'Informasi bot', id: `${prefix}about` },
        { title: 'Group info', description: 'Metadata grup tersimpan', id: `${prefix}groupinfo` },
        { title: 'Runtime', description: 'Status runtime', id: `${prefix}runtime` }
      ]},
      { title: 'Owner & developer', rows: [
        { title: 'AI status', description: 'Provider dan fallback AI', id: `${prefix}aistatus` },
        { title: 'Database', description: 'Status database JSONL', id: `${prefix}dbstatus` },
        { title: 'Plugins', description: 'Daftar plugin', id: `${prefix}plugins` },
        { title: 'Master status', description: 'Status runner developer', id: `${prefix}master status` },
        { title: 'Button mode', description: 'Status tombol interaktif', id: `${prefix}buttons status` }
      ]}
    ];
    return sendCommandList(sock, m, { title: config.bot.name, body, sections });
  }
};
