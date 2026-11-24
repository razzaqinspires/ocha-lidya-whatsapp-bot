const WIDTH = 1080;
const HEIGHT = 1520;

const escapeXml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
})[char]);

function number(value) {
  const text = String(value ?? '0');
  if (/^\d+$/.test(text)) {
    try { return new Intl.NumberFormat('id-ID').format(BigInt(text)); } catch {}
  }
  return (Number(value) || 0).toLocaleString('id-ID');
}

function safePercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function makePills(items, { x = 84, y = 1210, max = 3 } = {}) {
  const values = (Array.isArray(items) ? items : []).map(value => String(value || '').trim()).filter(Boolean).slice(0, max);
  if (!values.length) values.push('Milestone berikutnya menanti');
  let offset = x;
  return values.map((value, index) => {
    const label = escapeXml(value.length > 25 ? `${value.slice(0, 24)}…` : value);
    const width = Math.max(142, Math.min(280, 42 + label.length * 12));
    const pill = `<g transform="translate(${offset} ${y})"><rect width="${width}" height="46" rx="23" fill="#d5b477" fill-opacity=".11" stroke="#d5b477" stroke-opacity=".36"/><circle cx="22" cy="23" r="5" fill="#e7c98f"/><text x="38" y="30" fill="#e9dfcc" font-size="17" font-family="Inter,Arial,sans-serif">${label}</text></g>`;
    offset += width + 12;
    return pill;
  }).join('');
}

export function buildProfileSvg(profile = {}, identity = {}) {
  const name = escapeXml(profile.displayName || 'Pengguna');
  const role = escapeXml(profile.role || 'Pengunjung');
  const rank = escapeXml(profile.rank || 'Iron');
  const product = escapeXml(identity.productName || 'Ocha Lidya AI');
  const org = escapeXml(identity.organization || 'Razzaq Ventures');
  const xp = number(profile.xp);
  const level = number(profile.level || 1);
  const percent = safePercent(profile.progressPercent);
  const remaining = number(profile.xpRemaining);
  const interactions = number(profile.totalInteractions);
  const days = number(profile.activeDays);
  const streak = number(profile.currentStreak);
  const bestStreak = number(profile.longestStreak);
  const familiarity = Math.max(0, Math.min(7, Number(profile.familiarityLevel) || 0));
  const trust = safePercent(profile.trustScore);
  const progress = safePercent(profile.relationshipProgress?.progressPercent);
  const nextRole = escapeXml(profile.relationshipProgress?.nextRole || 'Status tertinggi tercapai');
  const style = escapeXml(profile.interactionStyle || 'natural');
  const greeting = number(profile.greetingCount);
  const xpWidth = Math.round(900 * percent / 100);
  const trustWidth = Math.round(420 * trust / 100);
    const achievementPills = makePills(profile.achievements, { x: 84, y: 1370, max: 3 });
  const creator = escapeXml(identity.creatorName || 'Arifi Razzaq');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="canvas" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#070a10"/><stop offset=".52" stop-color="#111824"/><stop offset="1" stop-color="#1a2029"/></linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9c743d"/><stop offset=".48" stop-color="#e7ca91"/><stop offset="1" stop-color="#fff1cc"/></linearGradient>
    <linearGradient id="xp" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a77c42"/><stop offset=".52" stop-color="#e6c789"/><stop offset="1" stop-color="#f6e5bf"/></linearGradient>
    <radialGradient id="halo"><stop offset="0" stop-color="#d2ad69" stop-opacity=".28"/><stop offset="1" stop-color="#d2ad69" stop-opacity="0"/></radialGradient>
    <pattern id="fineGrid" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M44 0H0V44" fill="none" stroke="#d7bd8a" stroke-opacity=".035" stroke-width="1"/></pattern>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="18"/></filter>
  </defs>
  <rect width="1080" height="1520" rx="48" fill="url(#canvas)"/>
  <rect width="1080" height="1520" rx="48" fill="url(#fineGrid)"/>
  <circle cx="950" cy="125" r="310" fill="url(#halo)"/><circle cx="65" cy="1050" r="280" fill="url(#halo)"/>
  <rect x="27" y="27" width="1026" height="1466" rx="35" fill="none" stroke="url(#gold)" stroke-opacity=".56" stroke-width="2"/>

  <text x="84" y="94" fill="#e7c98f" font-size="23" font-weight="800" letter-spacing="5" font-family="Inter,Arial,sans-serif">${product.toUpperCase()}</text>
  <text x="84" y="132" fill="#91a0b3" font-size="15" letter-spacing="4" font-family="Inter,Arial,sans-serif">NEXORA IDENTITY SYSTEM  /  PLAYER PROFILE</text>
  <rect x="84" y="164" width="912" height="1" fill="#d9c18f" fill-opacity=".24"/>

  <text x="84" y="249" fill="#aeb9c8" font-size="17" letter-spacing="5" font-family="Inter,Arial,sans-serif">ACCOUNT HOLDER</text>
  <text x="80" y="337" fill="#f8f5ee" font-size="66" font-weight="750" textLength="690" lengthAdjust="spacingAndGlyphs" font-family="Inter,Arial,sans-serif">${name}</text>
  <text x="84" y="390" fill="#c4cbd4" font-size="25" font-family="Inter,Arial,sans-serif">${role}</text>
  <rect x="84" y="424" width="300" height="46" rx="23" fill="#d5b477" fill-opacity=".12" stroke="#d5b477" stroke-opacity=".42"/>
  <text x="234" y="454" text-anchor="middle" fill="#e9d6ad" font-size="19" font-weight="700" letter-spacing="2" font-family="Inter,Arial,sans-serif">${rank.toUpperCase()}</text>

  <circle cx="875" cy="315" r="115" fill="#d5b477" fill-opacity=".045" stroke="#d5b477" stroke-opacity=".36" stroke-width="2"/>
  <circle cx="875" cy="315" r="98" fill="none" stroke="#d5b477" stroke-opacity=".2" stroke-dasharray="3 9" stroke-width="2"/>
  <text x="875" y="290" fill="#adbac8" font-size="18" letter-spacing="4" text-anchor="middle" font-family="Inter,Arial,sans-serif">LEVEL</text>
  <text x="875" y="370" fill="url(#gold)" font-size="76" font-weight="800" text-anchor="middle" font-family="Inter,Arial,sans-serif">${level}</text>

  <rect x="64" y="514" width="952" height="270" rx="28" fill="#e8edf5" fill-opacity=".045" stroke="#d5b477" stroke-opacity=".24"/>
  <text x="104" y="570" fill="#e7c98f" font-size="19" font-weight="700" letter-spacing="4" font-family="Inter,Arial,sans-serif">EXPERIENCE / XP</text>
  <text x="976" y="570" text-anchor="end" fill="#f5f0e5" font-size="29" font-weight="700" font-family="Inter,Arial,sans-serif">${xp} XP</text>
  <rect x="104" y="622" width="872" height="26" rx="13" fill="#ffffff" fill-opacity=".1"/>
  <rect x="104" y="622" width="${Math.round(872 * percent / 100)}" height="26" rx="13" fill="url(#xp)"/>
  <text x="104" y="690" fill="#d5dbe3" font-size="23" font-weight="700" font-family="Inter,Arial,sans-serif">${percent}%</text>
  <text x="976" y="690" text-anchor="end" fill="#aab6c5" font-size="18" font-family="Inter,Arial,sans-serif">${remaining} XP TO NEXT LEVEL</text>
  <text x="104" y="744" fill="#8f9cad" font-size="16" letter-spacing="2" font-family="Inter,Arial,sans-serif">PROGRESS TRACKED FROM VERIFIED INTERACTIONS</text>

  <text x="84" y="846" fill="#e7c98f" font-size="18" font-weight="700" letter-spacing="4" font-family="Inter,Arial,sans-serif">ACTIVITY OVERVIEW</text>
  <g>
    <rect x="64" y="876" width="458" height="126" rx="22" fill="#ffffff" fill-opacity=".045" stroke="#ffffff" stroke-opacity=".08"/>
    <rect x="558" y="876" width="458" height="126" rx="22" fill="#ffffff" fill-opacity=".045" stroke="#ffffff" stroke-opacity=".08"/>
    <rect x="64" y="1020" width="458" height="126" rx="22" fill="#ffffff" fill-opacity=".045" stroke="#ffffff" stroke-opacity=".08"/>
    <rect x="558" y="1020" width="458" height="126" rx="22" fill="#ffffff" fill-opacity=".045" stroke="#ffffff" stroke-opacity=".08"/>
    <text x="100" y="925" fill="#9eacbd" font-size="17" letter-spacing="2" font-family="Inter,Arial,sans-serif">CONVERSATIONS</text>
    <text x="100" y="978" fill="#f7f4ed" font-size="42" font-weight="750" font-family="Inter,Arial,sans-serif">${interactions}</text>
    <text x="594" y="925" fill="#9eacbd" font-size="17" letter-spacing="2" font-family="Inter,Arial,sans-serif">ACTIVE DAYS</text>
    <text x="594" y="978" fill="#f7f4ed" font-size="42" font-weight="750" font-family="Inter,Arial,sans-serif">${days}</text>
    <text x="100" y="1069" fill="#9eacbd" font-size="17" letter-spacing="2" font-family="Inter,Arial,sans-serif">CURRENT STREAK</text>
    <text x="100" y="1122" fill="url(#gold)" font-size="42" font-weight="750" font-family="Inter,Arial,sans-serif">${streak} DAYS</text>
    <text x="594" y="1069" fill="#9eacbd" font-size="17" letter-spacing="2" font-family="Inter,Arial,sans-serif">BEST STREAK</text>
    <text x="594" y="1122" fill="#f7f4ed" font-size="42" font-weight="750" font-family="Inter,Arial,sans-serif">${bestStreak} DAYS</text>
  </g>

  <text x="84" y="1202" fill="#e7c98f" font-size="18" font-weight="700" letter-spacing="4" font-family="Inter,Arial,sans-serif">RELATIONSHIP &amp; PERSONALIZATION</text>
  <text x="84" y="1244" fill="#c2cbd5" font-size="17" font-family="Inter,Arial,sans-serif">Familiarity ${familiarity}/7</text>
  <rect x="84" y="1260" width="420" height="10" rx="5" fill="#ffffff" fill-opacity=".1"/>
  <rect x="84" y="1260" width="${Math.round(420 * familiarity / 7)}" height="10" rx="5" fill="url(#gold)"/>
  <text x="548" y="1244" fill="#c2cbd5" font-size="17" font-family="Inter,Arial,sans-serif">Trust ${trust}/100</text>
  <rect x="548" y="1260" width="420" height="10" rx="5" fill="#ffffff" fill-opacity=".1"/>
  <rect x="548" y="1260" width="${trustWidth}" height="10" rx="5" fill="#83cdb0"/>
  <text x="84" y="1320" fill="#99a7b8" font-size="16" font-family="Inter,Arial,sans-serif">Style: ${style} · Sapaan: ${greeting} · Progress role: ${progress}% menuju ${nextRole}</text>
  <text x="84" y="1350" fill="#e7c98f" font-size="16" letter-spacing="2" font-family="Inter,Arial,sans-serif">ACHIEVEMENTS</text>
  ${achievementPills}
  <text x="996" y="1480" text-anchor="end" fill="#718095" font-size="13" letter-spacing="1.5" font-family="Inter,Arial,sans-serif">${creator}  ·  ${org}</text>
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
