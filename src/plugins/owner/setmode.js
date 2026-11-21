import { updateConfig } from '../../core/config.js';
export default {
  name:'setmode', aliases:['mode'], category:'owner', ownerOnly:true, usage: '<public|self>', description:'Ubah mode public/self',
  async execute({m,args}) {
    const mode=(args[0]||'').toLowerCase();
    if(!['public','self'].includes(mode)) return m.reply('Gunakan: .setmode public atau .setmode self');
    await updateConfig(c=>{c.mode=mode;},{actor:m.sender,reason:`bot mode: ${mode}`});
    await m.reply(`Mode bot sekarang: ${mode}`);
  }
};
