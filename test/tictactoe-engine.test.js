import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { evaluateBoard, chooseMinimaxMove, startTicTacToe, moveTicTacToe, endTicTacToe, statusTicTacToe, getTicTacToeSession } from '../src/games/tictactoe.js';

let root;
test.before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-ttt-'));
  process.env.OCHA_ROO_ROOT = root;
});
test.after(async () => {
  await fs.rm(root, { recursive: true, force: true });
  delete process.env.OCHA_ROO_ROOT;
});

const userA = '6281111111111@s.whatsapp.net';
const userB = '6282222222222@s.whatsapp.net';

test('Minimax always chooses a legal empty cell', () => {
  const board = ['X', null, null, null, 'O', null, null, null, 'X'];
  const move = chooseMinimaxMove(board, 'O', 'X');
  assert.ok(move >= 0 && move < 9);
  assert.equal(board[move], null);
});

test('board validator detects wins and draws', () => {
  assert.equal(evaluateBoard(['X','X','X','O','O',null,null,null,null]).winner, 'X');
  assert.equal(evaluateBoard(['X','O','X','X','O','O','O','X','X']).status, 'draw');
  assert.equal(evaluateBoard(Array(9).fill(null)).status, 'playing');
});

test('start persists isolated private game and refuses duplicate active session', async () => {
  const started = await startTicTacToe(userA, 'X');
  assert.equal(started.created, true);
  assert.equal(started.game.human, 'X');
  const duplicate = await startTicTacToe(userA, 'O');
  assert.equal(duplicate.created, false);
  assert.equal((await getTicTacToeSession(userB)), null);
  assert.match(await statusTicTacToe(userA), /Status|Giliran/);
});

test('moves reject invalid and occupied positions without mutating board', async () => {
  const before = await getTicTacToeSession(userA);
  assert.equal((await moveTicTacToe(userA, 0)).reason, 'invalid-position');
  const first = await moveTicTacToe(userA, 1);
  assert.equal(first.ok, true);
  const after = await getTicTacToeSession(userA);
  const occupied = after.board.findIndex((cell, index) => cell && before.board[index] === null) + 1;
  assert.equal((await moveTicTacToe(userA, occupied)).reason, 'occupied');
});

test('game state survives service reload and can be ended', async () => {
  const state = await getTicTacToeSession(userA);
  assert.ok(state);
  const ended = await endTicTacToe(userA);
  assert.equal(ended.ok, true);
  assert.equal((await getTicTacToeSession(userA)).status, 'resigned');
  const fresh = await startTicTacToe(userA, 'O');
  assert.equal(fresh.created, true);
  assert.equal(fresh.game.human, 'O');
});

test('different users cannot access each other game state', async () => {
  const a = await getTicTacToeSession(userA);
  const b = await getTicTacToeSession(userB);
  assert.ok(a);
  assert.equal(b, null);
});

test('Minimax opponent cannot be forced into a loss by any legal human sequence', () => {
  function explore(board, turn, human = 'X', ai = 'O') {
    const result = evaluateBoard(board);
    if (result.status === 'won') return result.winner !== human;
    if (result.status === 'draw') return true;
    if (turn === ai) {
      const move = chooseMinimaxMove(board, ai, human);
      if (move < 0) return false;
      board[move] = ai;
      const safe = explore(board, human, human, ai);
      board[move] = null;
      return safe;
    }
    for (let i = 0; i < 9; i++) {
      if (board[i]) continue;
      board[i] = human;
      const safe = explore(board, ai, human, ai);
      board[i] = null;
      if (!safe) return false;
    }
    return true;
  }
  assert.equal(explore(Array(9).fill(null), 'X'), true);
});
