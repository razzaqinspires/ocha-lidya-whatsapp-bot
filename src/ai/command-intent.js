const PREFIX = /^[.!/#]+/;
const SAFE_INTENT = /^(?:tolong\s+)?(?:jalankan|jalankanlah|eksekusi|execute|run|gunakan|panggil|aktifkan)\s+(?:(?:perintah|command|fitur|plugin)\s+)?([.!/#]?[a-z][a-z0-9_-]{0,39})(?:\s+([\s\S]{1,500}))?$/i;

export function parseExplicitCommandIntent(input) {
  const text = String(input || '').trim();
  if (!text || text.length > 650) return null;
  const match = text.match(SAFE_INTENT);
  if (!match) return null;
  const requested = match[1].replace(PREFIX, '').toLowerCase();
  if (!requested || ['perintah', 'command', 'fitur', 'plugin'].includes(requested)) return null;
  const argsText = String(match[2] || '').trim();
  return {
    requested,
    argsText,
    args: argsText.split(/\s+/).filter(Boolean).slice(0, 30),
    sourceText: text
  };
}

/** Detect only a short, direct request to start a game that must have a real game engine. */
export function isUnsupportedGameIntent(input) {
  const text = String(input || '').trim();
  if (!text || text.length > 120) return false;
  return /^(?:(?:ayo|yuk|tolong|mari)\s+)?(?:main|bermain|play|mulai)\s+(?:(?:game|permainan)\s+)?(?:tic[ -]?tac[ -]?toe|tictactoe|sudoku|catur|chess|uno)(?:\b|$)/i.test(text)
    || /^(?:ayo|yuk|tolong)?\s*(?:main|bermain|play)\s+game\b/i.test(text);
}

export function isUntrackedGameContinuation(input, turns = []) {
  const text = String(input || '').trim();
  if (!text || text.length > 80) return false;
  const asksForMoveOrRepair = /^(?:[1-9]|x|o|rusak(?:\s+ini)?|perbaiki(?:\s+ini)?|lanjut|lanjutkan|terus|ulang|reset)[.!?\s]*$/i.test(text);
  if (!asksForMoveOrRepair) return false;
  const recent = [...(turns || [])].slice(-8);
  const started = recent.some(turn => turn.role === 'user' && isUnsupportedGameIntent(turn.content));
  const fabricatedBoard = recent.some(turn => turn.role === 'assistant'
    && /(?:tic[ -]?tac[ -]?toe|tictactoe|pilih posisi|giliranmu|posisi kosong)/i.test(turn.content || '')
    && /(?:\b[1-9]\s*\|)|(?:-{3,}\s*\n)/.test(turn.content || ''));
  return started && fabricatedBoard;
}
