import { getConfig } from '../../core/config.js';
import {
  getGroupInteractionState,
  getLastJoinedGroupId,
  isGroupJid,
  setGlobalGroupMute,
  setGroupInteractionMuted
} from '../../core/group-control.js';
import { getCachedGroupInfo } from '../../core/group-runtime.js';

function groupLabel(groupId) {
  const cached = getCachedGroupInfo(groupId);
  return cached?.subject || groupId;
}

function statusLine(groupId, config) {
  const state = getGroupInteractionState(groupId, config);
  return `${groupLabel(groupId)} · ${state.muted ? 'MUTE' : 'AKTIF'}`;
}

export default {
  name: 'mute', aliases: ['groupmute'], category: 'owner', ownerOnly: true, privateOnly: true,
  description: 'Kontrol mute global atau per grup dari chat pribadi owner',
  async execute({ m, args }) {
    const action = String(args[0] || 'status').toLowerCase();
    const targetArg = String(args[1] || '').trim();
    if (!['on', 'off', 'status'].includes(action)) {
      return m.reply('Gunakan: .mute on/off/status [all|GROUP_JID]\nSetelah .joingc, .mute off mengaktifkan grup yang baru dimasuki. Gunakan .mute on all atau .mute off all untuk seluruh grup.');
    }

    const config = getConfig();
    const lastJoined = getLastJoinedGroupId(config);
    const explicitGroup = isGroupJid(targetArg) ? targetArg : '';
    const allScope = targetArg.toLowerCase() === 'all';

    if (targetArg && !explicitGroup && !allScope) {
      return m.reply('Target tidak valid. Gunakan `all` atau Group JID yang berakhiran `@g.us`.');
    }

    if (action === 'status') {
      const target = explicitGroup || (allScope ? '' : lastJoined);
      const global = config.features.groupsMuted ? 'MUTE' : 'AKTIF';
      const lines = [
        '*GROUP INTERACTION STATUS*',
        `Default global: ${global}`,
        target ? `Target grup: ${statusLine(target, config)}` : 'Target grup: seluruh grup / tidak ditentukan',
        'Gunakan `.groupinfo` untuk melihat status seluruh grup.',
        'Metadata grup dan indeks kontak tetap berjalan meskipun interaksi grup di-mute.'
      ];
      return m.reply(lines.join('\n'));
    }

    const muted = action === 'on';
    if (allScope || (!explicitGroup && !lastJoined)) {
      await setGlobalGroupMute(muted, { actor: m.sender, reason: `owner .mute ${action} ${allScope ? 'all' : 'legacy global scope'}` });
      return m.reply([
        `GLOBAL GROUP MUTE: ${muted ? 'ON' : 'OFF'}`,
        muted ? 'Seluruh grup dibisukan.' : 'Interaksi diaktifkan untuk seluruh grup.',
        'Override per grup dibersihkan agar hasil perintah global konsisten.'
      ].join('\n'));
    }

    const groupId = explicitGroup || lastJoined;
    await setGroupInteractionMuted(groupId, muted, { actor: m.sender, reason: `owner .mute ${action} group ${groupId}` });
    return m.reply([
      `GROUP MUTE: ${muted ? 'ON' : 'OFF'}`,
      `Grup: ${groupLabel(groupId)}`,
      muted ? 'Ocha akan diam di grup ini.' : 'Ocha aktif di grup ini. Grup lain tidak berubah.',
      `Group ID: ${groupId}`
    ].join('\n'));
  }
};
