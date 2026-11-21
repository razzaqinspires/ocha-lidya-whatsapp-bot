import { listRecords, putRecord } from './repository.js';
import { logger } from './logger.js';
import { inspectWorkload } from '../master/workload-tracker.js';

const cooldowns = new Map();
const spamWindows = new Map();
const notices = new Map();
const cooldownNotices = new Map();
const sanctionCache = new Map();
let sanctionLoadPromise;
const MAX_TRACKED = 20_000;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function jakartaDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function trimMap(map, max = MAX_TRACKED) {
  while (map.size > max) map.delete(map.keys().next().value);
}
function costProfile(plugin = {}, command = '') {
  const text = `${command} ${plugin.name || ''} ${plugin.description || ''} ${plugin.usage || ''}`.toLowerCase();
  let score = 0.5;
  const signals = [
    [/https?|fetch|website|search|berita|news|scrape|browser|url|preview/, 2.1],
    [/download|media|video|audio|image|sticker|carousel|document/, 1.8],
    [/database|dbsearch|archive|project|repository|zip|export/, 1.5],
    [/run|execute|eval|master|python|golang|node|code|build|deploy/, 2.7],
    [/ai|model|apikey|catalog|profile|groupinfo/, 0.8]
  ];
  const matched = [];
  for (const [pattern, weight] of signals) if (pattern.test(text)) { score += weight; matched.push(pattern.source); }
  const workload = inspectWorkload('command', text);
  if (workload.level === 'medium') { score += 0.8; matched.push('workload:medium'); }
  if (workload.level === 'high') { score += 1.8; matched.push('workload:high'); }
  if (plugin.cooldownWeight && Number.isFinite(Number(plugin.cooldownWeight))) score += clamp(Number(plugin.cooldownWeight), 0, 5);
  return { score: clamp(score, 0.5, 12), matched, workloadLevel: workload.level };
}
export function estimateCommandCooldown(plugin = {}, command = '') {
  const { score, matched } = costProfile(plugin, command);
  // Smooth, bounded curve: expensive/network workloads receive more spacing;
  // no command needs a hand-maintained per-plugin duration.
  const milliseconds = Math.round(clamp(900 + Math.pow(score, 1.35) * 1150, 1_200, 45_000) / 250) * 250;
  return { milliseconds, score: Number(score.toFixed(2)), signals: matched };
}
export function evaluateCooldown({ sender, chat, command, plugin, now = Date.now() }) {
  const key = `${sender}::${chat}::${command}`;
  const policy = estimateCommandCooldown(plugin, command);
  const previous = cooldowns.get(key) || 0;
  if (previous > now) return { allowed: false, remainingMs: previous - now, ...policy };
  cooldowns.set(key, now + policy.milliseconds);
  trimMap(cooldowns);
  return { allowed: true, remainingMs: 0, ...policy };
}

const BAN_STEPS = [5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];
const SPAM_WINDOW_MS = 6_000;
const REPEAT_WINDOW_MS = 3_000;
const FIRST_NOTICE_WINDOW_MS = 30_000;

export async function initializeCommandGovernor() {
  if (!sanctionLoadPromise) sanctionLoadPromise = listRecords('command.guard.user').then(records => {
    for (const [sender, value] of Object.entries(records).slice(-MAX_TRACKED)) sanctionCache.set(sender, value);
    return { ready: true, users: sanctionCache.size };
  }).catch(error => { sanctionLoadPromise = undefined; throw error; });
  return sanctionLoadPromise;
}
async function loadSanction(sender) {
  await initializeCommandGovernor();
  if (sanctionCache.has(sender)) return structuredClone(sanctionCache.get(sender));
  const value = { day: jakartaDay(), warnings: 0, banLevel: 0, bannedUntil: 0, lastViolationAt: 0 };
  sanctionCache.set(sender, value);
  trimMap(sanctionCache);
  return structuredClone(value);
}
async function saveSanction(sender, sanction, reason) {
  sanctionCache.set(sender, structuredClone(sanction));
  trimMap(sanctionCache);
  await putRecord('command.guard.user', sender, sanction, { source: 'command-governor', reason });
}
function isRapid(history, command, now) {
  const recent = history.filter(item => now - item.at <= SPAM_WINDOW_MS);
  const same = recent.filter(item => item.command === command);
  const repeatedTooFast = same.some(item => now - item.at <= REPEAT_WINDOW_MS);
  const burst = recent.length >= 4;
  return { violated: repeatedTooFast || burst, reason: repeatedTooFast ? 'repeated-command' : burst ? 'command-burst' : null };
}
export function shouldNotifyCooldown({ sender, chat, command, cooldownMs = 60_000, now = Date.now() }) {
  const key = `${sender}::${chat}::${command}`;
  const until = cooldownNotices.get(key) || 0;
  if (until > now) return false;
  cooldownNotices.set(key, now + Math.max(1000, Number(cooldownMs) || 60_000));
  trimMap(cooldownNotices);
  return true;
}
export async function inspectAntiSpam({ sender, command, now = Date.now() }) {
  const sanction = await loadSanction(sender);
  const day = jakartaDay(new Date(now));
  if (sanction.day !== day) {
    sanction.day = day;
    sanction.warnings = 0;
    sanction.firstWarningIssued = false;
    sanction.lastViolationAt = 0;
    await saveSanction(sender, sanction, 'daily anti-spam counter reset');
  }
  if (Number(sanction.bannedUntil) > now) return { allowed: false, banned: true, remainingMs: sanction.bannedUntil - now, warnings: sanction.warnings, banLevel: sanction.banLevel };

  const history = spamWindows.get(sender) || [];
  const verdict = isRapid(history, command, now);
  history.push({ command, at: now });
  const kept = history.filter(item => now - item.at <= SPAM_WINDOW_MS);
  spamWindows.set(sender, kept);
  trimMap(spamWindows);
  if (!verdict.violated) return { allowed: true, violation: false };

  const lastNotice = notices.get(sender) || 0;
  if (!sanction.firstWarningIssued) {
    sanction.firstWarningIssued = true;
    sanction.lastViolationAt = now;
    await saveSanction(sender, sanction, 'initial anti-spam notice');
    notices.set(sender, now);
    return { allowed: false, violation: true, initialWarning: true, reason: verdict.reason, warnings: sanction.warnings };
  }

  // Repeated violations count at most once per notice window to prevent a burst
  // of duplicate events from consuming all warnings in milliseconds.
  if (now - Math.max(Number(sanction.lastViolationAt) || 0, lastNotice) < FIRST_NOTICE_WINDOW_MS) {
    return { allowed: false, violation: true, suppressed: true, reason: verdict.reason, warnings: sanction.warnings };
  }

  sanction.warnings = Math.min(5, (Number(sanction.warnings) || 0) + 1);
  sanction.lastViolationAt = now;
  notices.set(sender, now);
  if (sanction.warnings >= 5) {
    sanction.banLevel = Math.min(BAN_STEPS.length, (Number(sanction.banLevel) || 0) + 1);
    const duration = BAN_STEPS[sanction.banLevel - 1];
    sanction.bannedUntil = now + duration;
    sanction.warnings = 0;
    sanction.firstWarningIssued = false;
    await saveSanction(sender, sanction, 'temporary anti-spam suspension');
    logger.warn({ sender, banLevel: sanction.banLevel, durationMs: duration }, 'User temporarily suspended by anti-spam governor');
    return { allowed: false, violation: true, banned: true, durationMs: duration, banLevel: sanction.banLevel, warnings: 5 };
  }
  await saveSanction(sender, sanction, 'anti-spam warning');
  return { allowed: false, violation: true, warnings: sanction.warnings, reason: verdict.reason };
}
export async function isUserTemporarilyBanned(sender, now = Date.now()) {
  if (!sender) return { banned: false };
  const sanction = await loadSanction(sender);
  return Number(sanction.bannedUntil) > now
    ? { banned: true, remainingMs: sanction.bannedUntil - now, banLevel: sanction.banLevel }
    : { banned: false };
}
export async function getCommandSanction(sender, now = Date.now()) {
  const sanction = await loadSanction(sender);
  const day = jakartaDay(new Date(now));
  if (sanction.day !== day) return { ...sanction, day, warnings: 0 };
  return sanction;
}
export function formatDuration(milliseconds) {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
  if (seconds < 60) return `${seconds} detik`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours} jam`;
  return `${Math.ceil(hours / 24)} hari`;
}
export function resetCommandGovernorMemory() { cooldowns.clear(); spamWindows.clear(); notices.clear(); cooldownNotices.clear(); sanctionCache.clear(); }
