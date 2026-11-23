import crypto from 'node:crypto';
import { appendUserVaultEvent, readUserVaultEvents } from './user-vault.js';

const GAME_FEATURES = Object.freeze({
  'tic-tac-toe': Object.freeze({
    key: 'tic-tac-toe',
    title: 'Game Tic-Tac-Toe',
    summary: 'Permainan 3×3 melawan Ocha dengan sesi server-side yang persisten.',
    requirements: [
      'Sesi permainan dibuat dan disimpan per akun; tidak boleh mengarang state dari riwayat teks.',
      'Validasi simbol X/O, posisi 1–9, posisi kosong, giliran, kemenangan, dan hasil seri di backend.',
      'Ocha menggunakan strategi minimax atau strategi setara yang deterministik dan legal.',
      'Permainan pulih setelah restart dari state tersimpan atau ditandai kedaluwarsa secara eksplisit.',
      'Perintah berhenti, menyerah, mulai ulang, dan status sesi tersedia.',
      'Akun berbeda tidak dapat membaca atau mengubah sesi permainan milik akun lain.'
    ]
  }),
  sudoku: Object.freeze({
    key: 'sudoku', title: 'Game Sudoku',
    summary: 'Puzzle Sudoku dengan generator, validasi solusi, dan state per pengguna.',
    requirements: ['Puzzle memiliki solusi valid yang diverifikasi backend.', 'Setiap langkah divalidasi terhadap aturan Sudoku.', 'State tersimpan per pengguna dan dapat dipulihkan setelah restart.', 'Hint tidak boleh mengubah state tanpa persetujuan pemain.']
  }),
  chess: Object.freeze({
    key: 'chess', title: 'Game Catur',
    summary: 'Permainan catur dengan validasi langkah legal dan state board persisten.',
    requirements: ['Aturan langkah legal divalidasi oleh chess engine.', 'Giliran, skak, skakmat, remis, dan promosi bidak harus dihitung engine.', 'State permainan terisolasi per sesi dan pengguna.', 'Tidak ada langkah yang dieksekusi hanya berdasarkan narasi model.']
  }),
  uno: Object.freeze({
    key: 'uno', title: 'Game UNO',
    summary: 'Permainan kartu UNO dengan deck, giliran, dan aturan tervalidasi.',
    requirements: ['Deck diacak menggunakan crypto-safe randomness.', 'Aturan warna, angka, kartu aksi, draw, dan giliran divalidasi server.', 'Tangan kartu setiap pemain bersifat privat.', 'State permainan pulih setelah restart tanpa membocorkan kartu pemain lain.']
  })
});

const GAME_PATTERNS = [
  ['tic-tac-toe', /tic[\s-]?tac[\s-]?toe|tictactoe|xo\b|silang\s+bulat/i],
  ['sudoku', /sudoku/i],
  ['chess', /\b(?:catur|chess)\b/i],
  ['uno', /\buno\b/i]
];
const AFFIRMATIVE_BUILD = /^(?:(?:iya|ya|oke|ok|baik|boleh|silakan|setuju|gas)[,!. ]*)?(?:buat(?:kan)?(?:\s+(?:saja|aja|game(?:\s+(?:itu|tersebut))?|fitur(?:\s+(?:itu|tersebut))?))?|bikin(?:kan)?(?:\s+(?:saja|aja|game(?:\s+(?:itu|tersebut))?|fitur(?:\s+(?:itu|tersebut))?))?|lanjut(?:kan)?(?:\s+(?:buat|pembuatan|fitur|game))?|implementasikan|pasang(?:kan)?|kembangkan|iya|ya|oke|ok|gas|silakan)(?:\s+(?:saja|aja|sekarang))?[.! ]*$/i;
const DIRECT_BUILD = /\b(?:buat(?:kan)?|bikin(?:kan)?|implementasikan|pasang(?:kan)?|kembangkan|tambahkan|rancang(?:kan)?)\b/i;

function clean(value, max = 700) {
  return String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

export function resolveGameFeature(text) {
  const value = String(text || '');
  for (const [key, pattern] of GAME_PATTERNS) if (pattern.test(value)) return GAME_FEATURES[key];
  return null;
}

function previousGameRequest(turns = []) {
  const recent = [...turns].slice(-12).reverse();
  for (let index = 0; index < recent.length; index += 1) {
    const turn = recent[index];
    if (turn.role !== 'user') continue;
    const feature = resolveGameFeature(turn.content);
    if (!feature) continue;
    const assistantOffer = recent.slice(0, index).some(item => item.role === 'assistant' && /(?:belum\s+(?:tersedia|terpasang|memiliki|ada)|belum\s+aktif|fitur(?:\s+game)?\s+baru|engine\s+permainan|siapkan\s+pengembangannya|bisa\s+(?:aku|saya)\s+(?:siapkan|buatkan)|plugin\s+game.{0,100}(?:dipasang|dibuat|ditambahkan|dibangun)|state\s+permainan.{0,70}(?:tidak\s+ada|belum\s+tersedia))|(?:tidak\s+akan\s+mengarang\s+state|tidak\s+akan\s+membuat\s+papan)/i.test(item.content || ''));
    if (assistantOffer) return feature;
  }
  return null;
}

/**
 * Resolve a confirmed feature-building request from the current turn and private
 * conversation context. This function never executes code or installs plugins.
 */
export function parseFeatureBuildIntent(input, turns = []) {
  const text = clean(input, 240).toLowerCase();
  if (!text || /^(?:jangan|tidak|gak|ga|nggak|enggak|batal|stop|jangan\s+dulu)\b/i.test(text) || /\b(?:tidak\s+usah|tidak\s+mau|jangan\s+buat|ga\s+usah|gak\s+usah)\b/i.test(text)) return null;
  const directFeature = resolveGameFeature(text);
  if (directFeature && DIRECT_BUILD.test(text)) {
    return { feature: directFeature, source: 'explicit-build', confidence: 1 };
  }
  if (!AFFIRMATIVE_BUILD.test(text)) return null;
  const prior = previousGameRequest(turns);
  return prior ? { feature: prior, source: 'confirmed-followup', confidence: 0.98 } : null;
}

export function buildFeatureProposal(feature) {
  const descriptor = typeof feature === 'string' ? GAME_FEATURES[feature] : feature;
  if (!descriptor || !GAME_FEATURES[descriptor.key]) throw new TypeError('Fitur belum didukung untuk proposal terstruktur.');
  return {
    featureKey: descriptor.key,
    title: descriptor.title,
    summary: descriptor.summary,
    requirements: [...descriptor.requirements],
    status: 'requested',
    scope: 'owner-development-backlog',
    executionPolicy: 'human-reviewed-source-change-required'
  };
}

function applyStatuses(events) {
  const requests = new Map();
  for (const event of [...events].reverse()) {
    const payload = event.payload || {};
    if (event.type === 'feature.requested' && payload.id) {
      requests.set(payload.id, { ...payload, createdAt: event.createdAt, seq: event.seq });
    } else if (event.type === 'feature.status' && payload.id && requests.has(payload.id)) {
      const current = requests.get(payload.id);
      requests.set(payload.id, { ...current, status: payload.status, updatedAt: event.createdAt, statusNote: payload.note || '' });
    }
  }
  return [...requests.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function createFeatureRequest(userId, feature, { sourceText = '', conversationContext = [] } = {}) {
  const proposal = buildFeatureProposal(feature);
  const events = await readUserVaultEvents(userId, { types: ['feature.requested', 'feature.status'], reverse: true });
  const existing = applyStatuses(events).find(item => item.featureKey === proposal.featureKey && ['requested', 'in-progress'].includes(item.status));
  if (existing) return { created: false, duplicate: true, request: existing };
  const id = `FR-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const payload = {
    id,
    ...proposal,
    source: 'natural-language-owner-confirmation',
    sourceText: clean(sourceText, 500),
    conversationContext: (Array.isArray(conversationContext) ? conversationContext : []).slice(-4).map(turn => ({
      role: turn?.role === 'assistant' ? 'assistant' : 'user',
      content: clean(turn?.content, 500)
    })).filter(turn => turn.content)
  };
  const event = await appendUserVaultEvent(userId, 'feature.requested', payload);
  return { created: true, duplicate: false, request: { ...payload, createdAt: event.createdAt, seq: event.seq } };
}

async function loadFeatureRequests(userId) {
  const events = await readUserVaultEvents(userId, { types: ['feature.requested', 'feature.status'], reverse: true });
  return applyStatuses(events);
}

export async function listFeatureRequests(userId, { includeClosed = false, limit = 30 } = {}) {
  const requests = await loadFeatureRequests(userId);
  const filtered = includeClosed ? requests : requests.filter(item => ['requested', 'in-progress'].includes(item.status));
  return filtered.slice(0, Math.max(1, Math.min(100, Number(limit) || 30)));
}

export async function updateFeatureRequest(userId, id, status, note = '') {
  const normalizedId = clean(id, 48).toUpperCase();
  if (!/^FR-\d{8}-[A-F0-9]{6}$/.test(normalizedId)) return { updated: false, reason: 'invalid-id' };
  if (!['requested', 'in-progress', 'completed', 'cancelled'].includes(status)) return { updated: false, reason: 'invalid-status' };
  const existing = (await loadFeatureRequests(userId)).find(item => item.id === normalizedId);
  if (!existing) return { updated: false, reason: 'not-found' };
  const event = await appendUserVaultEvent(userId, 'feature.status', {
    id: normalizedId,
    status,
    note: clean(note, 500),
    actor: 'verified-owner'
  });
  return { updated: true, id: normalizedId, status, updatedAt: event.createdAt };
}

export function formatFeatureRequest(request) {
  return [
    `${request.title} · ${request.id}`,
    `Status: ${request.status}`,
    `Ringkasan: ${request.summary}`,
    'Kriteria penerimaan:',
    ...request.requirements.map((item, index) => `${index + 1}. ${item}`)
  ].join('\n');
}
