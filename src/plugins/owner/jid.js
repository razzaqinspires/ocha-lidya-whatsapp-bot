export default {
  name:'jid', aliases:['jidinfo','liddebug'], category:'developer', ownerOnly:true, description:'Inspect PN/LID identifiers for the current message',
  async execute({m}) {
    const k=m.key||{};
    const fields={
      chat:m.chat,
      sender:m.sender,
      remoteJid:k.remoteJid,
      remoteJidAlt:k.remoteJidAlt,
      participant:k.participant,
      participantAlt:k.participantAlt,
      senderPn:k.senderPn,
      fromMe:k.fromMe,
      isGroup:m.isGroup
    };
    await m.reply('*JID / LID DIAGNOSTICS*\n```json\n'+JSON.stringify(fields,null,2)+'\n```');
  }
};
