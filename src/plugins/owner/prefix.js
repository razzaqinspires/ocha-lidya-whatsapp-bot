import { getConfig } from '../../core/config.js';
import { setPrefixMode,setSinglePrefix,addPrefix,removePrefix,getPrefixes } from '../../core/prefix.js';
export default {
  name:'setprefix', aliases:['prefix'], category:'owner', ownerOnly:true, usage: '<mode|single|add|remove> [value]', description:'Kelola prefix',
  async execute({m,args}) {
    const [mode,action,value]=args;
    try {
      if(mode==='single') await setSinglePrefix(action);
      else if(mode==='multi' && action==='add') await addPrefix(value);
      else if(mode==='multi' && action==='del') await removePrefix(value);
      else if(['multi','none'].includes(mode)) await setPrefixMode(mode);
      else if(mode==='show' || !mode) {
        const c=getConfig();
        return m.reply(`Prefix mode: ${c.prefix.mode}\nSingle: ${c.prefix.single}\nMulti: ${(c.prefix.list||[]).join(' ')||'(kosong)'}`);
      } else return m.reply('Contoh:\n.setprefix single !\n.setprefix multi add #\n.setprefix multi del #\n.setprefix multi\n.setprefix none');
      await m.reply(`Prefix diperbarui. Mode: ${getConfig().prefix.mode}\nAktif: ${getPrefixes().join(' ') || '(tanpa prefix)'}`);
    } catch(error) { await m.reply(error.message); }
  }
};
