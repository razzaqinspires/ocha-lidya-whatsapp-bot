const WIDTH = 1080;
const HEIGHT = 1350;
const escapeXml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

export function buildProfileSvg(profile, identity = {}) {
  const name = escapeXml(profile.displayName || 'Pengguna');
  const role = escapeXml(profile.role || 'Pengunjung');
  const rank = escapeXml(profile.rank || 'Iron');
  const product = escapeXml(identity.productName || 'Ocha Lidya');
  const org = escapeXml(identity.organization || 'Razzaq Ventures');
  const xp = Number(profile.xp) || 0;
  const level = Number(profile.level) || 1;
  const percent = Math.max(0, Math.min(100, Number(profile.progressPercent) || 0));
  const interactions = Number(profile.totalInteractions) || 0;
  const days = Number(profile.activeDays) || 0;
  const remaining = Number(profile.xpRemaining) || 0;
  const barWidth = Math.round(800 * percent / 100);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101827"/><stop offset="1" stop-color="#202c3c"/></linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b58a45"/><stop offset="1" stop-color="#f0d59b"/></linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c59b58"/><stop offset="1" stop-color="#f4d99f"/></linearGradient>
  </defs>
  <rect width="1080" height="1350" rx="48" fill="url(#bg)"/>
  <rect x="34" y="34" width="1012" height="1282" rx="34" fill="none" stroke="#b58a45" stroke-opacity=".7" stroke-width="2"/>
  <circle cx="900" cy="180" r="220" fill="#c59b58" opacity=".07"/><circle cx="130" cy="1130" r="250" fill="#8aa2bc" opacity=".06"/>
  <text x="90" y="120" fill="#e7c98f" font-family="Arial,sans-serif" font-size="28" letter-spacing="8">${product.toUpperCase()} · PROFILE</text>
  <text x="90" y="245" fill="#ffffff" font-family="Arial,sans-serif" font-size="62" font-weight="700">${name}</text>
  <text x="90" y="305" fill="#b8c4d3" font-family="Arial,sans-serif" font-size="30">${role}</text>
  <rect x="90" y="365" width="900" height="250" rx="28" fill="#ffffff" fill-opacity=".055" stroke="#ffffff" stroke-opacity=".12"/>
  <text x="135" y="435" fill="#b8c4d3" font-family="Arial,sans-serif" font-size="25" letter-spacing="4">CURRENT RANK</text>
  <text x="135" y="535" fill="url(#gold)" font-family="Arial,sans-serif" font-size="76" font-weight="700">${rank}</text>
  <text x="880" y="530" fill="#ffffff" text-anchor="end" font-family="Arial,sans-serif" font-size="60" font-weight="700">LV. ${level}</text>
  <text x="90" y="710" fill="#ffffff" font-family="Arial,sans-serif" font-size="36" font-weight="700">Experience</text>
  <text x="990" y="710" fill="#e7c98f" text-anchor="end" font-family="Arial,sans-serif" font-size="30">${xp.toLocaleString('en-US')} XP</text>
  <rect x="90" y="755" width="900" height="28" rx="14" fill="#ffffff" fill-opacity=".13"/>
  <rect x="90" y="755" width="${barWidth}" height="28" rx="14" fill="url(#bar)"/>
  <text x="90" y="825" fill="#b8c4d3" font-family="Arial,sans-serif" font-size="24">${percent}% · ${remaining.toLocaleString('en-US')} XP to next level</text>
  <rect x="90" y="900" width="430" height="150" rx="24" fill="#ffffff" fill-opacity=".055"/>
  <rect x="560" y="900" width="430" height="150" rx="24" fill="#ffffff" fill-opacity=".055"/>
  <text x="135" y="965" fill="#b8c4d3" font-family="Arial,sans-serif" font-size="23">INTERACTIONS</text>
  <text x="135" y="1020" fill="#ffffff" font-family="Arial,sans-serif" font-size="44" font-weight="700">${interactions.toLocaleString('en-US')}</text>
  <text x="605" y="965" fill="#b8c4d3" font-family="Arial,sans-serif" font-size="23">ACTIVE DAYS</text>
  <text x="605" y="1020" fill="#ffffff" font-family="Arial,sans-serif" font-size="44" font-weight="700">${days.toLocaleString('en-US')}</text>
  <text x="90" y="1160" fill="#e7c98f" font-family="Arial,sans-serif" font-size="24">Relationship grows through consistent conversations.</text>
  <text x="90" y="1220" fill="#8e9bad" font-family="Arial,sans-serif" font-size="21">A progress system · not a measure of human feelings</text>
  <text x="90" y="1280" fill="#8e9bad" font-family="Arial,sans-serif" font-size="20">${org} · ${product}</text>
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
