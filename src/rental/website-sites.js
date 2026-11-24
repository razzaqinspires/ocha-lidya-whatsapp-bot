import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getRecord, listRecords, putRecord } from '../core/repository.js';
import { getRentalContext, getTenantStatus } from './service.js';
import { claimWebsiteSlot, getWebsiteVerification } from './website-verification.js';

const ASSET_ROOT = path.resolve('data/websites/assets');
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const MAX_SITE_ASSETS = 50 * 1024 * 1024;
const locks = new Map();
const nowIso = () => new Date().toISOString();
const normalizeJid = value => String(value || '').replace(/:\d+(?=@)/, '').toLowerCase();
const cleanText = (value, max = 240) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max);
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''), 'hex'); const b = Buffer.from(String(right || ''), 'hex');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const slugify = value => cleanText(value, 80).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

const TEMPLATES = Object.freeze([
  { id: 'business', name: 'Business Profile', description: 'Profil bisnis, layanan, kontak, dan CTA profesional.', tone: 'navy', demo: 'Konsultan, jasa profesional, UMKM' },
  { id: 'portfolio', name: 'Creative Portfolio', description: 'Portofolio personal dengan fokus karya dan keahlian.', tone: 'paper', demo: 'Desainer, fotografer, kreator' },
  { id: 'agency', name: 'Digital Agency', description: 'Landing page agensi dengan layanan dan alur konsultasi.', tone: 'violet', demo: 'Studio kreatif, developer, agensi' },
  { id: 'storefront', name: 'Product Storefront', description: 'Etalase produk dengan katalog ringkas dan kontak pemesanan.', tone: 'sand', demo: 'Brand produk, katalog, affiliate' },
  { id: 'creator', name: 'Creator Link', description: 'Halaman kreator, media sosial, dan pembaruan konten.', tone: 'ink', demo: 'Content creator, influencer' },
  { id: 'restaurant', name: 'Restaurant & Cafe', description: 'Menu, cerita tempat, lokasi, dan reservasi.', tone: 'forest', demo: 'Restoran, cafe, kuliner' },
  { id: 'event', name: 'Event & Campaign', description: 'Informasi acara, agenda, dan tombol pendaftaran.', tone: 'coral', demo: 'Event, komunitas, kampanye' }
]);

function withLock(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  const queued = previous.then(() => current);
  locks.set(key, queued);
  return previous.then(task).finally(() => { release(); if (locks.get(key) === queued) locks.delete(key); });
}

export function getWebsiteTemplates() { return TEMPLATES.map(item => ({ ...item })); }
export function getWebsiteTemplate(id) { return TEMPLATES.find(item => item.id === String(id || '').toLowerCase()) || null; }

async function resolveWebsiteAccess(ownerJid) {
  const owner = normalizeJid(ownerJid);
  if (!/^\d{8,15}@s\.whatsapp\.net$/.test(owner)) throw new Error('Nomor WhatsApp pemilik website belum dapat diverifikasi.');
  const context = await getRentalContext(owner);
  if (context) {
    const tenant = await getTenantStatus(context.groupJid);
    if (tenant.tenant && tenant.status === 'active') {
      if (normalizeJid(tenant.tenant.billingContact) !== owner) throw new Error('Slot website untuk grup sewa hanya dapat dikelola oleh kontak pemesan/pembayar sewa.');
      return { source: 'rental', groupJid: context.groupJid, groupName: tenant.tenant.groupName || context.groupName };
    }
  }
  const verification = await getWebsiteVerification(owner);
  if (verification?.verified && Number(verification.websiteSlotsUsed || 0) < Number(verification.websiteSlotsGranted || 0)) return { source: 'verified', groupJid: null, groupName: '' };
  if (verification?.verified) throw new Error('Slot website verifikasi satu kali sudah digunakan.');
  throw new Error('Website Builder tersedia untuk penyewa aktif atau akun dengan centang biru. Penyewa: pilih grup melalui .sewa di grup lalu lanjutkan di chat pribadi. Non-penyewa: selesaikan .website verify sebesar Rp10.000.');
}

export async function createWebsiteSite(ownerJid, { template = 'business', slug = '', title = '', tagline = '', description = '' } = {}) {
  return withLock(`website-create:${normalizeJid(ownerJid)}`, async () => {
    const access = await resolveWebsiteAccess(ownerJid);
    const templateInfo = getWebsiteTemplate(template);
    if (!templateInfo) throw new Error(`Template tidak dikenal. Pilih: ${TEMPLATES.map(item => item.id).join(', ')}.`);
    const owner = normalizeJid(ownerJid);
    const sites = Object.values(await listRecords('website.site'));
    if (access.source === 'rental' && sites.some(site => site.groupJid === access.groupJid && site.status !== 'deleted')) throw new Error('Grup sewa ini sudah menggunakan satu slot website. Edit website yang ada, atau perbarui paket/slot melalui owner.');
    if (access.source === 'verified' && sites.some(site => site.ownerJid === owner && site.source === 'verified' && site.status !== 'deleted')) throw new Error('Akun ini sudah menggunakan slot website verifikasi satu kali.');
    const base = slugify(slug || title || `${templateInfo.id}-${owner.slice(0, 6)}`);
    if (!base) throw new Error('Slug website tidak valid. Gunakan huruf, angka, dan tanda hubung.');
    if (sites.some(site => site.slug === base && site.status !== 'deleted')) throw new Error(`Slug "${base}" sudah digunakan. Pilih slug lain.`);
    const siteId = `WST-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    const site = {
      id: siteId, slug: base, ownerJid: owner, source: access.source, groupJid: access.groupJid,
      groupName: access.groupName, template: templateInfo.id, status: 'draft',
      title: cleanText(title || access.groupName || 'Website Baru', 80),
      tagline: cleanText(tagline || 'Selamat datang di halaman resmi kami.', 180),
      description: cleanText(description || 'Kenali layanan, karya, dan informasi terbaru kami.', 1200),
      about: '', ctaText: 'Hubungi Kami', whatsapp: owner.replace(/@s\.whatsapp\.net$/, ''), email: '', instagram: '', location: '',
      primaryColor: '#17243b', secondaryColor: '#d7b77a', customSections: [], posts: [], assets: [],
      publicTokenHash: null, publishedAt: null, createdAt: nowIso(), updatedAt: nowIso(), version: 1, schemaVersion: 2
    };
    await putRecord('website.site', site.slug, site, { actor: owner, reason: 'website draft created' });
    await putRecord('website.audit', `${site.id}-CREATE`, { action: 'site.created', siteId: site.id, slug: site.slug, ownerJid: owner, groupJid: access.groupJid, source: access.source, at: site.createdAt }, { source: 'website-builder' });
    return site;
  });
}

export async function getWebsiteSite(slug) {
  const key = slugify(slug);
  if (!key) return null;
  const site = await getRecord('website.site', key);
  return site?.status === 'deleted' ? null : site;
}

export async function listWebsiteSites(ownerJid) {
  const owner = normalizeJid(ownerJid);
  return Object.values(await listRecords('website.site')).filter(site => site.ownerJid === owner && site.status !== 'deleted').sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function assertSiteOwner(ownerJid, site) {
  if (!site || site.status === 'deleted' || site.ownerJid !== normalizeJid(ownerJid)) throw new Error('Website tidak ditemukan pada akun Anda.');
  if (site.source === 'rental') {
    const tenant = await getTenantStatus(site.groupJid);
    if (!tenant.tenant || tenant.status !== 'active') throw new Error('Sewa grup tidak aktif. Website tetap tersimpan, tetapi perubahan dan penerbitan baru ditangguhkan sampai sewa aktif kembali.');
    if (normalizeJid(tenant.tenant.billingContact) !== normalizeJid(ownerJid)) throw new Error('Akses website rental hanya dimiliki kontak pemesan/pembayar sewa.');
  }
  return site;
}

const EDITABLE_FIELDS = new Set(['title', 'tagline', 'description', 'about', 'ctaText', 'whatsapp', 'email', 'instagram', 'location', 'primaryColor', 'secondaryColor', 'customSections']);
export async function updateWebsiteSite(ownerJid, slug, patch = {}) {
  return withLock(`website-site:${slugify(slug)}`, async () => {
    const site = await getWebsiteSite(slug);
    await assertSiteOwner(ownerJid, site);
    const next = { ...site };
    for (const [key, value] of Object.entries(patch)) {
      if (!EDITABLE_FIELDS.has(key)) continue;
      if (key === 'customSections') {
        if (!Array.isArray(value) || value.length > 6) throw new Error('Bagian tambahan harus berupa array maksimum enam bagian.');
        next.customSections = value.map(section => ({ title: cleanText(section?.title, 80), body: cleanText(section?.body, 1200) })).filter(section => section.title && section.body);
      } else if (['primaryColor', 'secondaryColor'].includes(key)) {
        const color = String(value || '').trim();
        if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`${key} harus berupa warna hex #RRGGBB.`);
        next[key] = color;
      } else {
        next[key] = cleanText(value, key === 'description' || key === 'about' ? 1200 : key === 'title' ? 80 : 240);
      }
    }
    next.updatedAt = nowIso(); next.version = Number(site.version || 1) + 1;
    await putRecord('website.site', site.slug, next, { actor: normalizeJid(ownerJid), reason: 'website content updated' });
    await putRecord('website.audit', `${site.id}-EDIT-${Date.now()}`, { action: 'site.updated', siteId: site.id, slug: site.slug, fields: Object.keys(patch).filter(key => EDITABLE_FIELDS.has(key)), actor: normalizeJid(ownerJid), at: next.updatedAt }, { source: 'website-builder' });
    return next;
  });
}

function detectMedia(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg', kind: 'image', maxBytes: MAX_IMAGE_BYTES };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { ext: 'png', mime: 'image/png', kind: 'image', maxBytes: MAX_IMAGE_BYTES };
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp', kind: 'image', maxBytes: MAX_IMAGE_BYTES };
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return { ext: 'mp4', mime: 'video/mp4', kind: 'video', maxBytes: MAX_VIDEO_BYTES };
  return null;
}

export async function createWebsitePost(ownerJid, slug, { caption = '', media = null } = {}) {
  return withLock(`website-site:${slugify(slug)}`, async () => {
    const site = await getWebsiteSite(slug);
    await assertSiteOwner(ownerJid, site);
    const text = cleanText(caption, 2000);
    if (!text && !media) throw new Error('Post harus memiliki caption atau foto.');
    if (site.posts.length >= 100) throw new Error('Website sudah mencapai 100 post. Arsipkan konten lama sebelum menambah post berikutnya.');
    let asset = null;
    if (media) {
      const buffer = Buffer.isBuffer(media) ? media : Buffer.from(media);
      if (!buffer.length) throw new Error('Media kosong.');
      const type = detectMedia(buffer);
      if (!type) throw new Error('Media post menerima JPG, PNG, WEBP, atau MP4 yang valid.');
      if (buffer.length > type.maxBytes) throw new Error(type.kind === 'video' ? 'Video melebihi 20 MB per file.' : 'Foto melebihi 10 MB per file.');
      const used = site.assets.reduce((sum, item) => sum + Number(item.size || 0), 0);
      if (used + buffer.length > MAX_SITE_ASSETS) throw new Error('Penyimpanan media website sudah mencapai 50 MB.');
      const assetId = crypto.randomBytes(12).toString('hex');
      const directory = path.join(ASSET_ROOT, site.id);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const fileName = `${assetId}.${type.ext}`;
      await fs.writeFile(path.join(directory, fileName), buffer, { flag: 'wx', mode: 0o600 });
      asset = { id: assetId, fileName, mime: type.mime, kind: type.kind, size: buffer.length, createdAt: nowIso() };
    }
    const post = { id: `POST-${crypto.randomBytes(6).toString('hex').toUpperCase()}`, caption: text, assetId: asset?.id || null, createdAt: nowIso() };
    const next = { ...site, posts: [...site.posts, post], assets: asset ? [...site.assets, asset] : site.assets, updatedAt: nowIso(), version: Number(site.version || 1) + 1 };
    await putRecord('website.site', site.slug, next, { actor: normalizeJid(ownerJid), reason: 'website post created' });
    await putRecord('website.audit', `${site.id}-POST-${post.id}`, { action: 'post.created', siteId: site.id, postId: post.id, hasMedia: Boolean(asset), actor: normalizeJid(ownerJid), at: post.createdAt }, { source: 'website-builder' });
    return { site: next, post };
  });
}

function themeFor(template) {
  const themes = {
    business: { bg: '#f2f5f8', panel: '#ffffff', ink: '#142238', accent: '#c29a56', font: 'Inter,system-ui,sans-serif', radius: '22px' },
    portfolio: { bg: '#f4f1ea', panel: '#fffdf8', ink: '#25221d', accent: '#c45d43', font: 'Georgia,serif', radius: '5px' },
    agency: { bg: '#0d1024', panel: '#171b37', ink: '#f4f3ff', accent: '#a996ff', font: 'Inter,system-ui,sans-serif', radius: '18px' },
    storefront: { bg: '#f7f0e7', panel: '#fffaf3', ink: '#33271e', accent: '#b47b4d', font: 'Inter,system-ui,sans-serif', radius: '26px' },
    creator: { bg: '#111111', panel: '#202020', ink: '#faf7f2', accent: '#efb8a6', font: 'Arial,sans-serif', radius: '10px' },
    restaurant: { bg: '#101b16', panel: '#1b2b23', ink: '#f6f0e5', accent: '#d4b06d', font: 'Georgia,serif', radius: '2px' },
    event: { bg: '#fff3ee', panel: '#ffffff', ink: '#351e35', accent: '#e46b62', font: 'Inter,system-ui,sans-serif', radius: '28px' }
  };
  return themes[template] || themes.business;
}

export async function addWebsiteSection(ownerJid, slug, title, body) {
  const site = await getWebsiteSite(slug);
  await assertSiteOwner(ownerJid, site);
  const sections = Array.isArray(site.customSections) ? [...site.customSections] : [];
  if (sections.length >= 6) throw new Error('Website sudah memiliki enam bagian tambahan.');
  const heading = cleanText(title, 80); const content = cleanText(body, 1200);
  if (!heading || !content) throw new Error('Judul dan isi bagian tambahan wajib diisi.');
  sections.push({ title: heading, body: content });
  return updateWebsiteSite(ownerJid, slug, { customSections: sections });
}

export function renderWebsiteHtml(site) {
  const theme = themeFor(site.template);
  const base = `/w/${encodeURIComponent(site.slug)}/${encodeURIComponent(site.publicToken)}`;
  const posts = (site.posts || []).slice().reverse().map(post => {
    const asset = (site.assets || []).find(item => item.id === post.assetId);
    const assetUrl = asset ? `${base}/assets/${encodeURIComponent(asset.fileName)}` : '';
    const media = asset?.kind === 'video' || asset?.mime?.startsWith('video/')
      ? `<video class="post-media" controls preload="metadata"><source src="${assetUrl}" type="video/mp4">Browser Anda tidak mendukung video.</video>`
      : asset ? `<img class="post-media" loading="lazy" src="${assetUrl}" alt="Media post">` : '';
    return `<article class="post">${media}<p>${escapeHtml(post.caption).replace(/\n/g, '<br>')}</p><small>${new Date(post.createdAt).toLocaleDateString('id-ID')}</small></article>`;
  }).join('');
  const contact = [site.location, site.email, site.instagram ? `Instagram: ${site.instagram}` : ''].filter(Boolean).map(escapeHtml).join(' · ');
  const phone = String(site.whatsapp || '').replace(/\D/g, '');
  const ctaUrl = phone ? `https://wa.me/${phone}` : '#kontak';
  const sections = (site.customSections || []).map(section => `<section class="custom"><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body)}</p></section>`).join('');
  const templateLabel = getWebsiteTemplate(site.template)?.name || 'Website';
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="description" content="${escapeHtml(site.description)}"><meta name="theme-color" content="${theme.ink}"><title>${escapeHtml(site.title)} · ${templateLabel}</title><style>
:root{--bg:${theme.bg};--panel:${theme.panel};--ink:${theme.ink};--accent:${theme.accent};--custom:${site.primaryColor};--soft:${site.secondaryColor}}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font:16px ${theme.font};line-height:1.65}a{color:inherit}.wrap{width:min(1080px,calc(100% - 36px));margin:auto}.nav{display:flex;align-items:center;justify-content:space-between;padding:22px 0;border-bottom:1px solid color-mix(in srgb,var(--ink) 14%,transparent)}.brand{font-weight:800;letter-spacing:.04em;text-decoration:none}.nav a:last-child{color:var(--accent);text-decoration:none;font-size:.9rem}.hero{padding:clamp(72px,12vw,150px) 0 90px;max-width:850px}.eyebrow{text-transform:uppercase;letter-spacing:.18em;font-size:.72rem;color:var(--accent);font-weight:800}.hero h1{font-size:clamp(2.7rem,8vw,6.4rem);line-height:.98;letter-spacing:-.055em;margin:18px 0 24px}.hero p{font-size:clamp(1.05rem,2vw,1.3rem);max-width:680px;opacity:.8}.cta{display:inline-flex;margin-top:22px;padding:14px 22px;border-radius:${theme.radius};background:var(--custom);color:#fff;text-decoration:none;font-weight:750}.section{padding:64px 0}.section h2{font-size:clamp(1.8rem,4vw,3rem);line-height:1.1;letter-spacing:-.04em}.about{max-width:760px;font-size:1.1rem;opacity:.85}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px}.tile,.post,.custom{background:var(--panel);padding:24px;border-radius:${theme.radius};border:1px solid color-mix(in srgb,var(--ink) 10%,transparent)}.tile strong{display:block;color:var(--accent);font-size:1.05rem;margin-bottom:8px}.posts{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}.post{padding:14px}.post p{white-space:normal}.post small{opacity:.55}.post-media{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:calc(${theme.radius} * .7)}.contact{padding:34px;background:var(--panel);border-radius:${theme.radius};margin:30px 0}.footer{padding:32px 0 48px;opacity:.55;font-size:.82rem;border-top:1px solid color-mix(in srgb,var(--ink) 14%,transparent)}
${site.template === 'agency' ? '.hero{max-width:960px}.hero h1{background:linear-gradient(100deg,#fff,#a996ff);-webkit-background-clip:text;color:transparent}.tile{box-shadow:0 14px 50px #0004}' : ''}
${site.template === 'portfolio' ? '.hero{padding-top:130px}.hero h1{font-weight:500}.section h2{font-weight:500}.cta{border-radius:0}' : ''}
${site.template === 'storefront' ? '.hero{background:var(--panel);padding:clamp(50px,8vw,110px);border-radius:30px;margin-top:34px}.tile{box-shadow:0 8px 30px #43210d0c}' : ''}
${site.template === 'creator' ? '.nav{border-color:#ffffff24}.hero h1{font-weight:900}.cta{color:#111;background:var(--soft)}' : ''}
${site.template === 'restaurant' ? '.hero{margin-top:35px;border:1px solid var(--accent);padding:clamp(48px,9vw,110px)}.hero h1{font-weight:500}.cta{color:#142019}' : ''}
${site.template === 'event' ? '.hero{margin-top:25px;background:var(--panel);border-radius:32px;padding:clamp(48px,9vw,110px)}.hero h1{color:var(--custom)}.cta{box-shadow:0 10px 26px #e46b6233}' : ''}
@media(max-width:600px){.nav{padding:16px 0}.hero{padding:70px 0 55px}.section{padding:45px 0}.tile,.custom{padding:18px}}
</style></head><body><header class="wrap nav"><a class="brand" href="#top">${escapeHtml(site.title)}</a><a href="#kontak">${escapeHtml(site.ctaText || 'Hubungi Kami')} ↗</a></header><main id="top" class="wrap"><section class="hero"><span class="eyebrow">${templateLabel}</span><h1>${escapeHtml(site.title)}</h1><p><strong>${escapeHtml(site.tagline)}</strong></p><p>${escapeHtml(site.description)}</p><a class="cta" href="${ctaUrl}">${escapeHtml(site.ctaText || 'Hubungi Kami')}</a></section><section class="section"><h2>Tentang</h2><p class="about">${escapeHtml(site.about || site.description)}</p></section><section class="section"><h2>Informasi</h2><div class="grid"><article class="tile"><strong>Profil</strong><span>${escapeHtml(site.title)}</span></article><article class="tile"><strong>Layanan / Karya</strong><span>${escapeHtml(site.tagline)}</span></article><article class="tile"><strong>Kontak</strong><span>${escapeHtml(site.location || 'Hubungi kami melalui WhatsApp')}</span></article></div></section>${sections}<section class="section"><h2>Posting Terbaru</h2><div class="posts">${posts || '<article class="post"><p>Belum ada posting. Informasi terbaru akan ditampilkan di bagian ini.</p></article>'}</div></section><section id="kontak" class="contact"><span class="eyebrow">Terhubung</span><h2>${escapeHtml(site.ctaText || 'Hubungi Kami')}</h2><p>${contact || 'Silakan hubungi kami melalui WhatsApp untuk informasi lebih lanjut.'}</p>${phone ? `<a class="cta" href="${ctaUrl}">Chat WhatsApp</a>` : ''}</section></main><footer class="wrap footer">© ${new Date().getFullYear()} ${escapeHtml(site.title)} · Dibangun dengan Ocha Website Builder</footer></body></html>`;
}

export async function publishWebsiteSite(ownerJid, slug, baseUrl) {
  return withLock(`website-site:${slugify(slug)}`, async () => {
    const site = await getWebsiteSite(slug);
    await assertSiteOwner(ownerJid, site);
    if (site.source === 'verified' && !site.slotClaimedAt) {
      await claimWebsiteSlot(ownerJid, site.id);
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const publishedAt = nowIso();
    const next = { ...site, status: 'published', publicTokenHash: hash(token), publishedAt, slotClaimedAt: site.slotClaimedAt || (site.source === 'verified' ? publishedAt : null), updatedAt: publishedAt, version: Number(site.version || 1) + 1 };
    await putRecord('website.site', site.slug, next, { actor: normalizeJid(ownerJid), reason: 'website published to shared TryCloudflare gateway' });
    await putRecord('website.audit', `${site.id}-PUBLISH-${Date.now()}`, { action: 'site.published', siteId: site.id, slug: site.slug, actor: normalizeJid(ownerJid), at: next.publishedAt }, { source: 'website-builder' });
    return { ...next, publicUrl: `${String(baseUrl).replace(/\/$/, '')}/w/${encodeURIComponent(site.slug)}/${encodeURIComponent(token)}` };
  });
}

export async function getPublicWebsiteResource(slug, token, resourcePath = '') {
  const site = await getWebsiteSite(slug);
  if (!site || site.status !== 'published' || !site.publicTokenHash || !safeEqual(site.publicTokenHash, hash(token))) return { status: 404, contentType: 'text/plain; charset=utf-8', body: Buffer.from('Website tidak ditemukan.') };
  const normalized = String(resourcePath || '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized === 'index.html') {
    const body = renderWebsiteHtml({ ...site, publicToken: token });
    return { status: 200, contentType: 'text/html; charset=utf-8', body: Buffer.from(body) };
  }
  const match = normalized.match(/^assets\/([a-f0-9]{24}\.(?:jpg|png|webp|mp4))$/i);
  if (!match) return { status: 404, contentType: 'text/plain; charset=utf-8', body: Buffer.from('Resource tidak ditemukan.') };
  const asset = site.assets.find(item => item.fileName === match[1]);
  if (!asset) return { status: 404, contentType: 'text/plain; charset=utf-8', body: Buffer.from('Media tidak ditemukan.') };
  try {
    const body = await fs.readFile(path.join(ASSET_ROOT, site.id, asset.fileName));
    return { status: 200, contentType: asset.mime, body };
  } catch { return { status: 404, contentType: 'text/plain; charset=utf-8', body: Buffer.from('Media tidak tersedia.') }; }
}

export async function createWebsiteEditorSession(ownerJid, slug, baseUrl) {
  const site = await getWebsiteSite(slug);
  await assertSiteOwner(ownerJid, site);
  const token = crypto.randomBytes(32).toString('base64url');
  const record = { slug: site.slug, ownerJid: normalizeJid(ownerJid), tokenHash: hash(token), createdAt: nowIso(), expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() };
  await putRecord('website.editor-session', site.slug, record, { actor: normalizeJid(ownerJid), reason: 'website editor session created' });
  await putRecord('website.audit', `${site.id}-EDITOR-${Date.now()}`, { action: 'editor.session-created', siteId: site.id, slug: site.slug, actor: normalizeJid(ownerJid), at: record.createdAt }, { source: 'website-builder' });
  return `${String(baseUrl).replace(/\/$/, '')}/editor/${encodeURIComponent(site.slug)}#${token}`;
}

function response(res, status, body, contentType = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra });
  res.end(body);
}
async function readBody(req, limit = 16 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('Body terlalu besar.'); chunks.push(chunk); }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Body JSON harus berupa object.');
  return parsed;
}
async function authorizeEditor(req, slug) {
  const session = await getRecord('website.editor-session', slug);
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
  const origin = req.headers.origin;
  if (origin) {
    const host = String(req.headers.host || '').toLowerCase();
    let parsed;
    try { parsed = new URL(origin); } catch { return null; }
    if (parsed.host.toLowerCase() !== host) return null;
  }
  const authorization = String(req.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token || !safeEqual(session.tokenHash, hash(token))) return null;
  return session;
}

export async function handleWebsiteEditorRequest(req, res, url) {
  const editorMatch = url.pathname.match(/^\/editor\/([a-z0-9-]{1,48})\/?$/i);
  const apiMatch = url.pathname.match(/^\/editor-api\/([a-z0-9-]{1,48})\/?$/i);
  if (!editorMatch && !apiMatch) return false;
  const slug = decodeURIComponent((editorMatch || apiMatch)[1]);
  if (editorMatch && req.method === 'GET') {
    const nonce = crypto.randomBytes(16).toString('base64');
    const html = `<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Website Editor · Ocha</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f5f8;color:#172033;font:15px system-ui}.shell{max-width:820px;margin:30px auto;padding:18px}.panel{background:#fff;border:1px solid #dce2eb;border-radius:18px;padding:22px;margin:14px 0}h1{font-size:28px;margin:0 0 8px}label{display:block;font-size:13px;font-weight:700;margin:14px 0 5px}input,textarea{width:100%;padding:12px;border:1px solid #cbd3df;border-radius:9px;font:inherit}textarea{min-height:100px}button{border:0;border-radius:9px;background:#182941;color:white;padding:12px 16px;font-weight:700;margin-top:14px}small{color:#617087}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:600px){.grid{grid-template-columns:1fr}.shell{margin:10px auto;padding:10px}}</style><main class="shell"><h1>Website Editor</h1><small>Ocha Website Builder · Perubahan disimpan ke situs permanen.</small><div class="panel"><label>Judul website</label><input id="title" maxlength="80"><label>Tagline</label><input id="tagline" maxlength="180"><label>Deskripsi</label><textarea id="description" maxlength="1200"></textarea><label>Tentang</label><textarea id="about" maxlength="1200"></textarea><div class="grid"><div><label>WhatsApp</label><input id="whatsapp" maxlength="20"></div><div><label>Instagram</label><input id="instagram" maxlength="80"></div><div><label>Warna utama</label><input id="primaryColor" type="color"></div><div><label>Warna aksen</label><input id="secondaryColor" type="color"></div></div><label>Lokasi / alamat</label><input id="location" maxlength="240"><label>Bagian tambahan · judul</label><input id="sectionTitle" maxlength="80"><label>Bagian tambahan · isi</label><textarea id="sectionBody" maxlength="1200"></textarea><label>Teks tombol</label><input id="ctaText" maxlength="80"><button id="save">Simpan perubahan</button><p id="status" role="status"></p></div><p><small>Token editor hanya berlaku 24 jam. Jangan bagikan tautan editor kepada orang lain.</small></p></main><script nonce="${nonce}">(()=>{const slug=${JSON.stringify(slug)};let token=location.hash.slice(1);history.replaceState(null,'',location.pathname);const fields=['title','tagline','description','about','whatsapp','instagram','primaryColor','secondaryColor','location','ctaText'];const status=document.querySelector('#status');async function call(method='GET',payload){const response=await fetch('/editor-api/'+encodeURIComponent(slug),{method,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Permintaan gagal');return data;}async function load(){try{const data=await call();for(const field of fields){const el=document.getElementById(field);if(el)el.value=data.site[field]|| (field==='primaryColor'?'#17243b':field==='secondaryColor'?'#d7b77a':'');}const section=data.site.customSections?.[0]||{};document.getElementById('sectionTitle').value=section.title||'';document.getElementById('sectionBody').value=section.body||'';}catch(e){status.textContent=e.message;document.querySelector('#save').disabled=true;}}document.querySelector('#save').addEventListener('click',async()=>{const patch={};for(const field of fields)patch[field]=document.getElementById(field).value;const sectionTitle=document.getElementById('sectionTitle').value.trim();const sectionBody=document.getElementById('sectionBody').value.trim();patch.customSections=sectionTitle&&sectionBody?[{title:sectionTitle,body:sectionBody}]:[];try{await call('PATCH',patch);status.textContent='Perubahan berhasil disimpan.';}catch(e){status.textContent=e.message;}});if(token)load();else{status.textContent='Tautan editor tidak memiliki token. Minta tautan baru melalui WhatsApp.';document.querySelector('#save').disabled=true;}})();</script></html>`;
    return response(res, 200, html, 'text/html; charset=utf-8', { 'Content-Security-Policy': `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`, 'X-Frame-Options': 'DENY' });
  }
  if (apiMatch && ['GET', 'PATCH'].includes(req.method)) {
    const auth = await authorizeEditor(req, slug);
    if (!auth) return response(res, 401, JSON.stringify({ error: 'Sesi editor tidak valid atau kedaluwarsa.' }));
    try {
      if (req.method === 'GET') {
        const site = await getWebsiteSite(slug);
        await assertSiteOwner(auth.ownerJid, site);
        const { publicTokenHash, ...safe } = site;
        return response(res, 200, JSON.stringify({ site: safe }));
      }
      const patch = await readBody(req);
      const site = await updateWebsiteSite(auth.ownerJid, slug, patch);
      return response(res, 200, JSON.stringify({ ok: true, version: site.version }));
    } catch (error) { return response(res, 400, JSON.stringify({ error: error.message })); }
  }
  return response(res, 405, JSON.stringify({ error: 'Method tidak diizinkan.' }));
}

export async function createWebsiteShareCard(ownerJid, slug, postId) {
  const site = await getWebsiteSite(slug);
  await assertSiteOwner(ownerJid, site);
  const post = site.posts.find(item => item.id === postId);
  if (!post) throw new Error('Post tidak ditemukan pada website ini.');
  const asset = site.assets.find(item => item.id === post.assetId);
  let mediaData = '';
  if (asset && asset.mime?.startsWith('image/')) {
    const raw = await fs.readFile(path.join(ASSET_ROOT, site.id, asset.fileName));
    mediaData = `data:${asset.mime};base64,${raw.toString('base64')}`;
  }
  const accent = /^#[0-9a-f]{6}$/i.test(site.primaryColor) ? site.primaryColor : '#17243b';
  const title = escapeHtml(site.title).slice(0, 80);
  const words = cleanText(post.caption, 2000).split(/\s+/).filter(Boolean);
  const lines = []; let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > 46 && line) { lines.push(line); line = word; }
    else line = candidate;
    if (lines.length >= 4) break;
  }
  if (line && lines.length < 5) lines.push(line);
  const captionSvg = lines.slice(0, 5).map((value, index) => `<tspan x="72" dy="${index === 0 ? 0 : 56}">${escapeHtml(value)}</tspan>`).join('');
  const image = mediaData ? `<image href="${mediaData}" x="64" y="250" width="1072" height="430" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip)"/>` : '';
  const y = mediaData ? 750 : 500;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="${accent}"/><stop offset="1" stop-color="#111827"/></linearGradient><clipPath id="clip"><rect x="64" y="250" width="1072" height="430" rx="28"/></clipPath></defs><rect width="1200" height="1200" fill="#f2f0eb"/><rect x="32" y="32" width="1136" height="1136" rx="34" fill="url(#bg)"/><text x="72" y="125" fill="#fff" font-family="Arial" font-size="30" font-weight="700">${title}</text><rect x="72" y="155" width="100" height="5" fill="#d7b77a"/>${image}<text x="72" y="${y}" fill="#fff" font-family="Arial" font-size="36" font-weight="500">${captionSvg}</text><text x="72" y="1090" fill="#ffffffaa" font-family="Arial" font-size="22">${escapeHtml(site.slug)} · Ocha Website</text></svg>`;
  const sharpModule = await import('sharp').catch(() => null);
  if (!sharpModule?.default) throw new Error('Modul sharp belum terpasang. Jalankan npm install agar kartu share PNG dapat dibuat.');
  return sharpModule.default(Buffer.from(svg)).png().toBuffer();
}

export async function handleWebsitePublicRequest(req, res, url) {
  const match = url.pathname.match(/^\/w\/([a-z0-9-]{1,48})\/([A-Za-z0-9_-]{40,60})(?:\/(.*))?$/i);
  if (!match) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }); res.end(); return true;
  }
  let resourcePath = '';
  try { resourcePath = decodeURIComponent(match[3] || ''); }
  catch { res.writeHead(400, { 'Cache-Control': 'no-store' }); res.end('Invalid path'); return true; }
  const result = await getPublicWebsiteResource(match[1], match[2], resourcePath);
  let status = result.status;
  let body = result.body;
  const headers = {
    'Content-Type': result.contentType,
    'Cache-Control': result.contentType.startsWith('image/') ? 'public, max-age=300' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  };
  if (result.contentType === 'video/mp4') {
    headers['Accept-Ranges'] = 'bytes';
    const range = String(req.headers.range || '');
    if (range) {
      const parsed = range.match(/^bytes=(\d*)-(\d*)$/);
      const total = result.body.length;
      let start = parsed && parsed[1] ? Number(parsed[1]) : parsed && parsed[2] ? Math.max(0, total - Number(parsed[2])) : NaN;
      let end = parsed && parsed[2] && parsed[1] ? Number(parsed[2]) : total - 1;
      if (!parsed || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= total || end < start) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${total}` }); res.end(); return true;
      }
      end = Math.min(end, total - 1);
      body = result.body.subarray(start, end + 1);
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
    }
  }
  headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') res.end(); else res.end(body);
  return true;
}
