import { auditCommandCollisions } from '../../core/command-collision-audit.js';
export default {
  name: 'commandaudit', aliases: ['aliasaudit', 'commandconflicts'], category: 'owner', ownerOnly: true, privateOnly: true,
  usage: '[scan]', description: 'Audit otomatis nama command dan alias yang bertabrakan; menyimpan rekomendasi resolusi',
  async execute({ m }) {
    const report = await auditCommandCollisions();
    if (!report.collisions.length) return m.reply(`COMMAND GOVERNANCE AUDIT\nPlugin diperiksa: ${report.scannedPlugins}\nBentrok: 0\nTidak ditemukan duplikasi nama command atau alias.`);
    const details = report.collisions.slice(0, 20).map(item => `${item.command}\n${item.items.map(entry => `• ${entry.plugin} (${entry.kind}) · ${entry.fileHint}`).join('\n')}\nSaran: ${item.recommendation}`).join('\n\n');
    return m.reply(`COMMAND GOVERNANCE AUDIT\nPlugin diperiksa: ${report.scannedPlugins}\nBentrok: ${report.collisions.length}\nMode: deteksi + staging rekomendasi; tidak menghapus atau menimpa source otomatis.\n\n${details}\n\nLaporan tersimpan. Resolusi source harus melewati pemeriksaan dampak dan validasi syntax sebelum diterapkan.`);
  }
};
