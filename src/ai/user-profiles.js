import { listRecords, putRecord } from '../core/repository.js';
import { getConfig } from '../core/config.js';

const NAMESPACE = 'ai.user.profile';
const profiles = new Map();
let initPromise;
const MAX_PROFILES = 5000;
const MAX_RECENT_IDS = 80;
const DAILY_XP_CAP = 100;
const BASE_XP = 5;
const FIRST_DAILY_BONUS = 10;

function cleanName(value) {
  const text = String(value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 48);
  return text || 'Pengguna';
}
function todayKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export function xpRequiredForLevel(level) {
  const n = Math.max(1, Math.floor(Number(level) || 1));
  return 50 * n * (n - 1);
}
export function levelFromXp(xp) {
  const value = Math.max(0, Number(xp) || 0);
  let level = 1;
  while (level < 100 && value >= xpRequiredForLevel(level + 1)) level++;
  return level;
}
export function rankForLevel(level) {
  if (level >= 75) return 'Mythic';
  if (level >= 50) return 'Diamond';
  if (level >= 35) return 'Platinum';
  if (level >= 20) return 'Gold';
  if (level >= 10) return 'Silver';
  if (level >= 5) return 'Bronze';
  return 'Iron';
}
function relationshipFor(profile, isOwner = false) {
  if (isOwner) return 'Owner & Creator';
  const messages = Number(profile.totalInteractions) || 0;
  const days = Number(profile.activeDays) || 0;
  if (messages >= 150 && days >= 21) return 'Sahabat Digital';
  if (messages >= 60 && days >= 7) return 'Teman Akrab';
  if (messages >= 20 && days >= 2) return 'Teman Ngobrol';
  if (messages >= 5) return 'Kenalan';
  return 'Pengunjung';
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
    totalInteractions: 0, activeDays: 0, lastActiveDate: null, dailyXpDate: null, dailyXpEarned: 0,
    styleCounts: {}, greetingCount: 0, currentStreak: 0, longestStreak: 0,
    recentMessageIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
}
function normalize(profile, userId) {
  const base = makeDefault(userId, profile?.displayName);
  const next = { ...base, ...(profile || {}), userId };
  next.xp = Math.max(0, Number(next.xp) || 0);
  next.level = levelFromXp(next.xp);
  next.rank = rankForLevel(next.level);
  next.styleCounts = next.styleCounts && typeof next.styleCounts === 'object' ? next.styleCounts : {};
  next.currentStreak = Math.max(0, Number(next.currentStreak) || (next.lastActiveDate ? 1 : 0));
  next.longestStreak = Math.max(next.currentStreak, Number(next.longestStreak) || 0);
  next.greetingCount = Math.max(0, Number(next.greetingCount) || 0);
  next.activeDays = Math.max(0, Number(next.activeDays) || 0);
  next.totalInteractions = Math.max(0, Number(next.totalInteractions) || 0);
  next.recentMessageIds = Array.isArray(next.recentMessageIds) ? next.recentMessageIds.slice(-MAX_RECENT_IDS) : [];
  return next;
}

export async function initializeUserProfiles() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const stored = await listRecords(NAMESPACE);
    for (const [userId, value] of Object.entries(stored).slice(-MAX_PROFILES)) profiles.set(userId, normalize(value, userId));
    return { profiles: profiles.size };
  })().catch(error => { initPromise = undefined; throw error; });
  return initPromise;
}
async function ensureReady() { if (!initPromise) await initializeUserProfiles(); else await initPromise; }

export async function getUserProfile(userId, { displayName, isOwner = false } = {}) {
  if (!userId) throw new TypeError('userId wajib diisi');
  await ensureReady();
  const profile = normalize(profiles.get(userId) || makeDefault(userId, displayName), userId);
  const resolvedName = isOwner ? String(getConfig().bot.ownerName || getConfig().bot.creatorName || 'Arifi Razzaq') : cleanName(displayName || profile.displayName);
  if (resolvedName && resolvedName !== profile.displayName) profile.displayName = resolvedName;
  profile.role = relationshipFor(profile, isOwner);
  profiles.set(userId, profile);
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
  return achievements.slice(-6);
}

function profileView(profile, isOwner = false, referenceNow = new Date()) {
  const level = levelFromXp(profile.xp);
  const currentFloor = xpRequiredForLevel(level);
  const nextFloor = xpRequiredForLevel(level + 1);
  const today = todayKey(referenceNow);
  const todayOrdinal = dayOrdinal(today);
  const lastActiveOrdinal = dayOrdinal(profile.lastActiveDate);
  const daysSinceActive = lastActiveOrdinal === null ? Infinity : todayOrdinal - lastActiveOrdinal;
  const currentStreak = daysSinceActive <= 1 ? profile.currentStreak : 0;
  const view = {
    ...profile,
    level,
    rank: rankForLevel(level),
    role: relationshipFor(profile, isOwner),
    interactionStyle: dominantStyle(profile.styleCounts),
    currentStreak,
    xpIntoLevel: Math.max(0, profile.xp - currentFloor),
    xpForNextLevel: Math.max(1, nextFloor - currentFloor),
    xpRemaining: Math.max(0, nextFloor - profile.xp),
    progressPercent: Math.min(100, Math.floor(((profile.xp - currentFloor) / Math.max(1, nextFloor - currentFloor)) * 100)),
    dailyXpCap: DAILY_XP_CAP,
    dailyXpRemaining: profile.dailyXpDate === today
      ? Math.max(0, DAILY_XP_CAP - (Number(profile.dailyXpEarned) || 0))
      : DAILY_XP_CAP
  };
  view.achievements = profileAchievements(view);
  return view;
}

function dayOrdinal(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export async function recordUserInteraction({ userId, displayName, messageId, text = '', isOwner = false, now = new Date() }) {
  if (!userId) return null;
  await ensureReady();
  const profile = normalize(profiles.get(userId) || makeDefault(userId, displayName), userId);
  if (messageId && profile.recentMessageIds.includes(messageId)) return profileView(profile, isOwner, now);
  profile.displayName = isOwner
    ? String(getConfig().bot.ownerName || getConfig().bot.creatorName || 'Arifi Razzaq')
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
  const greeting = /^(hai|haii+|halo+|hello+|hi|hey|assalamualaikum|assalamu'alaikum|pagi|siang|sore|malam)[!.\s]*$/i.test(String(text).trim());
  if (greeting) profile.greetingCount++;
  if (profile.dailyXpDate !== date) { profile.dailyXpDate = date; profile.dailyXpEarned = 0; }
  const wanted = BASE_XP + (newDay ? FIRST_DAILY_BONUS : 0);
  const earned = Math.min(wanted, Math.max(0, DAILY_XP_CAP - profile.dailyXpEarned));
  profile.xp += earned;
  profile.dailyXpEarned += earned;
  if (messageId) profile.recentMessageIds = [...profile.recentMessageIds, messageId].slice(-MAX_RECENT_IDS);
  profile.level = levelFromXp(profile.xp);
  profile.rank = rankForLevel(profile.level);
  profile.role = relationshipFor(profile, isOwner);
  profile.updatedAt = now.toISOString();
  profiles.set(userId, profile);
  while (profiles.size > MAX_PROFILES) profiles.delete(profiles.keys().next().value);
  await putRecord(NAMESPACE, userId, profile, { source: 'relationship-engine' });
  return profileView(profile, isOwner, now);
}

export function getRelationshipPrompt(profile, isOwner = false) {
  if (!profile) return 'Gunakan gaya percakapan yang natural dan sopan.';
  const style = profile.interactionStyle || 'natural';
  const styleInstruction = ({ ringkas: 'Pengguna cenderung menyukai jawaban ringkas dan langsung.', detail: 'Pengguna cenderung menyukai penjelasan terperinci jika topiknya kompleks.', teknis: 'Pengguna sering membahas topik teknis; gunakan istilah teknis secara tepat.', santai: 'Pengguna nyaman dengan gaya santai namun tetap jelas.', natural: 'Gunakan gaya natural dan sesuaikan panjang jawaban dengan konteks.' })[style];
  return `Konteks hubungan aplikasi (bukan klaim perasaan manusia): peran ${isOwner ? 'Owner & Creator' : profile.role}; level ${profile.level}; rank ${profile.rank}; interaksi tercatat ${profile.totalInteractions}; ${styleInstruction} Bangun kesinambungan dengan mengingat preferensi komunikasi agregat, jangan berpura-pura memiliki emosi manusia, jangan mengarang pengalaman pribadi, dan jangan menyebut angka XP kecuali ditanya.`;
}

export function getRelationshipEngineStatus() {
  return { profiles: profiles.size, maxProfiles: MAX_PROFILES, dailyXpCap: DAILY_XP_CAP, xpPerInteraction: BASE_XP, firstDailyBonus: FIRST_DAILY_BONUS };
}
