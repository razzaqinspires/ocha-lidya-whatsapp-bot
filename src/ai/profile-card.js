const WIDTH = 1080;
const HEIGHT = 1350;
const escapeXml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const number = value => (Number(value) || 0).toLocaleString('id-ID');

export function buildProfileSvg(profile, identity = {}) {
  const name = escapeXml(profile.displayName || 'Pengguna');
  const role = escapeXml(profile.role || 'Pengunjung');
  const rank = escapeXml(profile.rank || 'Iron');
  const product = escapeXml(identity.productName || 'Ocha Lidya AI');
  const org = escapeXml(identity.organization || 'Razzaq Ventures');
  const xp = Number(profile.xp) || 0;
  const level = Number(profile.level) || 1;
  const percent = Math.max(0, Math.min(100, Number(profile.progressPercent) || 0));
  const interactions = Number(profile.totalInteractions) || 0;
  const days = Number(profile.activeDays) || 0;
  const remaining = Number(profile.xpRemaining) || 0;
  const streak = Number(profile.currentStreak) || 0;
  const longestStreak = Number(profile.longestStreak) || 0;
  const dailyXpRemaining = Number(profile.dailyXpRemaining ?? 100) || 0;
  const barWidth = Math.round(900 * percent / 100);
  const achievements = (Array.isArray(profile.achievements) ? profile.achievements : []).slice(0, 4);
  const badgeText = achievements.length ? achievements.join('   ·   ') : 'NEXT MILESTONE AWAITS';
  const safeBadge = escapeXml(badgeText);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#07111f"/><stop offset=".54" stop-color="#101d2e"/><stop offset="1" stop-color="#1b2634"/></linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9c7135"/><stop offset=".5" stop-color="#e5c27e"/><stop offset="1" stop-color="#fff0c8"/></linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9c7135"/><stop offset="1" stop-color="#f4dc9f"/></linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="#d6b576" stop-opacity=".23"/><stop offset="1" stop-color="#d6b576" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="42" height="42" patternUnits="userSpaceOnUse"><path d="M42 0H0V42" fill="none" stroke="#d8c18e" stroke-opacity=".045" stroke-width="1"/></pattern>
  </defs>
  <rect width="1080" height="1350" rx="48" fill="url(#bg)"/>
  <rect width="1080" height="1350" rx="48" fill="url(#grid)"/>
  <circle cx="910" cy="150" r="350" fill="url(#glow)"/><circle cx="130" cy="1210" r="310" fill="url(#glow)"/>
  <rect x="28" y="28" width="1024" height="1294" rx="34" fill="none" stroke="url(#gold)" stroke-opacity=".7" stroke-width="2"/>
  <path d="M80 176H1000" stroke="#d8bd82" stroke-opacity=".28"/>
  <text x="80" y="112" fill="#e8cc92" font-family="Arial,sans-serif" font-size="25" letter-spacing="7">${product.toUpperCase()}  /  PLAYER PROFILE</text>
  <text x="80" y="270" fill="#ffffff" font-family="Arial,sans-serif" font-size="60" font-weight="700" textLength="900" lengthAdjust="spacingAndGlyphs">${name}</text>
  <text x="84" y="328" fill="#c1ccda" font-family="Arial,sans-serif" font-size="28">${role}</text>
  <rect x="80" y="382" width="920" height="210" rx="28" fill="#ffffff" fill-opacity=".055" stroke="#e6d3a5" stroke-opacity=".22"/>
  <text x="125" y="454" fill="#aebccc" font-family="Arial,sans-serif" font-size="22" letter-spacing="4">CURRENT RANK</text>
  <text x="125" y="540" fill="url(#gold)" font-family="Arial,sans-serif" font-size="70" font-weight="700">${rank.toUpperCase()}</text>
  <text x="945" y="530" fill="#ffffff" text-anchor="end" font-family="Arial,sans-serif" font-size="58" font-weight="700">LV. ${level}</text>
  <text x="80" y="680" fill="#ffffff" font-family="Arial,sans-serif" font-size="34" font-weight="700">EXPERIENCE</text>
  <text x="1000" y="680" fill="#e8cc92" text-anchor="end" font-family="Arial,sans-serif" font-size="30">${number(xp)} XP</text>
  <rect x="80" y="718" width="920" height="28" rx="14" fill="#ffffff" fill-opacity=".13"/>
  <rect x="80" y="718" width="${barWidth}" height="28" rx="14" fill="url(#bar)"/>
  <text x="80" y="792" fill="#c1ccda" font-family="Arial,sans-serif" font-size="23">${percent}% COMPLETE</text>
  <text x="1000" y="792" fill="#c1ccda" text-anchor="end" font-family="Arial,sans-serif" font-size="23">${number(remaining)} XP TO NEXT LEVEL</text>
  <rect x="80" y="850" width="440" height="142" rx="24" fill="#ffffff" fill-opacity=".055" stroke="#ffffff" stroke-opacity=".09"/>
  <rect x="560" y="850" width="440" height="142" rx="24" fill="#ffffff" fill-opacity=".055" stroke="#ffffff" stroke-opacity=".09"/>
  <text x="122" y="905" fill="#aebccc" font-family="Arial,sans-serif" font-size="21" letter-spacing="3">CONVERSATIONS</text>
  <text x="122" y="962" fill="#ffffff" font-family="Arial,sans-serif" font-size="44" font-weight="700">${number(interactions)}</text>
  <text x="602" y="905" fill="#aebccc" font-family="Arial,sans-serif" font-size="21" letter-spacing="3">ACTIVE DAYS</text>
  <text x="602" y="962" fill="#ffffff" font-family="Arial,sans-serif" font-size="44" font-weight="700">${number(days)}</text>
  <rect x="80" y="1020" width="440" height="142" rx="24" fill="#ffffff" fill-opacity=".055" stroke="#ffffff" stroke-opacity=".09"/>
  <rect x="560" y="1020" width="440" height="142" rx="24" fill="#ffffff" fill-opacity=".055" stroke="#ffffff" stroke-opacity=".09"/>
  <text x="122" y="1075" fill="#aebccc" font-family="Arial,sans-serif" font-size="21" letter-spacing="3">CURRENT STREAK</text>
  <text x="122" y="1132" fill="url(#gold)" font-family="Arial,sans-serif" font-size="43" font-weight="700">${number(streak)} DAYS</text>
  <text x="602" y="1075" fill="#aebccc" font-family="Arial,sans-serif" font-size="21" letter-spacing="3">BEST STREAK</text>
  <text x="602" y="1132" fill="#ffffff" font-family="Arial,sans-serif" font-size="43" font-weight="700">${number(longestStreak)} DAYS</text>
  <text x="80" y="1212" fill="#e8cc92" font-family="Arial,sans-serif" font-size="20" letter-spacing="2">ACHIEVEMENTS</text>
  <text x="80" y="1254" fill="#d6deea" font-family="Arial,sans-serif" font-size="17">${safeBadge.slice(0, 80)}</text>
  <text x="80" y="1294" fill="#92a0b2" font-family="Arial,sans-serif" font-size="17">DAILY XP AVAILABLE  ${number(dailyXpRemaining)}   ·   ${org}</text>
  </svg>`;
}

export async function renderProfileCard(profile, identity = {}) {
  const svg = Buffer.from(buildProfileSvg(profile, identity));
  try {
    const imported = await import('sharp');
    const sharp = imported.default || imported;
    return await sharp(svg).png({ compressionLevel: 9 }).toBuffer();
  } catch {
    return null;
  }
}
