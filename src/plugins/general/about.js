export default {
  name:'about', aliases:['botinfo'], category:'general', description:'Bot identity and build information',
  async execute({m,config}) {
    await m.reply(`*${config.bot.name}*\nPersonal WhatsApp Assistant\nEngine: Baileys 7.x · Node.js ESM\nArchitecture: Plugin Runtime + Hot Reload\nPrefix mode: ${config.prefix.mode}\nBot mode: ${config.mode}`);
  }
};
