import { getConfig } from './config.js';
import { getPrefixes } from './prefix.js';

function commandId(command) {
  const prefix = getPrefixes()[0] || '';
  return `${prefix}${command}`;
}

export function withCommandButtons(sock, message) {
  if (!message || typeof message.reply !== 'function' || message.__ochaReplyEnhanced) return message;
  const originalReply = message.reply.bind(message);
  message.reply = async (text, quoted = message, options = {}) => {
    const config = getConfig();
    if (!config.ui?.buttonsEnabled || !sock.sendInteractive || options?.plain === true) {
      return originalReply(text, quoted, options);
    }
    const body = typeof text === 'string' ? text : String(text ?? '');
    if (quoted && quoted !== message && !quoted.key) return originalReply(text, quoted, options);
    const buttons = [
      { type: 'quick_reply', title: 'Menu', id: commandId('menu') },
      { type: 'quick_reply', title: 'Ping', id: commandId('ping') },
      { type: 'quick_reply', title: 'Grup', id: commandId('groupinfo') }
    ];
    try {
      return await sock.sendInteractive(message.chat, {
        title: config.bot.name || 'Ocha Lidya',
        body,
        footer: 'Pilih tindakan · Ocha Lidya',
        buttons
      }, quoted?.key ? quoted : null);
    } catch {
      return originalReply(text, quoted, options);
    }
  };
  Object.defineProperty(message, '__ochaReplyEnhanced', { value: true, configurable: true });
  return message;
}

export async function sendCommandList(sock, message, { title, body, sections, buttons = [] }) {
  const config = getConfig();
  if (config.ui?.buttonsEnabled && typeof sock.sendInteractive === 'function') {
    return sock.sendInteractive(message.chat, {
      title: title || config.bot.name,
      body,
      footer: 'Ocha Lidya · Interactive commands',
      sections,
      listTitle: 'Pilih perintah',
      buttons
    }, message);
  }
  return message.reply(`${title || config.bot.name}\n\n${body}`);
}
