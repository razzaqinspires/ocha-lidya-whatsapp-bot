# Configuration API

`src/config.js` is the application configuration facade. It loads defaults, replays `config.replace` records from the JSONL event database, validates changes, and appends new configuration versions.

Do not create a second writable `config.json` source of truth. Do not store secrets in the JSONL database. API keys, passwords, and tokens belong in environment variables or a dedicated secret manager.

```js
import { loadConfig, getConfig, updateConfig } from '../src/config.js';

await loadConfig();
await updateConfig(c => {
  c.features.autoRead = false;
}, { actor: 'owner', reason: 'privacy preference' });

const config = getConfig();
```

`getConfig()` returns a structured clone. Mutating the returned object does not persist changes. All persistent changes must use `updateConfig()` or `replaceConfig()`.


## Master command switches

The developer runners are persisted under `security` and `limits`; they are not environment variables.

```text
.master status
.master eval on
.master exec on
.master cli on
.master python on
.master golang on
```

All are off by default. Turning on a runner changes a persistent configuration event. A restart does not reset the switch.


## WhatsApp connection settings

WhatsApp transport options are non-secret application settings persisted through the JSONL configuration API under `whatsapp`: `authMode` (`qr` or `pairing`), `pairingNumber`, `browserName` (`Chrome`, `Firefox`, `IE`, `Opera`, `Safari`, or `Edge`), `sessionDir`, `connectTimeoutMs`, `queryTimeoutMs`, `keepAliveIntervalMs`, and `recoverInvalidSession`. `browserName` is the Baileys browser identity sent to WhatsApp, not the bot's display name; the default `Chrome` is required for the canonical `Chrome (Ubuntu)` pairing platform. Change them with `updateConfig()`; do not place them in `.env`.

```js
await updateConfig(c => {
  c.whatsapp.authMode = 'pairing';
  c.whatsapp.pairingNumber = '6282177461231';
  c.whatsapp.browserName = 'Chrome';
  c.whatsapp.recoverInvalidSession = true;
}, { actor: 'owner', reason: 'enable pairing login' });
```


## Logging (v1.5.0)

Terminal logging is controlled by `src/config.js`:

```js
logging: {
  level: 'info', // trace, debug, info, warn, error, fatal, silent
  color: 'auto', // auto, always, never
  timeZone: 'Asia/Jakarta'
}
```

The main application logger formats timestamps, severity, component scope, and structured details in a compact terminal layout. Baileys is intentionally configured with its own Pino logger at `silent`; application connection lifecycle and recovery decisions remain visible through the main logger.

## Invalid registered-session recovery (v1.5.0)

`whatsapp.recoverInvalidSession` defaults to `true`. When pairing mode has a registered/authenticated local session and WhatsApp rejects that login with disconnect code `401`, the app waits for pending credential writes, moves the existing auth directory to a timestamped sibling ending in `.invalid-<timestamp>-<pid>`, and makes one fresh connection attempt using a new auth directory. The old data is preserved for diagnostics or manual restoration. Recovery is limited to once per process to avoid infinite re-pair loops. Set the flag to `false` to retain the old stop-on-401 behavior.


## UI response settings, group metadata policy, and AI speed profile (schema v9)

```js
ui: {
  buttonsEnabled: true
},
groupMetadata: {
  initialSync: true,
  fetchCooldownMs: 600000
},
ai: {
  timeoutMs: 5000,
  totalBudgetMs: 12000,
  maxKeyAttempts: 1,
  maxOutputTokens: 320,
  historyMessages: 6,
  coalesceMs: 350
}
```

`ui.buttonsEnabled` controls the default native-flow button wrapper for command replies. Owners can switch it with `.buttons on/off/status`. `groupMetadata.initialSync` allows the one-time `groupFetchAllParticipating()` cache bootstrap. `groupMetadata.fetchCooldownMs` prevents repeated single-group fetches for an uncached group. These settings do not contain secrets and are persisted in the JSONL config journal. Schema v9 migrates previous default AI settings to the fast profile while preserving explicitly customized order/model IDs.

See [`CONTACTS_AND_GROUP_CACHE.md`](CONTACTS_AND_GROUP_CACHE.md) for the dedicated `contact.jsonl` and group metadata JSONL data design.
