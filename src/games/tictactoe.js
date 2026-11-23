import crypto from 'node:crypto';
import { appendUserVaultEvent, readUserVaultEvents } from '../ai/user-vault.js';

const locks = new Map();
const emptyBoard = () => Array(9).fill(null);
const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const cleanUser = value => String(value || '').trim();

function withLock(userId, fn) {
  const prior = locks.get(userId) || Promise.resolve();
  const current = prior.catch(() => {}).then(fn);
  const marker = current.catch(() => {});
  locks.set(userId, marker);
  return current.finally(() => { if (locks.get(userId) === marker) locks.delete(userId); });
}

export function evaluateBoard(board) {
  if (!Array.isArray(board) || board.length !== 9 || board.some(cell => ![null, 'X', 'O'].includes(cell))) throw new TypeError('Papan permainan tidak valid.');
  for (const line of WIN_LINES) {
    const [a,b,c] = line;
    if (board[a] && board[a] === board[b] && board[b] === board[c]) return { status: 'won', winner: board[a], line };
  }
  return board.every(Boolean) ? { status: 'draw', winner: null, line: null } : { status: 'playing', winner: null, line: null };
}

function minimax(board, player, ai, human, depth = 0) {
  const result = evaluateBoard(board);
  if (result.status === 'won') return result.winner === ai ? 10 - depth : depth - 10;
  if (result.status === 'draw') return 0;
  const moves = [];
  for (let i = 0; i < 9; i++) {
    if (board[i]) continue;
    board[i] = player;
    const score = minimax(board, player === ai ? human : ai, ai, human, depth + 1);
    board[i] = null;
    moves.push({ position: i, score });
  }
  if (player === ai) return Math.max(...moves.map(move => move.score));
  return Math.min(...moves.map(move => move.score));
}

export function chooseMinimaxMove(board, ai, human) {
  const moves = [];
  for (let i = 0; i < 9; i++) {
    if (board[i]) continue;
    board[i] = ai;
    const score = minimax(board, human, ai, human, 1);
    board[i] = null;
    moves.push({ position: i, score });
  }
  moves.sort((a,b) => b.score - a.score || a.position - b.position);
  return moves[0]?.position ?? -1;
}

function renderBoard(board) {
  const cell = i => board[i] || String(i + 1);
  return `${cell(0)} | ${cell(1)} | ${cell(2)}\n---------\n${cell(3)} | ${cell(4)} | ${cell(5)}\n---------\n${cell(6)} | ${cell(7)} | ${cell(8)}`;
}

function formatGame(game, message = '') {
  const boardResult = evaluateBoard(game.board);
  const result = ['resigned', 'abandoned'].includes(game.status) ? { status: game.status, winner: null, line: null } : boardResult;
  const open = game.board.map((value, index) => value ? null : index + 1).filter(Boolean);
  let ending = '';
  if (result.status === 'won') ending = result.winner === game.human ? '\nKamu menang.' : '\nOcha menang.';
  else if (result.status === 'draw') ending = '\nPermainan seri.';
  else if (result.status === 'resigned') ending = '\nPermainan telah kamu akhiri.';
  else if (result.status === 'abandoned') ending = '\nSesi sebelumnya ditinggalkan.';
  else ending = `\nGiliran: ${game.turn === game.human ? 'kamu' : 'Ocha'}${game.turn === game.human ? ` · posisi kosong: ${open.join(', ')}` : ''}`;
  return `${message ? `${message}\n\n` : ''}\`\`\`\n${renderBoard(game.board)}\n\`\`\`${ending}\nID sesi: ${game.id}`;
}

async function latestGame(userId) {
  const [event] = await readUserVaultEvents(userId, { types: ['game.tictactoe.state'], reverse: true, limit: 1 });
  return event?.payload?.game || null;
}
async function persist(userId, game) {
  await appendUserVaultEvent(userId, 'game.tictactoe.state', { game });
}

export async function getTicTacToeSession(userId) {
  const id = cleanUser(userId);
  if (!id) return null;
  return latestGame(id);
}

export async function startTicTacToe(userId, symbol = 'X') {
  const id = cleanUser(userId);
  if (!id) throw new TypeError('Identitas pemain tidak valid.');
  const human = String(symbol || 'X').toUpperCase();
  if (!['X','O'].includes(human)) throw new TypeError('Pilih X atau O.');
  return withLock(id, async () => {
    const previous = await latestGame(id);
    if (previous?.status === 'playing' && evaluateBoard(previous.board).status === 'playing') return { created: false, game: previous, text: formatGame(previous, 'Kamu masih memiliki permainan aktif. Lanjutkan atau ketik .ttt menyerah untuk mengakhiri.') };
    const game = { version: 1, id: `TTT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, human, ai: human === 'X' ? 'O' : 'X', board: emptyBoard(), turn: 'X', status: 'playing', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), moves: [] };
    if (game.turn === game.ai) {
      const move = chooseMinimaxMove(game.board, game.ai, game.human);
      game.board[move] = game.ai;
      game.turn = game.human;
      game.moves.push({ by: 'ai', symbol: game.ai, position: move + 1 });
    }
    await persist(id, game);
    return { created: true, game, text: formatGame(game, `Permainan dimulai. Kamu memakai ${human}, Ocha memakai ${game.ai}.`) };
  });
}

export async function moveTicTacToe(userId, position) {
  const id = cleanUser(userId);
  const number = Number(position);
  if (!Number.isInteger(number) || number < 1 || number > 9) return { ok: false, reason: 'invalid-position', text: 'Pilih posisi angka 1 sampai 9.' };
  return withLock(id, async () => {
    const game = await latestGame(id);
    if (!game || game.status !== 'playing') return { ok: false, reason: 'no-active-game', text: 'Belum ada permainan aktif. Ketik .ttt mulai untuk bermain.' };
    if (evaluateBoard(game.board).status !== 'playing') return { ok: false, reason: 'finished', text: 'Permainan ini sudah selesai. Ketik .ttt mulai untuk sesi baru.' };
    const index = number - 1;
    if (game.board[index]) return { ok: false, reason: 'occupied', text: 'Posisi itu sudah terisi. Pilih posisi kosong.' };
    if (game.turn !== game.human) return { ok: false, reason: 'not-your-turn', text: 'Tunggu giliran Ocha.' };
    game.board[index] = game.human;
    game.moves.push({ by: 'human', symbol: game.human, position: number });
    let outcome = evaluateBoard(game.board);
    if (outcome.status === 'playing') {
      const aiMove = chooseMinimaxMove(game.board, game.ai, game.human);
      if (aiMove >= 0) {
        game.board[aiMove] = game.ai;
        game.moves.push({ by: 'ai', symbol: game.ai, position: aiMove + 1 });
      }
      outcome = evaluateBoard(game.board);
    }
    game.status = outcome.status;
    game.turn = outcome.status === 'playing' ? game.human : null;
    game.updatedAt = new Date().toISOString();
    await persist(id, game);
    const aiMove = game.moves.at(-1)?.by === 'ai' ? game.moves.at(-1).position : null;
    const message = outcome.status === 'playing' ? `Ocha memilih posisi ${aiMove}.` : outcome.status === 'won' ? (outcome.winner === game.human ? 'Ocha tidak menemukan cara untuk membalikkan hasil.' : 'Ocha menyelesaikan permainan.') : 'Tidak ada posisi tersisa.';
    return { ok: true, game, text: formatGame(game, message) };
  });
}

export async function endTicTacToe(userId, reason = 'resigned') {
  const id = cleanUser(userId);
  return withLock(id, async () => {
    const game = await latestGame(id);
    if (!game || game.status !== 'playing') return { ok: false, text: 'Tidak ada permainan aktif.' };
    game.status = reason === 'abandoned' ? 'abandoned' : 'resigned';
    game.turn = null;
    game.updatedAt = new Date().toISOString();
    await persist(id, game);
    return { ok: true, game, text: `Permainan ${game.id} telah diakhiri.\n\`\`\`\n${renderBoard(game.board)}\n\`\`\`` };
  });
}

export async function statusTicTacToe(userId) {
  const game = await latestGame(cleanUser(userId));
  if (!game) return 'Belum ada sesi Tic-Tac-Toe. Ketik .ttt mulai.';
  return formatGame(game, `Status sesi: ${game.status}`);
}
