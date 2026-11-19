import { databaseHealth } from '../../core/database.js';
import { getContactCount } from '../../core/contacts.js';
import { getCachedGroups } from '../../core/group-runtime.js';
export default {
  name: 'dbstatus', aliases: ['database', 'dbhealth'], category: 'owner', ownerOnly: true,
  description: 'Status database JSONL, kontak, metadata grup, mirror, dan arsip',
  async execute({ m }) {
    const health = await databaseHealth();
    const text = [
      '*OCHA DATABASE HEALTH*',
      `Sequence aktif: ${health.sequence}`,
      `Primary: ${health.primary.records} records · ${health.primary.error || 'OK'}`,
      `Replica: ${health.mirror.records} records · ${health.mirror.error || 'OK'}`,
      `ZIP archives: ${health.archives}`,
      `Contacts: ${getContactCount()} nomor unik`,
      `Group metadata: ${getCachedGroups().length} grup`,
      `Mirror: ${health.mirrorEnabled ? 'ON' : 'OFF'}`,
      `Hash tail: ${health.lastHash}`
    ].join('\n');
    return m.reply(text);
  }
};
