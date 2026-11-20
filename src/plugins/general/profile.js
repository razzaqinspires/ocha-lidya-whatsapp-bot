import { getUserProfile } from '../../ai/user-profiles.js';
import { renderProfileCard } from '../../ai/profile-card.js';
import { getPublicIdentity } from '../../core/public-identity.js';
import { isOwner as verifyOwner } from '../../core/identity.js';

function progressBar(percent, width = 16) {
  const filled = Math.max(0, Math.min(width, Math.round((Number(percent) || 0) / 100 * width)));
  return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)}`;
}
function profileText(profile, identity) {
  return [
    `*${identity.productName} · USER PROFILE*`,
    `Nama: ${profile.displayName}`,
    `Role: ${profile.role}`,
    `Rank: ${profile.rank}`,
    `Level: ${profile.level}`,
    `XP: ${profile.xp.toLocaleString('id-ID')}`,
    `${progressBar(profile.progressPercent)} ${profile.progressPercent}%`,
    `Menuju level berikutnya: ${profile.xpRemaining.toLocaleString('id-ID')} XP`,
    '',
    '*INTERACTION RECORD*',
    `Total interaksi: ${profile.totalInteractions.toLocaleString('id-ID')}`,
    `Hari aktif: ${profile.activeDays.toLocaleString('id-ID')}`,
    `Gaya komunikasi: ${profile.interactionStyle}`,
    '',
    `Dikembangkan oleh ${identity.creatorName} · ${identity.organization}`,
    'XP diperoleh dari percakapan AI yang valid. Role menunjukkan tingkat familiaritas interaksi, bukan ukuran emosi manusia.'
  ].join('\n');
}

export default {
  name: 'profile', aliases: ['me', 'level', 'xp'], category: 'general',
  description: 'Lihat XP, level, rank, dan tingkat familiaritas interaksi AI',
  async execute({ sock, m, config }) {
    const owner = Boolean(m.isOwner || verifyOwner(m.sender, config.bot.owner));
    const profile = await getUserProfile(m.sender, { displayName: m.pushName, isOwner: owner });
    const identity = getPublicIdentity();
    const caption = profileText(profile, identity);
    const image = await renderProfileCard(profile, identity);
    if (!image) return m.reply(caption);
    try {
      return await sock.sendMessage(m.chat, { image, caption }, { quoted: m });
    } catch {
      return m.reply(caption);
    }
  }
};
