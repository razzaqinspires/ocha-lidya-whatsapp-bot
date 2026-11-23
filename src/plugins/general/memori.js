import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import {
  getUserVaultStats, getRecentUserConversationTurns, searchUserConversation,
  exportUserVaultTranscript
} from '../../ai/user-vault.js';
import { getUserMemory, forgetUserMemory } from '../../ai/memory-store.js';

function senderJid(m) {
  const value = String(m.senderPn || m.sender || '').replace(/:\d+(?=@)/, '');
  return /^(?:\d{8,15}@s\.whatsapp\.net|\d{8,20}@lid)$/.test(value) ? value : '';
}
function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(2)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}
function safePreview(value, max = 420) {
  return String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max);
}

export default {
  name: 'memori', aliases: ['memory', 'ingatan', 'arsipchat'], category: 'general', fullButton: false,
  usage: '[status|fakta [halaman]|cari <kata kunci>|terbaru|ekspor|hapus-fakta <frasa>]',
  description: 'Kelola arsip percakapan privat, pencarian momen, fakta eksplisit, dan ekspor data milik akun sendiri',
  async execute({ sock, m, args }) {
    if (m.isGroup || String(m.chat || '').endsWith('@g.us')) {
      return m.reply('Pengelolaan memori hanya tersedia di chat pribadi. Arsip setiap akun bersifat privat dan tidak dibuka melalui grup.');
    }
    const userId = senderJid(m);
    if (!userId) return m.reply('Identitas WhatsApp pribadi belum dapat diverifikasi.');
    const action = String(args[0] || 'status').toLowerCase();

    if (['status', 'info'].includes(action)) {
      const [stats, memory] = await Promise.all([getUserVaultStats(userId), getUserMemory(userId)]);
      return m.reply([
        '*OCHA LIDYA · RUANG MEMORI PRIBADI*',
        `Arsip percakapan: ${stats.events.toLocaleString('id-ID')} event`,
        `Ukuran arsip: ${formatBytes(stats.bytes)}`,
        `Fakta eksplisit: ${memory.facts.length.toLocaleString('id-ID')}`,
        `Enkripsi: ${stats.encrypted ? 'AES-256-GCM aktif' : 'tidak terverifikasi'}`,
        `Arsip pertama: ${stats.firstAt ? new Date(stats.firstAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : 'Belum ada'}`,
        `Aktivitas terakhir: ${stats.lastAt ? new Date(stats.lastAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : 'Belum ada'}`,
        '',
        'Arsip tidak memiliki batas jumlah event yang ditetapkan aplikasi. Kapasitas nyata tetap mengikuti disk dan backup server. Model hanya menerima konteks terpilih berdasarkan relevansi.'
      ].join('\n'));
    }

    if (['fakta', 'facts'].includes(action)) {
      const memory = await getUserMemory(userId);
      if (!memory.facts.length) return m.reply('Belum ada fakta eksplisit yang disimpan. Untuk menyimpan fakta, tulis: “Ingat bahwa …”.');
      const pageSize = 15;
      const totalPages = Math.max(1, Math.ceil(memory.facts.length / pageSize));
      const page = Math.max(1, Math.min(totalPages, Number.parseInt(args[1] || '1', 10) || 1));
      const start = (page - 1) * pageSize;
      const lines = memory.facts.slice(start, start + pageSize).map((item, index) => `${start + index + 1}. ${safePreview(item.text, 300)}`);
      return m.reply(`*FAKTA TERSIMPAN · ${memory.facts.length.toLocaleString('id-ID')} TOTAL*\nHalaman ${page}/${totalPages}\n\n${lines.join('\n')}\n\nLihat halaman lain: .memori fakta ${page < totalPages ? page + 1 : Math.max(1, page - 1)}. Arsip fakta tidak dibatasi jumlahnya; halaman hanya membatasi panjang satu pesan WhatsApp.`);
    }

    if (['cari', 'search', 'temukan'].includes(action)) {
      const query = args.slice(1).join(' ').trim();
      if (query.length < 3) return m.reply('Masukkan kata kunci minimal 3 karakter. Contoh: .memori cari Nexora Cloud');
      const [matches, facts] = await Promise.all([
        searchUserConversation(userId, query, { limit: 15 }),
        getUserMemory(userId)
      ]);
      const relevantFacts = facts.facts.filter(item => item.text.toLocaleLowerCase('id-ID').includes(query.toLocaleLowerCase('id-ID'))).slice(0, 5);
      if (!matches.length && !relevantFacts.length) return m.reply(`Tidak ditemukan momen yang cocok untuk “${safePreview(query, 80)}” di arsip akun ini.`);
      const conversationText = matches.map((item, index) => `${index + 1}. [${item.role === 'assistant' ? 'Ocha' : 'Pengguna'} · ${new Date(item.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}]\n${safePreview(item.content, 650)}`).join('\n\n');
      const factsText = relevantFacts.map((item, index) => `${index + 1}. ${safePreview(item.text, 300)}`).join('\n');
      return m.reply(`*HASIL PENCARIAN MEMORI*\nKata kunci: ${safePreview(query, 80)}\n\n${conversationText ? `*MOMEN PERCAKAPAN*\n${conversationText}` : ''}${factsText ? `\n\n*FAKTA TERSIMPAN*\n${factsText}` : ''}`);
    }

    if (['terbaru', 'recent', 'riwayat'].includes(action)) {
      const turns = await getRecentUserConversationTurns(userId, { limit: 12 });
      if (!turns.length) return m.reply('Belum ada riwayat percakapan privat yang tersimpan.');
      return m.reply(`*12 GILIRAN TERBARU*\n\n${turns.map((turn, index) => `${index + 1}. [${turn.role === 'assistant' ? 'Ocha' : 'Kamu'} · ${new Date(turn.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}]\n${safePreview(turn.content, 500)}`).join('\n\n')}`);
    }

    if (['hapus-fakta', 'forget-facts'].includes(action)) {
      const query = args.slice(1).join(' ').trim();
      if (!query) return m.reply('Format: .memori hapus-fakta <kata atau frasa>. Perintah ini hanya menghapus fakta eksplisit, bukan arsip percakapan.');
      const result = await forgetUserMemory(userId, query);
      return m.reply(result.removed ? `${result.removed} fakta yang cocok telah dihapus dari memori eksplisit akun ini. Arsip percakapan tetap tersimpan.` : 'Tidak ada fakta yang cocok. Arsip percakapan tidak berubah.');
    }

    if (['ekspor', 'export'].includes(action)) {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-private-vault-export-'));
      const output = path.join(directory, 'ocha-private-conversation.jsonl');
      try {
        await exportUserVaultTranscript(userId, output);
        const stats = await fs.stat(output);
        if (!stats.size) return m.reply('Arsip percakapan kosong; tidak ada file ekspor yang dibuat.');
        await sock.sendMessage(m.chat, {
          document: createReadStream(output),
          mimetype: 'application/x-ndjson',
          fileName: `ocha-memory-${new Date().toISOString().slice(0, 10)}.jsonl`,
          caption: `Ekspor arsip percakapan privat akun ini (${formatBytes(stats.size)}). File berisi data plaintext setelah didekripsi. Simpan di lokasi yang aman.`
        }, { quoted: m });
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
      return undefined;
    }

    return m.reply([
      '*PANDUAN MEMORI OCHA*',
      '.memori status — statistik arsip privat',
      '.memori fakta [halaman] — lihat semua fakta tersimpan per halaman',
      '.memori cari <kata> — cari momen percakapan lama',
      '.memori terbaru — lihat 12 giliran terbaru',
      '.memori ekspor — ekspor arsip percakapan sendiri',
      '.memori hapus-fakta <frasa> — hapus fakta eksplisit tertentu',
      '',
      'Setiap akun memiliki ruang terpisah. Perintah ini tidak dapat membaca arsip akun lain.'
    ].join('\n'));
  }
};
