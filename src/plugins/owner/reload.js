import { loadPlugins } from '../../core/plugin-loader.js';
export default {
  name:'reload', aliases:['reloadplugins'], category:'owner', ownerOnly:true, description:'Reload plugin registry',
  async execute({m}) { await loadPlugins(); await m.reply('Plugin registry selesai dimuat ulang. File watcher tetap aktif.'); }
};
