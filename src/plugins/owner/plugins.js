import { listPlugins,loadPlugins } from '../../core/plugin-loader.js';
export default {
  name:'plugins', aliases:['pluginlist'], category:'owner', ownerOnly:true, description:'Daftar plugin',
  async execute({m}) { await m.reply(listPlugins().map(p=>`• ${p.name} — ${p.description||'No description'}`).join('\n') || 'Belum ada plugin.'); }
};
