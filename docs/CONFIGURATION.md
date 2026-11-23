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

The global group interaction setting is `features.groupsMuted`, defaulting to `true`. Per-group exceptions are stored in `features.groupMuteOverrides`. Owner-only `.joingc <url>` joins a group and starts it muted. The verified owner must send `.mute off` inside the intended group to activate that group; `.mute on` inside the same group mutes it. Non-owner mute commands are silently ignored. In private owner chat, `.mute on all` remains available as an emergency global mute. Bulk activation with `.mute off all` is intentionally rejected; each group must be activated in its own context. The group inventory is reconciled against `groupFetchAllParticipating()` on connection startup and refreshed at most once every five minutes; groups joined while offline are discovered, and stale groups are removed from the inventory. The response gate does not disable `messages.upsert`, group metadata events, or verified contact indexing.


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


## UI response settings, group metadata policy, and AI defaults (current schema v29)

```js
ui: {
  buttonsEnabled: true, // legacy preference
  fullButton: {
    enabled: false,
    strategy: 'adaptive',
    maxBodyChars: 1800,
    excludedCommands: []
  }
},
groupMetadata: {
  initialSync: true,
  fetchCooldownMs: 600000
},
ai: {
  timeoutMs: 3500,
  totalBudgetMs: 14000,
  maxOutputTokens: 900,
  historyMessages: 8,
  maxInputChars: 5000,
  coalesceMs: 100
}
```

`ui.buttonsEnabled` remains as a legacy preference. Schema v28 adds `ui.fullButton`, which is opt-in and remains disabled after migration. The verified owner enables the adaptive engine with `.buttons full all`, audits decisions with `.buttons full audit`, and can exclude any plugin by canonical command or alias using `.buttons full exclude add/remove <command|alias>`. The engine selects Quick Reply for 1–3 safe follow-ups, Single Select for 4–8, and text for long, code, progress, or diagnostic output. Commands with explicit UI and reply-session navigation are excluded. `maxBodyChars` is bounded to 300–3,500 characters. Settings are persisted in the JSONL config journal. `groupMetadata.initialSync` allows the one-time `groupFetchAllParticipating()` cache bootstrap. `groupMetadata.fetchCooldownMs` prevents repeated single-group fetches for an uncached group. Schema v29 raises the shipped response/context defaults for more complete grounded answers while preserving owner-customized settings. Memory remains opt-in and per-user; command execution still uses the normal plugin authorization gate. AI provider routing now exhausts eligible keys for key-specific quota/auth failures before moving through the configured provider chain; speed profiles tune request timeouts and output/context budgets without capping the key array. See `COMMAND_BUTTON_ENGINE.md` and `AI_ENGINE.md`.

See [`CONTACTS_AND_GROUP_CACHE.md`](CONTACTS_AND_GROUP_CACHE.md) for the dedicated `contact.jsonl` and group metadata JSONL data design.

## AI key management (v1.6.0)

Provider keys managed by `.apikey add` are stored separately at `data/secrets/provider-keys.json`, not in the JSONL configuration. The vault directory/file are created with owner-only permissions where supported. This is not encryption; protect host access and backups. `.apikey list` and `.apikey get` expose only masked key values and fingerprints.


## Nexora Code Lab (schema v16)

The `codeLab` object manages isolated execution and temporary TryCloudflare previews. Its settings are global owner policy and apply to every bot user. Use `.nexora all on/off` for the bundled master switch, or `.nexora code on/off`, `.nexora auto-run on/off`, `.nexora tunnel on/off`, `.nexora workers 1-4`, and `.nexora runtime docker/podman` for individual controls. `workers` is the simultaneous program limit; total preview sessions are configured separately. See [`CODE_LAB.md`](CODE_LAB.md) for container hardening, persistent Quick Tunnel lifecycle, setup, and operational limits.


## AI model discovery settings (v1.10.10)

`ai.freeOnly` defaults to `true`. When enabled, only models present in both the authenticated provider model-list response and the official free-tier allowlist can be selected. Groq and Gemini are eligible; DeepSeek and OpenAI are treated as paid API providers. Use `.aiset free-only off` only when provider billing is intentionally enabled.

The model catalogue is stored separately in `data/ai-model-catalog.json`, not in the single-writer primary JSONL journal. The in-process scheduler and detached Node.js worker start automatically with `npm start`. The detached worker survives terminal closure and main-bot shutdown while the VPS remains online, refreshes when due, retries transient catalogue outages hourly, and reloads the provider-key vault from disk. No systemd, cron, installer, or extra command is required. A VPS shutdown stops all local processes; the next `npm start` recreates the worker and catches up. See [`AI_MODEL_CATALOG.md`](AI_MODEL_CATALOG.md).
