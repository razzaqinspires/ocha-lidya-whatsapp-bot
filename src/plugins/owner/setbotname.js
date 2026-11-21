import { updateConfig } from '../../core/config.js';
export default {
  name:'setbotname', aliases:['botname'], category:'owner', ownerOnly:true, usage: '<name>', description:'Update displayed bot name',
  async execute({m,text}) {
    const name=text.trim();
    if(!name || name.length>40) return m.reply('Gunakan: .setbotname Ocha Lidya');
    await updateConfig(c=>{c.bot.name=name;},{actor:m.sender,reason:'bot display name update'});
    await m.reply(`Nama tampilan internal diperbarui: ${name}. Ini tidak mengubah nama profil WhatsApp secara otomatis.`);
  }
};
