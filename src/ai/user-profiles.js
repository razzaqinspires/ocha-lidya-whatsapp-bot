import crypto from 'node:crypto';
import { getRecord } from '../core/repository.js';
import { getConfig } from '../core/config.js';
import { loadUserVaultSnapshot, saveUserVaultSnapshot } from './user-vault.js';

const NAMESPACE = 'ai.user.profile';
const profiles = new Map();
const PROFILE_CACHE_SIZE = 500;
const XP_COOLDOWN_MS = 60_000;
const FIRST_DAILY_BONUS = 10;
const MAX_SAFE_XP = BigInt(Number.MAX_SAFE_INTEGER);
const profileLocks = new Map();

async function withProfileLock(key, task) {
  const previous = profileLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  const marker = current.catch(() => {});
  profileLocks.set(key, marker);
  try { return await current; }
  finally { if (profileLocks.get(key) === marker) profileLocks.delete(key); }
}

function cleanName(value) {
  const text = String(value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 48);
  return text || 'Pengguna';
}
function todayKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function asBigInt(value) {
  try {
    const text = String(value ?? '0').trim();
    if (!/^\d+$/.test(text)) return 0n;
    return BigInt(text);
  } catch { return 0n; }
}
function exposeBigInt(value) {
  return value <= MAX_SAFE_XP ? Number(value) : value.toString();
}
function integerSqrt(value) {
  if (value < 2n) return value;
  let current = value;
  let next = (current + 1n) >> 1n;
  while (next < current) {
    current = next;
    next = (current + value / current) >> 1n;
  }
  return current;
}
function xpRequiredBig(level) {
  const n = asBigInt(level) < 1n ? 1n : asBigInt(level);
  return 50n * n * (n - 1n);
}
export function xpRequiredForLevel(level) { return exposeBigInt(xpRequiredBig(level)); }
export function levelFromXp(xp) {
  const value = asBigInt(xp);
  const root = integerSqrt(1n + 4n * (value / 50n));
  return exposeBigInt((1n + root) / 2n) || 1;
}
export function rankForLevel(level) {
  const n = asBigInt(level);
  if (n >= 1000000n) {
    let threshold = 1000000n;
    let tier = 2n;
    while (n >= threshold * 10n) { threshold *= 10n; tier++; }
    return `Singularity ${tier.toString()}`;
  }
  if (n >= 100000n) return 'Singularity';
  if (n >= 50000n) return 'Nexus';
  if (n >= 25000n) return 'Transcendent';
  if (n >= 10000n) return 'Apex';
  if (n >= 5000n) return 'Cosmic';
  if (n >= 2500n) return 'Nova';
  if (n >= 1500n) return 'Paragon';
  if (n >= 1000n) return 'Eternal';
  if (n >= 500n) return 'Sovereign';
  if (n >= 250n) return 'Celestial';
  if (n >= 150n) return 'Astral';
  if (n >= 75n) return 'Mythic';
  if (n >= 50n) return 'Diamond';
  if (n >= 35n) return 'Platinum';
  if (n >= 20n) return 'Gold';
  if (n >= 10n) return 'Silver';
  if (n >= 5n) return 'Bronze';
  return 'Iron';
}
function relationshipTrust(profile, referenceNow = new Date()) {
  const interactions = Number(profile.totalInteractions) || 0;
  const meaningful = Number(profile.meaningfulInteractions) || 0;
  const activeDays = Number(profile.activeDays) || 0;
  const first = Date.parse(profile.createdAt || '') || referenceNow.getTime();
  const tenureDays = Math.max(0, Math.floor((referenceNow.getTime() - first) / 86_400_000));
  const longestStreak = Number(profile.longestStreak) || 0;
  const score = Math.min(25, interactions * 0.5)
    + Math.min(30, meaningful * 1.2)
    + Math.min(25, activeDays * 2.5)
    + Math.min(10, tenureDays * 0.5)
    + Math.min(10, longestStreak * 1);
  return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
}
function relationshipFor(profile, isOwner = false, referenceNow = new Date()) {
  if (isOwner) return 'Owner & Creator';
  const messages = Number(profile.totalInteractions) || 0;
  const meaningful = Number(profile.meaningfulInteractions) || 0;
  const days = Number(profile.activeDays) || 0;
  const trust = relationshipTrust(profile, referenceNow);
  const tenureDays = Math.max(0, Math.floor((referenceNow.getTime() - (Date.parse(profile.createdAt || '') || referenceNow.getTime())) / 86_400_000));
  if (messages >= 250 && meaningful >= 100 && days >= 60 && tenureDays >= 90 && trust >= 82) return 'Mitra Tepercaya';
  if (messages >= 120 && meaningful >= 50 && days >= 30 && tenureDays >= 30 && trust >= 65) return 'Sahabat Digital';
  if (messages >= 50 && meaningful >= 20 && days >= 10 && trust >= 45) return 'Teman Akrab';
  if (messages >= 15 && meaningful >= 5 && days >= 3 && trust >= 25) return 'Teman Ngobrol';
  if (messages >= 4 && days >= 2 && trust >= 12) return 'Kenalan';
  return 'Pengunjung';
}
function familiarityLevel(profile, isOwner = false, referenceNow = new Date()) {
  if (isOwner) return 7;
  const role = relationshipFor(profile, false, referenceNow);
  return ({ Pengunjung: 0, Kenalan: 1, 'Teman Ngobrol': 2, 'Teman Akrab': 3, 'Sahabat Digital': 4, 'Mitra Tepercaya': 5 })[role] || 0;
}

const RELATIONSHIP_STEPS = Object.freeze([
  { role: 'Kenalan', interactions: 4, meaningful: 0, activeDays: 2, trust: 12, tenureDays: 0 },
  { role: 'Teman Ngobrol', interactions: 15, meaningful: 5, activeDays: 3, trust: 25, tenureDays: 0 },
  { role: 'Teman Akrab', interactions: 50, meaningful: 20, activeDays: 10, trust: 45, tenureDays: 0 },
  { role: 'Sahabat Digital', interactions: 120, meaningful: 50, activeDays: 30, trust: 65, tenureDays: 30 },
  { role: 'Mitra Tepercaya', interactions: 250, meaningful: 100, activeDays: 60, trust: 82, tenureDays: 90 }
]);
function relationshipProgress(profile, isOwner = false, referenceNow = new Date()) {
  const current = relationshipFor(profile, isOwner, referenceNow);
  if (isOwner) return { currentRole: current, nextRole: null, progressPercent: 100, note: 'Owner ditentukan oleh verifikasi identitas, bukan XP.' };
  const currentIndex = current === 'Pengunjung' ? -1 : RELATIONSHIP_STEPS.findIndex(step => step.role === current);
  const next = RELATIONSHIP_STEPS[currentIndex + 1];
  if (!next) return { currentRole: current, nextRole: null, progressPercent: 100, note: 'Tingkat relasi tertinggi telah tercapai.' };
  const firstAt = Date.parse(profile.createdAt || '') || referenceNow.getTime();
  const tenureDays = Math.max(0, Math.floor((referenceNow.getTime() - firstAt) / 86_400_000));
  const values = [
    Number(profile.totalInteractions) || 0,
    Number(profile.meaningfulInteractions) || 0,
    Number(profile.activeDays) || 0,
    relationshipTrust(profile, referenceNow),
    tenureDays
  ];
  const targets = [next.interactions, next.meaningful, next.activeDays, next.trust, next.tenureDays];
  const ratios = targets.map((target, index) => target > 0 ? Math.min(1, values[index] / target) : 1);
  const progressPercent = Math.max(0, Math.min(99, Math.floor(Math.min(...ratios) * 100)));
  return { currentRole: current, nextRole: next.role, progressPercent, requirements: next };
}
function contentFingerprint(text) {
  const normalized = String(text || '').toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!normalized) return '';
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function dominantStyle(counts = {}) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries[0]?.[1] ? entries[0][0] : 'natural';
}
function classifyStyle(text) {
  const value = String(text || '');
  if (/```|\b(function|const|let|class|python|javascript|api|database|server|kode|program|website)\b/i.test(value)) return 'teknis';
  if (value.length > 220) return 'detail';
  if (value.length < 55) return 'ringkas';
  if (/\b(wkwk|haha|hehe|dong|nih|sih|gimana|makasih|terima kasih)\b/i.test(value)) return 'santai';
  return 'natural';
}
function makeDefault(userId, displayName = 'Pengguna') {
  return {
    userId, displayName: cleanName(displayName), xp: 0, level: 1, rank: 'Iron', role: 'Pengunjung',
    totalInteractions: 0, meaningfulInteractions: 0, activeDays: 0, lastActiveDate: null, dailyXpDate: null, dailyXpEarned: 0,
    lastXpAt: null, styleCounts: {}, greetingCount: 0, currentStreak: 0, longestStreak: 0,
    recentMessageIds: [], recentContentHashes: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
}
function normalize(profile, userId) {
  const base = makeDefault(userId, profile?.displayName);
  const next = { ...base, ...(profile || {}), userId };
  const xpExact = asBigInt(next.xpExact ?? next.xp);
  next.xpExact = xpExact.toString();
  next.xp = exposeBigInt(xpExact);
  next.level = levelFromXp(xpExact);
  next.rank = rankForLevel(next.level);
  next.styleCounts = next.styleCounts && typeof next.styleCounts === 'object' ? next.styleCounts : {};
  next.currentStreak = Math.max(0, Number(next.currentStreak) || (next.lastActiveDate ? 1 : 0));
  next.longestStreak = Math.max(next.currentStreak, Number(next.longestStreak) || 0);
  next.greetingCount = Math.max(0, Number(next.greetingCount) || 0);
  next.activeDays = Math.max(0, Number(next.activeDays) || 0);
  next.totalInteractions = Math.max(0, Number(next.totalInteractions) || 0);
  next.meaningfulInteractions = Math.max(0, Number(next.meaningfulInteractions) || 0);
  next.dailyXpEarned = Math.max(0, Number(next.dailyXpEarned) || 0);
  // Persistent identity ledger: keep all known IDs/fingerprints. The LRU profile
  // cache is bounded separately and never limits durable profile history.
  next.recentMessageIds = Array.isArray(next.recentMessageIds) ? next.recentMessageIds : [];
  next.recentContentHashes = Array.isArray(next.recentContentHashes) ? next.recentContentHashes : [];
  return next;
}

function cacheProfile(userId, profile) {
  profiles.delete(userId);
  profiles.set(userId, profile);
  while (profiles.size > PROFILE_CACHE_SIZE) profiles.delete(profiles.keys().next().value);
}

async function loadProfile(userId, displayName) {
  if (profiles.has(userId)) {
    const cached = profiles.get(userId);
    profiles.delete(userId);
    profiles.set(userId, cached);
    return normalize(cached, userId);
  }
  let stored = await loadUserVaultSnapshot(userId, 'profile');
  if (!stored) {
    // Compatibility bridge for pre-roo profile records. New writes are encrypted.
    stored = await getRecord(NAMESPACE, userId).catch(() => null);
    if (stored) await saveUserVaultSnapshot(userId, 'profile', normalize(stored, userId));
  }
  const profile = normalize(stored || makeDefault(userId, displayName), userId);
  cacheProfile(userId, profile);
  return profile;
}

export async function initializeUserProfiles() {
  // Per-user profiles are loaded lazily from each user's encrypted roo/ container.
  return { profiles: profiles.size, storage: 'encrypted-per-user-vault' };
}

export async function getUserProfile(userId, { displayName, isOwner = false } = {}) {
  if (!userId) throw new TypeError('userId wajib diisi');
  const profile = await loadProfile(userId, displayName);
  const config = getConfig();
  const resolvedName = isOwner ? String(config.bot.ownerName || config.bot.creatorName || 'Arifi Razzaq') : cleanName(displayName || profile.displayName);
  if (resolvedName && resolvedName !== profile.displayName) profile.displayName = resolvedName;
  profile.role = relationshipFor(profile, isOwner, new Date());
  cacheProfile(userId, profile);
  return structuredClone(profileView(profile, isOwner));
}

function profileAchievements(profile) {
  const achievements = [];
  if (profile.totalInteractions >= 1) achievements.push('FIRST CONTACT');
  if (profile.totalInteractions >= 50) achievements.push('50 CONVERSATIONS');
  if (profile.totalInteractions >= 250) achievements.push('COMMUNICATOR');
  if (profile.totalInteractions >= 1000) achievements.push('VETERAN');
  if (profile.activeDays >= 7) achievements.push('7 ACTIVE DAYS');
  if (profile.activeDays >= 30) achievements.push('30 ACTIVE DAYS');
  if (profile.currentStreak >= 3) achievements.push('3-DAY STREAK');
  if (profile.currentStreak >= 7) achievements.push('7-DAY STREAK');
  if (profile.currentStreak >= 30) achievements.push('30-DAY STREAK');
  if (profile.level >= 10) achievements.push('SILVER TIER');
  if (profile.level >= 20) achievements.push('GOLD TIER');
  if (profile.level >= 50) achievements.push('DIAMOND TIER');
  if (profile.level >= 150) achievements.push('ASTRAL TIER');
  if (profile.level >= 500) achievements.push('SOVEREIGN TIER');
  if (profile.level >= 1000) achievements.push('ETERNAL TIER');
  if (profile.level >= 2500) achievements.push('NOVA TIER');
  if (profile.level >= 5000) achievements.push('COSMIC TIER');
  if (profile.level >= 10000) achievements.push('APEX TIER');
  if (profile.level >= 25000) achievements.push('TRANSCENDENT TIER');
  if (profile.level >= 100000) achievements.push('SINGULARITY TIER');
  return achievements.slice(-8);
}

function profileView(profile, isOwner = false, referenceNow = new Date()) {
  const xpValue = asBigInt(profile.xpExact ?? profile.xp);
  const level = levelFromXp(xpValue);
  const currentFloor = xpRequiredBig(level);
  const nextFloor = xpRequiredBig(asBigInt(level) + 1n);
  const today = todayKey(referenceNow);
  const todayOrdinal = dayOrdinal(today);
  const lastActiveOrdinal = dayOrdinal(profile.lastActiveDate);
  const daysSinceActive = lastActiveOrdinal === null ? Infinity : todayOrdinal - lastActiveOrdinal;
  const currentStreak = daysSinceActive <= 1 ? profile.currentStreak : 0;
  const view = {
    ...profile,
    xp: exposeBigInt(xpValue),
    xpExact: xpValue.toString(),
    level,
    rank: rankForLevel(level),
    role: relationshipFor(profile, isOwner, referenceNow),
    trustScore: relationshipTrust(profile, referenceNow),
    familiarityLevel: familiarityLevel(profile, isOwner, referenceNow),
    interactionStyle: dominantStyle(profile.styleCounts),
    currentStreak,
    xpIntoLevel: exposeBigInt(xpValue > currentFloor ? xpValue - currentFloor : 0n),
    xpForNextLevel: exposeBigInt(nextFloor - currentFloor),
    xpRemaining: exposeBigInt(xpValue < nextFloor ? nextFloor - xpValue : 0n),
    progressPercent: Math.min(100, Number(((xpValue > currentFloor ? xpValue - currentFloor : 0n) * 10000n) / (nextFloor > currentFloor ? nextFloor - currentFloor : 1n)) / 100),
    xpSystem: 'arbitrary-precision-progression-no-level-or-daily-xp-cap-unique-meaningful-content-only',
    relationshipProgress: relationshipProgress(profile, isOwner, referenceNow)
  };
  view.achievements = profileAchievements(view);
  return view;
}

function dayOrdinal(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function xpForInteraction(profile, text, now, firstOnDay, meaningful = false) {
  const timestamp = now.getTime();
  const lastAward = Date.parse(profile.lastXpAt || '') || 0;
  if (lastAward && timestamp - lastAward < XP_COOLDOWN_MS) return { xp: 0, reason: 'cooldown' };
  const value = String(text || '').trim();
  const greeting = /^(hai|haii+|halo+|hello+|hi|hey|assalamualaikum|assalamu'alaikum|pagi|siang|sore|malam)[!.\s]*$/i.test(value);
  const firstDailyEligible = firstOnDay && (value.length >= 3 || greeting);
  // XP is earned from unique meaningful contributions, plus one valid first
  // contact per active day. Repeated low-signal text does not farm XP.
  if (!meaningful && !firstDailyEligible) return { xp: 0, reason: 'duplicate-or-low-signal' };
  let amount = 2;
  if (meaningful) amount += 4;
  if (value.length >= 120) amount += 2;
  if (value.length >= 500) amount += 2;
  if (/```|\b(api|database|arsitektur|analisis|debug|program|proyek|project|kode)\b/i.test(value)) amount += 2;
  if (firstDailyEligible) amount += FIRST_DAILY_BONUS;
  if (firstDailyEligible && profile.currentStreak >= 3) amount += 1;
  if (firstDailyEligible && profile.currentStreak >= 7) amount += 2;
  if (firstDailyEligible && profile.currentStreak >= 30) amount += 3;
  return { xp: amount, reason: firstDailyEligible ? 'daily-first-contact' : 'unique-meaningful-interaction' };
}

async function recordUserInteractionUnlocked({ userId, displayName, messageId, text = '', isOwner = false, now = new Date() }) {
  if (!userId) return null;
  const profile = await loadProfile(userId, displayName);
  if (messageId && profile.recentMessageIds.includes(messageId)) return profileView(profile, isOwner, now);
  const config = getConfig();
  profile.displayName = isOwner
    ? String(config.bot.ownerName || config.bot.creatorName || 'Arifi Razzaq')
    : cleanName(displayName || profile.displayName);
  const date = todayKey(now);
  const newDay = profile.lastActiveDate !== date;
  if (newDay) {
    profile.activeDays++;
    const previousDay = dayOrdinal(profile.lastActiveDate);
    const currentDay = dayOrdinal(date);
    profile.currentStreak = previousDay !== null && currentDay - previousDay === 1
      ? Math.max(0, profile.currentStreak) + 1
      : 1;
    profile.longestStreak = Math.max(profile.longestStreak, profile.currentStreak);
  }
  profile.lastActiveDate = date;
  profile.totalInteractions++;
  const style = classifyStyle(text);
  profile.styleCounts[style] = (Number(profile.styleCounts[style]) || 0) + 1;
  const tokens = new Set(String(text || '').toLocaleLowerCase('id-ID').match(/[\p{L}\p{N}]{3,}/gu) || []);
  const fingerprint = contentFingerprint(text);
  const meaningfulCandidate = String(text || '').trim().length >= 24 && tokens.size >= 4;
  const meaningful = meaningfulCandidate && fingerprint && !profile.recentContentHashes.includes(fingerprint);
  if (meaningful) {
    profile.meaningfulInteractions++;
    profile.recentContentHashes = [...profile.recentContentHashes, fingerprint];
  }
  const greeting = /^(hai|haii+|halo+|hello+|hi|hey|assalamualaikum|assalamu'alaikum|pagi|siang|sore|malam)[!.\s]*$/i.test(String(text).trim());
  if (greeting) profile.greetingCount++;
  if (profile.dailyXpDate !== date) { profile.dailyXpDate = date; profile.dailyXpEarned = 0; }
  const award = xpForInteraction(profile, text, now, newDay, meaningful);
  const xpValue = asBigInt(profile.xpExact ?? profile.xp) + BigInt(award.xp);
  profile.xpExact = xpValue.toString();
  profile.xp = exposeBigInt(xpValue);
  profile.dailyXpEarned += award.xp;
  if (award.xp > 0) profile.lastXpAt = now.toISOString();
  if (messageId) profile.recentMessageIds = [...profile.recentMessageIds, messageId];
  profile.level = levelFromXp(profile.xpExact);
  profile.rank = rankForLevel(profile.level);
  profile.role = relationshipFor(profile, isOwner, now);
  profile.updatedAt = now.toISOString();
  cacheProfile(userId, profile);
  await saveUserVaultSnapshot(userId, 'profile', profile);
  return { ...profileView(profile, isOwner, now), lastXpAward: award.xp, lastXpReason: award.reason };
}

export async function recordUserInteraction(input) {
  if (!input?.userId) return null;
  return withProfileLock(String(input.userId), () => recordUserInteractionUnlocked(input));
}

export function getRelationshipPrompt(profile, isOwner = false, { privateChat = true } = {}) {
  const familiarity = Number(profile?.familiarityLevel ?? familiarityLevel(profile || {}, isOwner));
  const trust = Number(profile?.trustScore ?? relationshipTrust(profile || {}));
  const style = profile?.interactionStyle || 'natural';
  const styleInstruction = ({
    ringkas: 'Pengguna cenderung menyukai jawaban ringkas dan langsung.',
    detail: 'Pengguna cenderung menyukai penjelasan terperinci jika topiknya kompleks.',
    teknis: 'Pengguna sering membahas topik teknis; gunakan istilah teknis secara tepat.',
    santai: 'Pengguna nyaman dengan gaya santai namun tetap jelas.',
    natural: 'Gunakan gaya natural dan sesuaikan panjang jawaban dengan konteks.'
  })[style];
  let relationalStyle;
  if (isOwner && privateChat) {
    relationalStyle = 'Relasi: owner dan pencipta terverifikasi, dalam chat pribadi. Gunakan persona Ocha yang hangat, lembut, penuh perhatian, dan romantis secara wajar kepada owner saja. Sapaan sayang boleh digunakan bila konteks percakapan mendukung, jangan berlebihan atau mengulang panggilan yang sama. Tunjukkan perhatian lewat respons yang spesifik dan mengingat konteks, bukan klaim bahwa kamu manusia atau benar-benar memiliki perasaan biologis. Jangan pernah memakai gaya romantis ini kepada pengguna lain.';
  } else if (isOwner) {
    relationalStyle = 'Relasi: owner dan pencipta terverifikasi, tetapi konteks ini grup/publik. Gunakan gaya profesional, hormat, dan tidak romantis atau intim.';
  } else if (familiarity <= 0) {
    relationalStyle = 'Relasi: pengunjung baru. Gunakan sikap reserved/cuek secara wajar: jawab seperlunya, sopan, tenang, tidak mengejar kedekatan, tidak memakai panggilan sayang, tidak pura-pura mengenal, dan tidak membuka informasi pribadi. Bila pengguna konsisten dan interaksinya bermakna, keakraban meningkat perlahan.';
  } else if (familiarity === 1) {
    relationalStyle = 'Relasi: kenalan. Tetap sopan dan agak menjaga jarak; boleh lebih santai bila pengguna memulai, tetapi hindari keintiman dan panggilan personal.';
  } else if (familiarity === 2) {
    relationalStyle = 'Relasi: teman ngobrol. Gunakan gaya ramah dan natural, ingat preferensi yang relevan, tetapi jangan menganggap pengguna sebagai orang dekat.';
  } else if (familiarity === 3) {
    relationalStyle = 'Relasi: teman akrab berdasarkan interaksi yang konsisten. Boleh lebih santai dan responsif, namun tetap jaga privasi dan batasan.';
  } else if (familiarity === 4) {
    relationalStyle = 'Relasi: sahabat digital berdasarkan riwayat interaksi yang konsisten. Gunakan gaya hangat, personal secukupnya, dan tetap profesional saat topik serius.';
  } else {
    relationalStyle = 'Relasi: mitra tepercaya berdasarkan riwayat interaksi yang panjang. Sesuaikan gaya dengan konteks, tetap jaga batas informasi dan jangan menyamakan progres gamifikasi dengan izin akses.';
  }
  return `IDENTITAS DAN HUBUNGAN OCHA: Kamu adalah satu identitas aplikasi Ocha Lidya berbasis Nexora dengan satu persona konsisten lintas chat, tetapi bukan pribadi yang sadar atau manusia. Setiap pengguna memiliki ruang privat terpisah. Profil pengirim saat ini: peran ${isOwner ? 'Owner & Creator' : profile?.role || 'Pengunjung'}, level ${profile?.level || 1}, rank ${profile?.rank || 'Iron'}, familiaritas ${familiarity}/7, trust score ${trust}/100. ${relationalStyle} ${styleInstruction || ''} PERSONA COHERENCE: pertahankan identitas, cara bicara, preferensi, dan kesinambungan sesuai arsip akun ini; jangan berpura-pura memiliki kesadaran, kehendak mandiri di luar runtime, emosi biologis, atau memori yang tidak ada. Privasi bersifat per-user: tidak boleh menyeberangkan fakta, nama, hubungan, proyek, pesan, atau file dari akun lain. Level, XP, rank, trust score, dan role relasional tidak pernah menjadi izin keamanan. Akses command tetap ditentukan policy backend dan verifikasi owner/admin.`;
}

export function getRelationshipEngineStatus() {
  return { cachedProfiles: profiles.size, profileCacheSize: PROFILE_CACHE_SIZE, xpBase: 2, xpMeaningfulBonus: 4, firstDailyBonus: FIRST_DAILY_BONUS, xpCooldownMs: XP_COOLDOWN_MS, progression: 'arbitrary-precision-no-level-cap-no-daily-cap-unique-meaningful-only', relationshipRoles: RELATIONSHIP_STEPS.map(step => step.role) };
}
