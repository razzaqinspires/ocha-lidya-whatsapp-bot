import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { listPlugins } from '../../core/plugin-loader.js';
import { getPrefixes } from '../../core/prefix.js';
import { getConfig } from '../../core/config.js';
import { buildMenuText, getMenuPageCount } from '../../core/menu-renderer.js';
import { registerReplySession } from '../../core/reply-sessions.js';
const BANNER_PATH = fileURLToPath(new URL('../../../assets/menu-banner.jpg', import.meta.url));

async function sendMenuPage(sock, message, page) {
  const config = getConfig();
  const plugins = listPlugins();
  const prefixes = getPrefixes();
  const pageCount = getMenuPageCount(plugins, config, true);
  const selected = Math.max(1, Math.min(pageCount, Math.floor(Number(page) || 1)));
  const body = buildMenuText({ plugins, config, prefixes, masterEnabled: true, page: selected });
  let payload = { text: body };
  if (selected === 1) {
    try { payload = { image: await fs.readFile(BANNER_PATH), caption: body }; } catch {}
  }
  let sent;
  try { sent = await sock.sendMessage(message.chat, payload, { quoted: message }); }
  catch { sent = await sock.sendMessage(message.chat, { text: body }, { quoted: message }); }
  if (pageCount > 1 && sent?.key?.id) {
    registerReplySession({
      chat: message.chat, messageId: sent.key.id, sender: message.sender, kind: 'menu-pagination',
      choices: Array.from({ length: pageCount }, (_, i) => ({ key: String(i + 1), label: `Page ${i + 1}`, value: i + 1 })),
      helpText: `Balas pesan menu ini dengan nomor halaman 1–${pageCount}.`, ttlMs: 15 * 60_000,
      onSelect: async ({ sock: replySock, message: replyMessage, value }) => sendMenuPage(replySock, replyMessage, value)
    });
  }
  return sent;
}

export default {
  name: 'menu', aliases: ['help', 'commands'], category: 'general', usage: '[page]',
  fullButton: false,
  description: 'Daftar command aktif dari plugin registry',
  async execute({ sock, m, args }) { return sendMenuPage(sock, m, args[0] || 1); }
};
