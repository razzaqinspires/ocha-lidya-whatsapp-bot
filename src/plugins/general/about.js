export default {
  name: 'about', aliases: ['botinfo'], category: 'general', description: 'Bot identity and build information',
  async execute({ m, config }) {
    const creator = config.bot.publicCreatorDisclosure !== false
      ? `Creator & Owner: ${config.bot.creatorName || config.bot.ownerName}\nOrganization: ${config.bot.organization || 'Razzaq Ventures'}`
      : 'Creator information: not publicly disclosed';
    return m.reply([
      `*${config.bot.name}*`,
      'Personal WhatsApp Assistant',
      creator,
      'Engine: Baileys 7.x · Node.js ESM',
      'Architecture: Plugin Runtime + Hot Reload + Nexora AI',
      `Prefix mode: ${config.prefix.mode}`,
      `Bot mode: ${config.mode}`
    ].join('\n'));
  }
};
