import { databaseHealth } from '../../core/database.js';
export default {
  name:'dbstatus', aliases:['database','dbhealth'], category:'owner', ownerOnly:true, description:'Status database JSONL, mirror, dan arsip',
  async execute({m}) {
    const h=await databaseHealth();
    await m.reply([
      '*OCHA DATABASE HEALTH*',
      `Sequence aktif: ${h.sequence}`,
      `Primary: ${h.primary.records} records · ${h.primary.error || 'OK'}`,
      `Replica: ${h.mirror.records} records · ${h.mirror.error || 'OK'}`,
      `ZIP archives: ${h.archives}`,
      `Mirror: ${h.mirrorEnabled?'ON':'OFF'}`,
      `Hash tail: ${h.lastHash}`
    ].join('\n'));
  }
};
