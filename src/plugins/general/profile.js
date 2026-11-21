import { getUserProfile } from '../../ai/user-profiles.js';
import { renderProfileCard } from '../../ai/profile-card.js';
import { getPublicIdentity } from '../../core/public-identity.js';
import { isVerifiedOwnerMessage } from '../../core/identity.js';

function progressBar(percent, width = 16) {
  const filled = Math.max(0, Math.min(width, Math.round((Number(percent) || 0) / 100 * width)));
  return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)}`;
}
function profileText(profile, identity) {
  const achievements = profile.achievements?.length ? profile.achievements.join(' · ') : 'Belum ada badge';
  const lastActive = profile.lastActiveDate || '-';
  return [
    `*${identity.productName} · PROFILE*`,
    '',
    `*${profile.displayName}*`,
    `${profile.role}  ·  ${profile.rank}  ·  LV.${profile.level}`,
    '',
    '*EXPERIENCE*',
    `${profile.xp.toLocaleString('id-ID')} XP`,
    `${progressBar(profile.progressPercent)} ${profile.progressPercent}%`,
    `${profile.xpRemaining.toLocaleString('id-ID')} XP menuju level berikutnya`,
    '',
    '*ACTIVITY*',
    `Percakapan: ${profile.totalInteractions.toLocaleString('id-ID')}`,
    `Hari aktif: ${profile.activeDays.toLocaleString('id-ID')}`,
    `Streak saat ini: ${profile.currentStreak || 0} hari`,
    `Streak terbaik: ${profile.longestStreak || 0} hari`,
    `Aktif terakhir: ${lastActive}`,
    '',
    '*PERSONALIZATION*',
    `Gaya komunikasi: ${profile.interactionStyle}`,
    `Sapaan tercatat: ${profile.greetingCount}`,
    '',
    '*ACHIEVEMENTS*',
    achievements,
    '',
    `Daily XP tersisa: ${profile.dailyXpRemaining}/${profile.dailyXpCap}`,
    `${identity.creatorName} · ${identity.organization}`,
    'XP berasal dari interaksi AI yang valid. Rank dan role adalah progres sistem, bukan ukuran emosi manusia.'
  ].join('\n');
}

export default {
  name: 'profile', aliases: ['me', 'level', 'xp'], category: 'general',
  description: 'Lihat XP, level, rank, dan tingkat familiaritas interaksi AI',
  async execute({ sock, m, config }) {
    const owner = isVerifiedOwnerMessage(m, config.bot.owner);
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
