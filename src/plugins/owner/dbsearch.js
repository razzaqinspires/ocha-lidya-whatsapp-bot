import { searchArchives } from '../../core/database.js';
export default {
  name:'dbsearch', aliases:['archivefind'], category:'owner', ownerOnly:true, usage: '<query>', description:'Cari record dalam ZIP archive tanpa ekstraksi penuh',
  async execute({m,args}) {
    const query=args.join(' ');
    if(!query) return m.reply('Gunakan: .dbsearch kata-kunci');
    const rows=await searchArchives({text:query,limit:20});
    await m.reply(rows.length ? rows.map(r=>`#${r.seq} ${r.ts} ${r.type}\n${JSON.stringify(r.payload).slice(0,500)}`).join('\n\n') : 'Tidak ada record yang cocok dalam arsip.');
  }
};
