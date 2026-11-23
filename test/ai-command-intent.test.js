import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExplicitCommandIntent, isUnsupportedGameIntent, isUntrackedGameContinuation } from '../src/ai/command-intent.js';

test('explicit command intent parses canonical command and bounded arguments', () => {
  const parsed = parseExplicitCommandIntent('Tolong jalankan perintah .ping cepat sekarang');
  assert.equal(parsed.requested, 'ping');
  assert.deepEqual(parsed.args, ['cepat', 'sekarang']);
});

test('command mentioned in ordinary prose is not treated as execution consent', () => {
  assert.equal(parseExplicitCommandIntent('Apa fungsi perintah ping?'), null);
  assert.equal(parseExplicitCommandIntent('Jangan jalankan command ping'), null);
  assert.equal(parseExplicitCommandIntent('Jalankan perintah'), null);
});

test('unsupported game guard only matches short direct game-start requests', () => {
  assert.equal(isUnsupportedGameIntent('main tictactoe yok'), true);
  assert.equal(isUnsupportedGameIntent('Ayo main sudoku'), true);
  assert.equal(isUnsupportedGameIntent('Tolong jelaskan strategi Tic-Tac-Toe'), false);
  assert.equal(isUnsupportedGameIntent('Contoh percakapan panjang: main tictactoe yok\n' + 'x'.repeat(500)), false);
});

test('game continuation requires a matching prior user request and fabricated assistant board', () => {
  const turns = [
    { role: 'user', content: 'main tictactoe yok' },
    { role: 'assistant', content: 'Pilih posisi kamu:\n1 | 2 | 3\n---------\n4 | 5 | 6' }
  ];
  assert.equal(isUntrackedGameContinuation('5', turns), true);
  assert.equal(isUntrackedGameContinuation('rusak ini', turns), true);
  assert.equal(isUntrackedGameContinuation('5', [{ role: 'assistant', content: 'Masukkan nomor pesanan.' }]), false);
  assert.equal(isUntrackedGameContinuation('5', [{ role: 'user', content: 'main tictactoe yok' }]), false);
});
