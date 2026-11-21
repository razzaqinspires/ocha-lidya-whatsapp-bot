import { resolveMessageSenderPn } from '../../core/jid-resolution.js';
export default {
  name: 'jid', aliases: ['jidinfo', 'liddebug'], category: 'developer', ownerOnly: true, usage: '[message-context]',
  description: 'Inspect PN/LID identifiers for the current message',
  async execute({ sock, m }) {
    const key = m.key || {};
    const senderPn = await resolveMessageSenderPn(sock, key, m.isGroup);
    const fields = {
      chat: m.chat,
      sender: m.sender,
      senderPn: senderPn || null,
      remoteJid: key.remoteJid,
      remoteJidAlt: key.remoteJidAlt,
      remoteJidPn: key.remoteJidPn,
      participant: key.participant,
      participantAlt: key.participantAlt,
      participantPn: key.participantPn,
      keySenderPn: key.senderPn,
      fromMe: key.fromMe,
      isGroup: m.isGroup
    };
    return m.reply('*JID / LID DIAGNOSTICS*\n```json\n' + JSON.stringify(fields, null, 2) + '\n```');
  }
};
