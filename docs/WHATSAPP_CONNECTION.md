# WhatsApp Connection and Recovery

## Login modes

The transport supports two login modes selected in persistent application configuration (`src/config.js` and the JSONL configuration database). Pairing code is the shipped default:

```js
// Persisted application settings (src/config.js / JSONL configuration)
whatsapp: {
  authMode: 'pairing', // default; or 'qr'
  pairingNumber: '6282177461231',
  browserName: 'Chrome', // identitas browser Baileys; jangan isi nama bot
  sessionDir: 'sessions/ocha-lidya',
  connectTimeoutMs: 60000,
  queryTimeoutMs: 60000,
  keepAliveIntervalMs: 25000,
  recoverInvalidSession: true
}
```

- `pairing` (default): waits for Baileys to emit its initial `qr` event. That event is used only as a readiness signal after the `pair-device` stanza; the QR itself is not printed. The bot then requests and prints one phone-number pairing code for that socket. `whatsapp.pairingNumber` must be the target phone number.
- `qr`: prints the current QR payload in the terminal. Set `whatsapp.authMode` to `qr` in `src/config.js` to use it. The number must be international digits only, including country code and without `+`.
- `whatsapp.pairingNumber` defaults to the configured `bot.expectedNumber` if omitted.
- `whatsapp.browserName` defaults to `Chrome`. It must be one of `Chrome`, `Firefox`, `IE`, `Opera`, `Safari`, or `Edge`. This is the browser identity sent to WhatsApp, not the bot name. On the Linux deployment profile, `Chrome` produces the canonical `Chrome (Ubuntu)` pairing platform; using a custom name such as `Ocha Lidya` here can make WhatsApp reject the code request. Baileys defines `Browsers.ubuntu(browser)` as `['Ubuntu', browser, '22.04.4']`, so the argument must be a browser identifier, not the bot's name.
- `whatsapp.sessionDir` defaults to `sessions/ocha-lidya`.

On the phone, open WhatsApp → Linked devices → Link a device → Link with phone number, then enter the code printed by the bot. Pairing code is not an SMS OTP. Do not share it with anyone.

## Session behavior

Baileys credentials are persisted in the session directory. A valid session is reused on the next start; the bot does not ask for a new QR or pairing code while `creds.registered` is true or `creds.me.id` is present. If WhatsApp then rejects that session with `401`, the v1.4.4 recovery policy may preserve it as a backup and start one new pairing flow. Switching `whatsapp.authMode` does not unlink the active WhatsApp device.

To pair a different account, stop the bot first and back up the session directory. Only remove or rename the configured session directory if you intentionally want to unlink the local credentials and start a fresh pairing. Never commit session files.

## Reconnection policy

- A successful connection resets the retry counter.
- Baileys `restartRequired` (515), which can occur after a successful pairing handshake, triggers a short-delay socket recreation.
- Other transient disconnects (`408`, `428`, `503`, and unknown transient errors) use exponential backoff with jitter, capped at 30 seconds.
- `515` (`restartRequired`) is an expected post-pairing restart signal and recreates the socket after a 500 ms delay, in the same Node.js process. The next socket waits for pending credential writes before loading the auth state.
- In pairing mode, a registered session rejected with `401` is preserved as a timestamped `.invalid-*` backup and one fresh pairing attempt is started when `whatsapp.recoverInvalidSession` is enabled. A second 401 in that process stops, preventing an infinite reset loop.
- `401` (logged out), `403` (forbidden), `411` (multi-device mismatch), `440` (connection replaced), and `500` (bad session) stop automatic reconnect. In particular, `440` is treated as a conflict: inspect and stop any other bot process using this WhatsApp account/session before starting this process again. This stricter local rule avoids two instances repeatedly replacing one another.
- A single reconnect timer, an active-socket check, a start-in-flight guard, and stale-socket callback checks prevent duplicate socket creation. A late pairing-code response/rejection from a retired socket is ignored.
- Credential writes are serialized, and reconnect waits for the queue to settle before reloading multi-file auth state.

## Troubleshooting

1. Confirm the phone has internet access and the number includes the country code (for Indonesia, `62`, not the leading `0`).
2. Make sure only one Ocha Lidya process is using the same session directory. Two processes sharing one Baileys session can corrupt or replace each other's connection.
3. If the code is rejected or expires, verify `whatsapp.browserName: 'Chrome'` in `src/config.js`, then stop the process and restart it to request a fresh code. Do not repeatedly request codes on the same socket.
4. Do not set `browserName` to the bot's name (for example `Ocha Lidya`). Baileys uses this value as a protocol browser identifier; use one of the supported canonical browser names.
5. If the terminal prints a code but WhatsApp rejects it, capture the Baileys error log immediately. The upstream rc14 API can return the locally generated code before a later server-side IQ error is surfaced; the code appearing in the terminal alone is not proof that WhatsApp accepted the request.
6. If logs report logged-out/bad-session, stop the process, back up the old session directory, rename it, then start again and pair a new session.
7. Keep `data/` and `sessions/` on persistent writable storage. Do not delete the session directory during routine restarts. After automatic invalid-session recovery, inspect the timestamped `.invalid-*` backup before deciding whether it can be removed.
8. Run `npm run check` and `npm test` after changing connection code.

## Stability boundary

Upstream Baileys `7.0.0-rc14` has a known pairing-code limitation: `requestPairingCode()` may return a locally generated code before the server's companion-registration IQ response is evaluated. Upstream PR [#2559](https://github.com/WhiskeySockets/Baileys/pull/2559) proposes waiting for that response and rejecting server-side errors; it is still open and not part of the pinned release as of 2026-11-19. v1.4.3 corrected this project's invalid browser identity and early request timing; v1.4.4 adds one-time quarantine recovery for an existing rejected session, but it does not vendor that unmerged Baileys patch. Therefore, a printed code is not proof of server acceptance; verify that the phone completes linking and the bot reaches `connection: open`.

The project pins the Baileys dependency version in `package.json` and no longer fetches a remote WhatsApp Web version during every startup. Update Baileys deliberately, then test QR login, pairing login with an accepted browser identity, rejection handling, reconnect after 515, message receive, and session reuse. The project currently uses the upstream rc14 release, so pairing behavior can still be affected by upstream protocol changes. Baileys is an unofficial client for WhatsApp Web; no client-side code can guarantee uninterrupted service or prevent account-side unlinking and protocol changes.


## The `401` shown before pairing code

A saved auth directory with `creds.me` is treated by Baileys as an existing login session, even when a partial/corrupt auth state has `registered: false`. In that case Baileys sends a login handshake (`logging in...`) rather than creating a new registration flow, so no pairing code is requested. If WhatsApp rejects that stored session with `401`, v1.4.4 can quarantine the old directory (preserving it) and make one clean pairing attempt. A transient WebSocket error such as `408` is handled separately with reconnect backoff and does not itself trigger session reset.

Pairing success still needs to be confirmed on the phone and by `connection: open`. Upstream Baileys `7.0.0-rc14` has the documented outstanding issue where the pairing-code method may return a generated code before a server-side error is fully surfaced. The main application therefore does not claim that printing the code proves the server accepted it.

## Socket reconnect versus operating-system process restart

A `connection.update` with `connection: 'close'` does **not** spawn another Node.js process. It detaches the closed socket and schedules `start()` in the existing process; the PID remains the same. The application logs the PID on the connected/closed events so this can be verified.

A second Ocha Lidya bot process (`node src/index.js`) is created only by the controlled source-restart path in `src/index.js`. `watchSourceFiles()` invokes it when a non-plugin JavaScript file under `src/` changes; plugin files are hot-reloaded in place. Auto Git Sync previously rebased `origin/main` automatically when the remote was ahead, which could replace a watched core JavaScript file and trigger that process restart without a manual edit. Auto Git Sync is now push-only: when the remote is ahead, it stops and asks for a manual `git pull --rebase` while the bot is stopped.

The `connection.update` event remains attached with `sock.ev.on(...)`, which is supported by Baileys. The current Baileys event guide recommends `sock.ev.process(...)` for batching multiple event types in one tick, but it is not a requirement for handling `connection.update`; the dedicated listener is valid.
