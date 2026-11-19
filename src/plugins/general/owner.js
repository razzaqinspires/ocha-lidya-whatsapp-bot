export default {
  name:'owner', aliases:['creator'], category:'general', description:'Informasi owner',
  async execute({m,config}) { await m.reply(`Owner: wa.me/${config.bot.owner}`); }
};
