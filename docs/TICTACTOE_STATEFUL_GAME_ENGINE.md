# Tic-Tac-Toe Stateful Game Engine — v1.10.28

## Scope

Part 3 adds a real private Tic-Tac-Toe game. It does not add Sudoku, chess, or UNO engines; those remain feature proposals only.

## Commands

- `.ttt mulai [x|o]` starts a game.
- `.ttt 1` through `.ttt 9` places the player's symbol.
- `.ttt status` displays the persisted board.
- `.ttt menyerah` ends the current game.
- `.ttt ulang [x|o]` abandons the previous active game and starts a new one.
- Alias commands: `.tictactoe`, `.xo`.

Natural-language private-chat support recognizes invitations such as `main tictactoe yuk` and routes a numeric reply to the current user's active game before the LLM lane. Groups are deliberately excluded to prevent ambiguous shared-session ownership.

## Architecture

- `src/games/tictactoe.js` contains game rules, Minimax, state transitions, and formatting.
- `src/plugins/tictactoe.js` exposes the command through the normal plugin registry and permission gate.
- `src/core/dispatcher.js` recognizes only narrow private-chat game intents and invokes the registered plugin.
- State is appended to the caller's encrypted User Vault journal as `game.tictactoe.state` events. The latest authenticated event is authoritative.

## Invariants

- Board has exactly nine cells; each cell is `null`, `X`, or `O`.
- A move must be an integer from 1 through 9, target an empty cell, and be made on the human turn.
- Win/draw status is computed by backend rules, never by the language model.
- Minimax selects only legal moves and cannot be forced to lose under standard 3×3 rules.
- User identity is the vault key; different users cannot read each other's game state.
- Game command is private-chat only. No game action is exposed through `aiCallable`.
- If vault authentication or hash-chain verification fails, game routing fails closed and does not fall back to LLM simulation.

## Recovery

Every accepted transition is appended to the encrypted, hash-chained User Vault journal before a success response is sent. After process restart, the latest authenticated event restores the board and turn. A corrupt/unreadable vault is not reconstructed from chat text.

## Verification

`test/tictactoe-engine.test.js` covers legal move selection, win/draw evaluation, private isolation, duplicate active-session prevention, occupied/invalid positions, persistence, surrender/restart, and exhaustive human move sequences against Minimax.
