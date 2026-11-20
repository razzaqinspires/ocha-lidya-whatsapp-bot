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
.master cli on
.master python on
.master golang on
```

All are off by default and independent: `cli` controls `$` directly, `eval` controls `>`/`=>`, `python` controls `>>`, and `golang` controls `>>>`. There is no global `exec` prerequisite. `.master exec on/off` is temporarily retained as an alias to the CLI switch. Turning on a runner changes a persistent configuration event. A restart does not reset the switch.

The global group interaction setting is `features.groupsMuted`, defaulting to `true`. `.mute on/off/status` is owner-only and private-chat-only. It gates only group dispatch/replies; it does not disable `messages.upsert`, group metadata events, or verified contact indexing. Private-chat operation continues in either mode.


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

Terminal logging is controlled by `src/config.js`. `auto` emits ANSI colors only for an interactive TTY, `NO_COLOR` disables them, `FORCE_COLOR=1` enables them for compatible terminals, and `TERM=dumb` disables them:

```js
logging: {
  level: 'info', // trace, debug, info, warn, error, fatal, silent
  color: 'auto', // auto, always, never
  timeZone: 'Asia/Jakarta'
}
```

The main application logger formats timestamps, severity, component scope, and structured details in a compact terminal layout. Baileys is intentionally configured with its own Pino logger at `silent`; Signal private/session key fields are redacted and the known raw libsignal `SessionEntry` dump is suppressed. Incoming user messages are not printed; command/AI bot actions and delivery states remain traceable.

## Invalid registered-session recovery (v1.5.0)

`whatsapp.recoverInvalidSession` defaults to `true`. When pairing mode has a registered/authenticated local session and WhatsApp rejects that login with disconnect code `401`, the app waits for pending credential writes, moves the existing auth directory to a timestamped sibling ending in `.invalid-<timestamp>-<pid>`, and makes one fresh connection attempt using a new auth directory. The old data is preserved for diagnostics or manual restoration. Recovery is limited to once per process to avoid infinite re-pair loops. Set the flag to `false` to retain the old stop-on-401 behavior.


## UI response settings, group metadata policy, and AI speed profile (schema v12)

```js
ui: {
  buttonsEnabled: true
},
groupMetadata: {
  initialSync: true,
  fetchCooldownMs: 600000
},
ai: {
  timeoutMs: 3500,
  totalBudgetMs: 14000,
  maxOutputTokens: 180,
  historyMessages: 3,
  maxInputChars: 3500,
  coalesceMs: 80,
  maxKeyAttempts: 1
}
```

`ui.buttonsEnabled` is retained as a legacy preference and remains readable/writable through `.buttons on/off/status`. For compatibility and copyability, it does not replace ordinary command replies with native-flow messages. All command responses remain text-first until native-flow payloads are validated against the exact WhatsApp clients in use. `groupMetadata.initialSync` allows the one-time `groupFetchAllParticipating()` cache bootstrap. `groupMetadata.fetchCooldownMs` prevents repeated single-group fetches for an uncached group. These settings do not contain secrets and are persisted in the JSONL config journal. Schema v12 applies the low-latency AI Boost profile to known shipped defaults while preserving owner-customized settings. Boost/fast modes cap key attempts and enforce a total deadline; balanced mode allows more retries. See `AI_ENGINE.md`.

See [`CONTACTS_AND_GROUP_CACHE.md`](CONTACTS_AND_GROUP_CACHE.md) for the dedicated `contact.jsonl` and group metadata JSONL data design.

## AI key management (v1.6.0)

Provider keys managed by `.apikey add` are stored separately at `data/secrets/provider-keys.json`, not in the JSONL configuration. The vault directory/file are created with owner-only permissions where supported. This is not encryption; protect host access and backups. `.apikey list` and `.apikey get` expose only masked key values and fingerprints.


## Nexora Code Lab (schema v16)

The `codeLab` object manages isolated execution and temporary TryCloudflare previews. Its settings are global owner policy and apply to every bot user. Use `.nexora all on/off` for the bundled master switch, or `.nexora code on/off`, `.nexora auto-run on/off`, `.nexora tunnel on/off`, `.nexora workers 1-4`, and `.nexora runtime docker/podman` for individual controls. `workers` is the simultaneous program limit; total preview sessions are configured separately. See [`CODE_LAB.md`](CODE_LAB.md) for container hardening, persistent Quick Tunnel lifecycle, setup, and operational limits.
