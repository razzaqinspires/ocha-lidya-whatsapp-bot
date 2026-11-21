import { getConfig } from '../../core/config.js';
import {
  getGroupInteractionState,
  isGroupJid,
  setGlobalGroupMute,
  setGroupInteractionMuted
} from '../../core/group-control.js';
import { getCachedGroupInfo } from '../../core/group-runtime.js';

function groupLabel(groupId) {
  const cached = getCachedGroupInfo(groupId);
  return cached?.subject || groupId;
}

export default {
  name: 'mute', aliases: ['groupmute'], category: 'owner', ownerOnly: true,
  description: 'Kontrol mute grup dari dalam grup; hanya owner terverifikasi yang dapat mengubah status',
  async execute({ m, args }) {
    const action = String(args[0] || 'status').toLowerCase();
    const targetArg = String(args[1] || '').trim();
    if (!['on', 'off', 'status'].includes(action)) {
      return m.reply('Gunakan `.mute on`, `.mute off`, atau `.mute status` di dalam grup. Untuk membisukan seluruh grup, gunakan `.mute on all` melalui chat pribadi owner.');
    }

    const config = getConfig();
    const explicitGroup = isGroupJid(targetArg) ? targetArg : '';
    const allScope = targetArg.toLowerCase() === 'all';

    // In a group, the message context is the target. Never allow a group
    // command to mutate another group or global state by supplying an ID.
    if (m.isGroup) {
      if (targetArg) {
        return m.reply('Di dalam grup, `.mute` hanya mengatur grup tempat perintah dikirim. Gunakan chat pribadi owner untuk target Group JID; `.mute on all` adalah perintah darurat global.');
      }
      const groupId = m.chat;
      if (action === 'status') {
        const state = getGroupInteractionState(groupId, config);
        return m.reply([
          '*GROUP INTERACTION STATUS*',
          `Grup: ${groupLabel(groupId)}`,
          `Status: ${state.muted ? 'MUTE' : 'AKTIF'}`,
          `Default global: ${state.globalMuted ? 'MUTE' : 'AKTIF'}`,
          'Hanya owner terverifikasi yang dapat mengubah status ini.'
        ].join('\n'));
      }
      const muted = action === 'on';
      await setGroupInteractionMuted(groupId, muted, { actor: m.sender, reason: `owner .mute ${action} from target group ${groupId}` });
      return m.reply([
        `GROUP MUTE: ${muted ? 'ON' : 'OFF'}`,
        `Grup: ${groupLabel(groupId)}`,
        muted ? 'Ocha kembali diam di grup ini.' : 'Ocha sekarang aktif dan dapat memproses percakapan di grup ini.',
        'Grup lain tetap mengikuti status masing-masing.'
      ].join('\n'));
    }

    // Private owner chat remains the administrative path for all groups or an
    // explicitly supplied Group JID. A bare .mute off never guesses a target.
    if (targetArg && !explicitGroup && !allScope) {
      return m.reply('Target tidak valid. Gunakan `all` atau Group JID yang berakhiran `@g.us`.');
    }
    if (action === 'status') {
      if (explicitGroup) {
        const state = getGroupInteractionState(explicitGroup, config);
        return m.reply(`*GROUP INTERACTION STATUS*\nGrup: ${groupLabel(explicitGroup)}\nStatus: ${state.muted ? 'MUTE' : 'AKTIF'}\nDefault global: ${state.globalMuted ? 'MUTE' : 'AKTIF'}`);
      }
      const global = config.features.groupsMuted ? 'MUTE' : 'AKTIF';
      return m.reply(`*GROUP INTERACTION STATUS*\nDefault global: ${global}\nGunakan \`.groupinfo\` untuk melihat status semua grup.\nKirim \`.mute status\` di dalam grup untuk memeriksa grup tersebut.`);
    }
    if (allScope) {
      if (action === 'off') {
        return m.reply('Kebijakan aman: seluruh grup tetap MUTE secara default. Untuk mengaktifkan, owner harus mengirim `.mute off` langsung di setiap grup yang dipilih. `.mute on all` tetap tersedia sebagai tombol darurat untuk membisukan semuanya.');
      }
      await setGlobalGroupMute(true, { actor: m.sender, reason: 'owner .mute on all emergency mute' });
      return m.reply('GLOBAL GROUP MUTE: ON\nSeluruh grup dibisukan. Semua pengecualian aktif dihapus; aktifkan kembali satu per satu dengan `.mute off` di grup tujuan.');
    }
    if (explicitGroup) {
      const muted = action === 'on';
      await setGroupInteractionMuted(explicitGroup, muted, { actor: m.sender, reason: `owner .mute ${action} group ${explicitGroup}` });
      return m.reply([`GROUP MUTE: ${muted ? 'ON' : 'OFF'}`, `Grup: ${groupLabel(explicitGroup)}`, `Group ID: ${explicitGroup}`].join('\n'));
    }
    return m.reply('Target grup tidak ditebak dari riwayat join. Kirim `.mute off` langsung di grup yang ingin diaktifkan. Aktivasi massal tidak tersedia; `.mute on all` hanya untuk membisukan seluruh grup.');
  }
};
