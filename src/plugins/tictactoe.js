import { startTicTacToe, moveTicTacToe, endTicTacToe, statusTicTacToe, getTicTacToeSession } from '../games/tictactoe.js';

function playerId(message) {
  return String(message?.sender || message?.key?.participant || message?.key?.remoteJid || '').replace(/:\d+(?=@)/, '');
}

export default {
  name: 'tictactoe',
  aliases: ['ttt', 'xo'],
  category: 'games',
  description: 'Permainan Tic-Tac-Toe persisten melawan Ocha dengan strategi Minimax.',
  usage: '.ttt mulai [x|o] | .ttt <1-9> | .ttt status | .ttt menyerah | .ttt ulang',
  ownerOnly: false,
  groupOnly: false,
  privateOnly: true,
  aiCallable: false,
  async execute({ m, args = [] }) {
    const userId = playerId(m);
    if (!userId) return m.reply('Identitas pemain tidak dapat diverifikasi.');
    const action = String(args[0] || 'mulai').toLowerCase();
    if (/^[1-9]$/.test(action)) {
      const result = await moveTicTacToe(userId, action);
      return m.reply(result.text);
    }
    if (['mulai', 'start', 'main', 'play'].includes(action)) {
      const symbol = String(args[1] || 'X').toUpperCase();
      const result = await startTicTacToe(userId, symbol);
      return m.reply(result.text);
    }
    if (['status', 'papan', 'board'].includes(action)) return m.reply(await statusTicTacToe(userId));
    if (['menyerah', 'stop', 'berhenti', 'selesai'].includes(action)) {
      const result = await endTicTacToe(userId);
      return m.reply(result.text);
    }
    if (['ulang', 'reset', 'restart'].includes(action)) {
      const active = await getTicTacToeSession(userId);
      if (active?.status === 'playing') await endTicTacToe(userId, 'abandoned');
      const result = await startTicTacToe(userId, String(args[1] || 'X').toUpperCase());
      return m.reply(result.text);
    }
    return m.reply('Perintah Tic-Tac-Toe:\n.ttt mulai [x|o]\n.ttt 1-9\n.ttt status\n.ttt menyerah\n.ttt ulang');
  }
};
