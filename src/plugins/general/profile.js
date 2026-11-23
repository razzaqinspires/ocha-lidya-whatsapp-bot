import { getUserProfile } from '../../ai/user-profiles.js';
import { renderProfileCard } from '../../ai/profile-card.js';
import { getPublicIdentity } from '../../core/public-identity.js';
import { isVerifiedOwnerMessage } from '../../core/identity.js';

function formatInteger(value) {
  const text = String(value ?? '0');
  if (/^\d+$/.test(text)) {
    try { return new Intl.NumberFormat('id-ID').format(BigInt(text)); } catch {}
  }
  return (Number(value) || 0).toLocaleString('id-ID');
}
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
    `${formatInteger(profile.xp)} XP`,
    `${progressBar(profile.progressPercent)} ${profile.progressPercent}%`,
    `${formatInteger(profile.xpRemaining)} XP menuju level berikutnya`,
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
    `XP interaksi terakhir: ${Number(profile.lastXpAward || 0).toLocaleString('id-ID')} XP`,
    `Familiaritas: ${profile.familiarityLevel}/7 · Trust ${profile.trustScore}/100`,
    profile.relationshipProgress?.nextRole
      ? `Menuju role ${profile.relationshipProgress.nextRole}: ${profile.relationshipProgress.progressPercent}%`
      : 'Role relasi tertinggi atau owner terverifikasi.',
    `${identity.creatorName} · ${identity.organization}`,
    'XP/level tidak memiliki batas level atau batas harian. Pesan duplikat tidak menambah kualitas relasi; cooldown mengurangi farming. Rank dan role bukan izin keamanan atau ukuran emosi manusia.'
  ].join('\n');
}

export default {
  name: 'profile', aliases: ['me', 'level', 'xp'], category: 'general', aiCallable: true, fullButton: false,
  description: 'Lihat XP, level, rank, dan tingkat familiaritas interaksi AI',
  async execute({ sock, m, config }) {
    const owner = isVerifiedOwnerMessage(m, config.bot.owner);
    const profile = await getUserProfile(m.senderPn || m.sender, { displayName: m.pushName, isOwner: owner });
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
