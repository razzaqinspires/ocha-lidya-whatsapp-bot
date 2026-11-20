# Ocha Lidya WhatsApp Bot

Ocha Lidya is a modular WhatsApp automation framework built with native Node.js ESM and `@whiskeysockets/baileys`. The project separates WhatsApp transport, message serialization, command dispatch, plugin execution, persistent configuration, and durable JSONL storage.

## AI response performance (v1.7.1)

The default AI profile is Boost after the schema v12 migration. It uses an 80 ms message-coalescing window, 3 history turns, a 180-token output budget, one eligible API key attempt per provider, a 3.5-second per-provider timeout, and a 14-second total fallback deadline. Use `.aiset speed boost`, `.aiset speed fast`, or `.aiset speed balanced` to switch profiles. Provider telemetry, job checkpoints, and conversation journal writes are queued asynchronously so they do not block the response-critical path; hot conversation history and quoted-reply anchors are updated immediately. See `docs/AI_ENGINE.md` for trade-offs and operational details.

## 1. Project identity

| Property | Value |
|---|---|
| Bot name | Ocha Lidya |
| Aliases | Ocha, Lidya |
| Owner | `6283193905842` |
| Expected bot number | `6282177461231` |
| Runtime | Node.js 20.18+ (Node.js 22 LTS recommended) |
| Module system | ESM |
| WhatsApp transport | `@whiskeysockets/baileys` |
| Persistence | Append-only JSONL event database |
| Plugin system | Dynamic ESM modules with hot reload |

The expected bot number is a validation setting. The connection supports both QR login and phone-number pairing code login. The actual connected account is checked after authentication.

## 2. Quick start

```bash
cp .env.example .env
# Isi GITHUB_PAT di .env bila auto-push GitHub ingin diaktifkan.
npm install
npm run git:setup
# Set identitas Git satu kali bila belum tersedia:
git config user.name "Nama Commit"
git config user.email "email-github@example.com"
npm run check
npm test
npm start
```

`npm run git:setup` menyiapkan repository lokal/branch `main` dan memastikan remote `origin` mengarah ke repository resmi. Bila folder ini merupakan hasil `git clone`, perintah tersebut hanya memverifikasi konfigurasi yang sudah ada.

By default, the bot uses phone-number pairing code. The shipped `src/config.js` already sets `authMode: 'pairing'`. To switch to QR login, change that value to `'qr'` (or update it through the configuration API):

```js
whatsapp: {
  authMode: 'pairing', // default; ubah ke 'qr' untuk QR login
  pairingNumber: '6282177461231',
  browserName: 'Chrome', // harus nama browser Baileys, bukan nama bot
  sessionDir: 'sessions/ocha-lidya',
  connectTimeoutMs: 60000,
  queryTimeoutMs: 60000,
  keepAliveIntervalMs: 25000,
  recoverInvalidSession: true
},
```

For an existing installation, v1.5.0 through v1.7.1 perform one-time configuration migrations through schema v12, preserving owner-defined provider/model overrides while enabling low-latency AI defaults, button responses, group-cache settings, and contact indexing. Then restart `npm start`. The bot waits for Baileys' initial pairing-readiness event (without displaying the QR) before requesting the eight-character phone-number pairing code in the terminal. On the target phone, open WhatsApp → Linked devices → Link a device → Link with phone number, then enter the code. Use the full international number without `+`, spaces, or punctuation. Set `c.whatsapp.authMode = 'qr'` in `src/config.js` to return to QR login. Session folder, accepted browser identity, and connection timeouts are also application settings under `whatsapp`; `browserName` must be `Chrome`, `Firefox`, `IE`, `Opera`, `Safari`, or `Edge`—never set it to `Ocha Lidya`. See `docs/WHATSAPP_CONNECTION.md`. If WhatsApp rejects a previously saved registered session with `401` while pairing mode is enabled, v1.4.4 moves that session directory to a timestamped `.invalid-*` backup (it does not delete it) and makes one fresh pairing attempt. Set `whatsapp.recoverInvalidSession: false` to disable this behavior.

### Requirements

- Node.js 20.18 or later.
- npm.
- A dedicated WhatsApp account for the bot.
- Writable persistent storage for `data/` and `sessions/`.
- Python 3 and Go only if their developer runners are intentionally enabled.
- Docker or rootless Podman plus `cloudflared` for Nexora Code Lab. Pull `python:3.12-alpine` and `node:22-alpine` before enabling execution.

The syntax checker scans every JavaScript file under `src/`, `test/`, and `scripts/`, including the central configuration module at `src/config.js`.

## 3. Logging

The application logger uses compact, colorized terminal output with WIB timestamps and readable context fields. Its level and color mode are managed in `src/config.js` under `logging` (`level: 'info'`, `color: 'auto'`, `timeZone: 'Asia/Jakarta'`). Baileys receives a separate Pino-compatible no-op logger at `silent`. Structured logs redact Signal/session key fields, and the known raw libsignal `SessionEntry` console dump is suppressed. Incoming user messages are correlated in memory but are not printed; Ocha command/AI responses and delivery states remain traceable. Runtime auth/data/log directories are excluded from recursive filesystem watchers to prevent Linux inotify exhaustion.

## 4. Environment variables

`.env` stores secrets and credentials only, for example:

```dotenv
OPENAI_API_KEY=
GEMINI_API_KEY=
GROQ_API_KEY=
DEEPSEEK_API_KEY=
GITHUB_PAT=

```

Do not put bot name, owner number, prefixes, bot mode, feature flags, database paths, archive limits, execution switches, or runtime limits in `.env`. Those are managed through `src/config.js` and persisted in the JSONL database. WhatsApp login mode, pairing number, session folder, and connection timeouts are non-secret application settings persisted in the JSONL configuration database. Only `GITHUB_PAT` and provider API keys belong in `.env`.

Never commit `.env`, WhatsApp sessions, database journals, archives, or runtime logs.

## 5. Configuration architecture

The `src/config.js` module is the public configuration facade. It exposes:

- `loadConfig()` — initializes storage and rebuilds active configuration from durable events.
- `getConfig()` — returns a defensive copy of active configuration.
- `updateConfig(mutator, metadata)` — validates a change and appends a new configuration event.
- `replaceConfig(config, metadata)` — replaces settings with a validated configuration version.
- `configDefaults` — baseline defaults.

Example:

```js
import { loadConfig, getConfig, updateConfig } from './src/config.js';

await loadConfig();

await updateConfig(config => {
  config.mode = 'self';
}, {
  actor: 'owner',
  reason: 'maintenance window'
});

console.log(getConfig().mode);
```

`getConfig()` returns a structured clone. Mutating the returned object does not persist changes. All changes must go through `updateConfig()` or `replaceConfig()`.

For application records, `src/core/repository.js` exposes `putRecord(namespace, key, value)`, `getRecord(namespace, key)`, `listRecords(namespace)`, and `deleteRecord(namespace, key)`. These APIs append `entity.put` and `entity.delete` events; they never rewrite a large JSON document. Reads currently replay matching event history, so this is suitable for low-to-medium bot state and can later be replaced behind the same API with a database that has secondary indexes.

Configuration is stored as `config.replace` events in the JSONL event database. A latest-state checkpoint is also maintained at `data/control/config.snapshot.jsonl` so the active settings remain recoverable even when older archive segments are eventually pruned. The event journal remains the historical record.

## 6. Durable JSONL database

The database is append-only. It does not rewrite one large JSON object after every command or configuration change.

### Directory layout

```text
data/
├── contact.jsonl              # permanent, deduplicated PN contact index
├── group-metadata.jsonl       # group-only metadata event log
├── control/
│   └── config.snapshot.jsonl
├── journal/
│   └── active.jsonl
├── replica/
│   └── active.jsonl
├── archives/
│   ├── index.jsonl
│   └── <segment-id>.jsonl.zip
└── quarantine/
    └── *.corrupt
```

Each event is one JSON line containing:

- `seq`: sequence number within its segment.
- `segmentId`: stable segment identifier.
- `ts`: ISO timestamp.
- `type`: event type.
- `payload`: event data.
- `metadata`: actor, reason, or source metadata.
- `prevHash`: previous record hash.
- `hash`: SHA-256 digest of the canonical record fields.

Sequence numbers restart at one for each segment. `segmentId` distinguishes segments and allows duplicate detection if a process stops during archive rotation.

The hash chain detects accidental edits, malformed records, and incomplete tails. It is an integrity check, not encryption or authentication.

### Primary, replica, and recovery

At startup:

1. Primary and replica journals are parsed independently.
2. Each record is checked for JSON validity, sequence continuity, previous hash, and SHA-256 integrity.
3. Damaged copies are retained under `data/quarantine/`.
4. The copy with the longest verified record prefix is selected.
5. The selected valid records are atomically written back to the primary and replica.
6. If both copies contain no recoverable valid prefix and both are corrupt, startup stops instead of silently creating an empty database.

The local replica helps with logical corruption and interrupted writes. It does not protect against physical disk failure when both copies are on the same disk. Maintain encrypted off-device backups.

### Automatic ZIP archives

The active journal is archived when it reaches `database.segmentMaxBytes` (default 8 MiB).

Archive sequence:

1. Copy the active JSONL segment to an archive staging file.
2. Validate the staged JSONL and hash chain.
3. Compress the segment into ZIP.
4. Verify the ZIP checksum and the decompressed JSONL checksum.
5. Append metadata to `data/archives/index.jsonl`.
6. Clear the active journal and replica only after successful verification and indexing.
7. Apply retention using `database.archiveMaxCount` (default 120).

Archive metadata records the segment ID, sequence bounds, record count, source SHA-256, ZIP SHA-256, and creation time.

Archive search streams JSONL data from ZIP. It does not extract the full archive to disk. `.dbsearch <keyword>` searches retained ZIP archives. The search is sequential across archive files, not a database-style indexed random lookup.

Retention is bounded. When the configured maximum is exceeded, the oldest archives are deleted. Increase the retention limit and maintain external backups if long-term historical retention is required.

### Database health and archive commands

| Command | Description |
|---|---|
| `.dbstatus` | Primary/replica integrity and archive count |
| `.dbsearch <keyword>` | Search retained ZIP archives without full extraction |

## AI API key management (v1.6.0)

Qwen has been removed. The AI route now attempts all eligible keys for each provider before moving to the next provider. Owner commands:

```text
.apikey add gemini AQ.xxx_xxx1,AQ.xxx_xxx2
.apikey list gemini
.apikey get gemini <fingerprint>
.apikey delete gemini <fingerprint>
.aistatus
```

Managed keys are stored in `data/secrets/provider-keys.json` with restrictive local file permissions. The file is not encrypted; protect the host and backups. `.apikey list/get` mask secrets and use fingerprints to identify keys. If every configured key/provider is exhausted, AI enters maintenance, stays silent to users, and sends a detailed private report to the owner. Keys are probed again when their retry time arrives. See `docs/AI_ENGINE.md` for status classifications and limitations.

## 7. Persistent configuration reference

Default settings are declared in `src/config.js`; runtime changes are persisted in the JSONL database.

| Setting | Default | Description |
|---|---|---|
| `bot.name` | `Ocha Lidya` | Display name used by bot messages |
| `bot.aliases` | `Ocha`, `Lidya` | Alternate names |
| `bot.owner` | `6283193905842` | Owner number |
| `bot.expectedNumber` | `6282177461231` | Expected paired WhatsApp account |
| `whatsapp.recoverInvalidSession` | `true` | Preserve rejected registered sessions as timestamped backups and make one fresh pairing attempt after 401 |
| `logging.level` | `info` | Application log threshold |
| `logging.color` | `auto` | Enable terminal colors when attached to a TTY |
| `logging.timeZone` | `Asia/Jakarta` | Timestamp timezone for application logs |
| `mode` | `public` | `public` or `self` |
| `ui.buttonsEnabled` | `true` | Legacy preference only; command responses remain text-first for compatibility |
| `groupMetadata.initialSync` | `true` | Perform a single initial batch load of participating group metadata |
| `groupMetadata.fetchCooldownMs` | 600,000 ms | Cooldown for a one-time lazy fetch of a group missing from cache |
| `ai.timeoutMs` | 7,000 ms | Per-key request timeout in the fast profile |
| `ai.totalBudgetMs` | `45000` | Advisory fallback budget; it never truncates exhaustive key validation |
| `ai.coalesceMs` | 350 ms | Merge rapid adjacent messages from one sender into a single AI turn |
| `prefix.mode` | `multi` | `single`, `multi`, or `none` |
| `prefix.single` | `.` | Single prefix |
| `prefix.list` | `. ! / #` | Multi-prefix list |
| `security.masterEvalEnabled` | `false` | JavaScript evaluator switch |
| `security.masterCliEnabled` | `false` | CLI shell (`$`) switch; independent of other runners |
| `security.masterPythonEnabled` | `false` | Python runner (`>>`) switch |
| `security.masterGolangEnabled` | `false` | Go runner (`>>>`) switch |
| `features.groupsMuted` | `true` | Silence all group commands and group AI; metadata/contact ingestion stays active |
| `database.segmentMaxBytes` | 8 MiB | Journal archive threshold |
| `database.archiveMaxCount` | 120 | Maximum retained ZIP archives |
| `database.mirrorEnabled` | `true` | Maintain local replica |
| `database.fsync` | `true` | Flush writes before acknowledging |
| `limits.pluginTimeoutMs` | 15,000 | Plugin timeout policy |
| `limits.masterTimeoutMs` | 8,000 | Developer runner timeout |
| `limits.masterMaxOutput` | 12,000 | Developer runner output cap |

Use owner commands or the `src/config.js` API for changes. Do not manually edit active JSONL journal files.

## 8. Commands

Default multi-prefix values are `.`, `!`, `/`, and `#`.

### General

| Command | Alias | Description |
|---|---|---|
| `.menu` | `.help`, `.commands` | Display command menu |
| `.ping` | `.speed`, `.latency` | Basic response latency |
| `.owner` | `.creator` | Send the owner WhatsApp contact card |
| `.about` | `.botinfo` | Bot identity and build information |
| `.runtime` | `.system`, `.sysinfo` | Node runtime, memory, host and process details |
| `.groupinfo` | `.gcinfo`, `.grouplist` | In a private chat, navigate cached groups by replying with a number; in a group, show that group's cached metadata |
| `.run python <code>` | `.execute`, `.previewcode` | Execute Python/Node.js or display HTML in an isolated temporary web preview |
| Natural-language `coba jalankan` | — | Run the most recent assistant code block and return a session URL |
| `.nexora status` | `.capability`, `.aitools` | Owner-only AI capability and Code Lab worker controls |

### Owner and developer

| Command | Alias | Description |
|---|---|---|
| `.setmode public` | `.mode public` | Allow public command usage |
| `.setmode self` | `.mode self` | Restrict command usage to owner |
| `.setprefix single !` | `.prefix` | Set single-prefix mode |
| `.setprefix multi` | `.prefix` | Enable multi-prefix mode |
| `.setprefix multi add #` | `.prefix` | Add a multi-prefix |
| `.setprefix multi del #` | `.prefix` | Remove a multi-prefix |
| `.setprefix none` | `.prefix` | Disable prefix requirement |
| `.setprefix show` | `.prefix` | Display prefix configuration |
| `.setbotname Ocha Lidya` | `.botname` | Change internal display name |
| `.plugins` | `.pluginlist` | List loaded plugins |
| `.reload` | `.reloadplugins` | Reload plugin registry |
| `.jid` | `.jidinfo`, `.liddebug` | Inspect current PN/LID fields |
| `.dbstatus` | `.database`, `.dbhealth` | Database health |
| `.dbsearch keyword` | `.archivefind` | Search ZIP archives |
| `.aistatus` | `.aihealth` | Show AI provider readiness, model, key counts, average latency, health counters, timeout, and speed profile |
| `.nexora status` | `.capability`, `.aitools` | Show Nexora capability switches, Code Lab status, queue, workers, and tunnel |
| `.nexora code on/off` | — | Enable or disable the isolated Code Lab service |
| `.nexora auto-run on/off` | — | Enable or disable natural-language code execution |
| `.nexora tunnel on/off` | — | Enable or disable temporary public TryCloudflare links |
| `.nexora all on/off` | — | Turn all Nexora AI and Code Lab capabilities on/off globally |
| `.nexora workers 1-4` | — | Set simultaneous worker count (not session count) |
| `.nexora runtime docker/podman` | — | Select the container runtime |
| `.aiset on/off` | `.aiconfig` | Enable or disable AI |
| `.aiset speed boost/fast/balanced` | — | Switch between Boost, fast, and retry-tolerant balanced profiles |
| `.aiset order <providers>` | — | Set provider fallback order |
| `.aiset model <provider> <model>` | — | Override one provider's model ID |
| `.buttons on/off/status` | `.buttonmode` | Owner control for interactive replies |
| `.master status` | `.masterconfig` | Show master runner switches |
| `.master eval on/off` | — | Enable/disable JavaScript evaluation |
| `.master cli on/off` | — | Enable/disable shell CLI directly; no global `exec` prerequisite |
| `.master python on/off` | — | Enable/disable Python runner |
| `.master golang on/off` | — | Enable/disable Go runner |
| `.mute on/off/status` | `.groupmute` | Owner-only, private-chat-only mute for all group interactions; group metadata/contact indexing remains active |
| `.test <type> <options>` | `.testmsg`, `.messagetest` | Owner-only Baileys message lab: native-flow, hydrated template, event/date, poll, PTV, view-once, AI rich, and carousel |

All owner plugins use `ownerOnly: true`. `.groupinfo` is intentionally available in private chat: it lists only the local cached group index and does not request fresh metadata for already-cached groups.

### Prefix examples

```text
.setprefix single !
.setprefix multi
.setprefix multi add #
.setprefix multi del #
.setprefix none
.setprefix show
```

In `none` mode, the first word is parsed as the command name. This can cause ordinary messages to be interpreted as commands. Use `self` mode if that behavior is not desired.

### Bot mode examples

```text
.setmode public
.setmode self
```

`public` permits non-owner users to execute non-owner plugins. `self` rejects non-owner command execution.

## 9. Master developer console

Master syntax is reserved outside the normal prefix parser and is owner-only:

| Syntax | Runtime |
|---|---|
| `> <JavaScript>` | Async JavaScript |
| `=> <JavaScript>` | Async return-style JavaScript |
| `$ <command>` | Shell CLI |
| `>> <Python>` | Python |
| `>>> <Go>` | Go |

All developer runners are disabled by default. Each runner is independent: `.master eval on` enables `>`/`=>`, `.master cli on` immediately enables `$`, `.master python on` enables `>>`, and `.master golang on` enables `>>>`. `.master exec on/off` remains only as a temporary legacy alias for `.master cli on/off`; it is not a separate global gate. Group interaction is muted by default; use `.mute off` in a private chat to enable it for all groups, and `.mute on` to silence all groups again. These settings are persistent database settings, not environment variables.

**Security warning:** Node.js `vm` is not a security boundary. Shell, Python, and Go commands can affect the host. Do not enable them on a production host containing secrets or user data. Use a dedicated unprivileged container/VM, read-only mounts, no host secrets, CPU/memory/PID limits, and restricted networking. The bot should never run as root.

## 10. Plugin development

Each plugin is a native ESM module with a default export:

```js
export default {
  name: 'hello',
  aliases: ['hi'],
  category: 'general',
  description: 'Example command',

  async execute({ sock, m, args, text, command, config, isOwner }) {
    await m.reply(`Hello ${m.pushName || 'there'}`);
  }
};
```

Place plugins in:
- `src/plugins/general/` for public/general features.
- `src/plugins/owner/` for owner-only features.

The loader watches plugin files and hot-reloads changes. If a replacement fails to import or validate, the last known working plugin remains registered.

### Plugin context

| Property | Meaning |
|---|---|
| `sock` | Active Baileys socket |
| `m` | Serialized incoming message |
| `args` | Parsed command arguments |
| `text` | Joined argument text |
| `command` | Normalized command name |
| `config` | Configuration snapshot for this dispatch |
| `isOwner` | Owner authorization result |

A plugin must declare a unique `name`, an `execute` function, and optional aliases/permission metadata.

## 11. JID and LID handling

WhatsApp may provide:
- PN JID: `628...@s.whatsapp.net`
- LID: opaque identifier ending in `@lid`

Do not manufacture a phone JID by replacing `@lid` or treating the LID numeric portion as a phone number. The message pipeline checks the current Baileys alternate/PN fields: private chat `senderPn`, `remoteJidPn`, `remoteJidAlt`, then `remoteJid`; group sender `senderPn`, `participantPn`, `participantAlt`, then `participant`. A verified `signalRepository.lidMapping.getPNForLID()` lookup is the final fallback. If no verified mapping exists, the sender remains a LID and is not inserted into the PN contact database. Owner recognition uses the same verified PN resolution.

For ordinary replies, use the actual incoming chat JID. PN-only workflows must require a verified mapping.

## 12. Converted source modules
### Serializer ESM compatibility

The serializer module currently exposes its API through a default export object. The application entry point imports that object and destructures `serialize`, `extendSocket`, and `trackSentMessageId`; do not convert this import back to named imports unless matching named exports are explicitly added to `src/lib/serializ_simple.js`.


User-supplied modules are retained under `src/lib/`:

- `freply.js`
- `serializ_simple.js`
- `helpers.js`

The original function bodies, classes, constants, and export aliases are preserved as far as the ESM conversion allows. Conversion history, hashes, import changes, and compatibility notes are documented in [`docs/SOURCE_CONVERSION.md`](docs/SOURCE_CONVERSION.md).

## 13. Documentation and release discipline

Every feature change must update:

1. `README.md` — current commands, aliases, APIs, configuration, behavior, architecture, setup, and limitations.
2. `docs/CHANGE_LOG.md` — dated change summary, additions, changes, fixes, and known limitations.
3. Relevant detailed documentation under `docs/`.

A new command is not complete until it is listed in the README and the menu. A new persistent setting must be documented in the configuration reference. A new public function must include its purpose, parameters, return behavior, and source/provenance where applicable.

## 14. Operations and backups

- Back up `data/` and `sessions/` separately and securely.
- Keep encrypted off-device backups.
- Test restoration periodically.
- Never manually edit active JSONL journal files.
- Review quarantine files before deleting them.
- Run under a non-root OS account.
- Restrict filesystem permissions on `data/`, `sessions/`, `.env`, and logs.
- Keep master execution disabled outside controlled development.

## 15. Automatic Git monitoring and push

The application starts a repository-wide file watcher as part of `npm start`. It observes additions, edits, and deletions across normal source, documentation, test, and package files. Runtime/private trees (`sessions/`, `data/`, `logs/`, dependencies, caches, and build artifacts) are excluded before recursive traversal. Filesystem events are debounced so a file is not committed while an editor or generator is still writing it.

Before staging, the watcher reads the root `.gitignore` and asks Git `check-ignore` whether each changed path is excluded. Git itself is the authoritative matcher, so negation patterns and Git ignore semantics are respected. Paths excluded by `.gitignore`, `.git`, `node_modules`, and the runtime/private-directory policy are never watched or staged. A second guard inspects the staged index and blocks a commit if an excluded file is already staged. New, modified, renamed, and deleted paths that pass the check are staged individually with `git add -A -- <path>`.

After the quiet window, the service creates a local commit and pushes `HEAD` to `origin/main`. The commit message starts with `pasang waktu Otomatis, waktu, tanggal, jam, dan hari yang kompleks.` and includes the weekday, date, time, and `WIB` timestamp for `Asia/Jakarta`. The service never force-pushes. It fetches `origin/main`, rebases only when the remote is a direct ancestor of the local history, and stops if histories have diverged or conflicts occur.

### GitHub token

Put the Personal Access Token only in the local `.env` file:

```dotenv
GITHUB_PAT=github_pat_your_token_here
```

Use a fine-grained token restricted to `razzaqinspires/ocha-lidya-whatsapp-bot` with repository **Contents: Read and write** permission. The Git remote remains a normal URL; the token is provided to Git through a temporary `GIT_ASKPASS` helper and environment variable. It is not embedded in the remote URL, command arguments, source files, changelog, or logs. Never paste the real token into source control or conversation files.

The Git service requires Git installed, the local repository initialized, active branch `main`, remote `origin` pointing to `https://github.com/razzaqinspires/ocha-lidya-whatsapp-bot.git`, a configured Git author identity, network access, and a valid `GITHUB_PAT`. If the token is absent, local eligible changes can still be committed, but pushing is skipped until a valid token is available. The bot must be running for filesystem-based automatic monitoring; there is no background service after the Node process stops.

Commands:

- `npm run git:setup` — initialize/verify the local repository, branch, and remote.
- `npm run git:watch` — run only the automatic Git watcher for diagnosis.
- `npm start` — start the bot and the automatic Git watcher together.

See [`docs/AUTO_GIT_SYNC.md`](docs/AUTO_GIT_SYNC.md) for behavior, failure handling, and security details.

## 16. Source hot reload

The source loader watches JavaScript files throughout `src/`, not just command plugins. Adding, editing, or deleting a file under `src/plugins/` updates the plugin registry without restarting WhatsApp. Changes to core, library, master, or other non-plugin JavaScript modules trigger a controlled process restart because Node.js ESM modules and their dependency graphs cannot safely be replaced in place after import. JSON and other non-JavaScript source/documentation files are not imported by the source loader, but eligible files are monitored by the repository-wide Git watcher for auto-commit and push. Runtime directories such as `sessions/`, `data/`, and `logs/` are excluded.

See [`docs/HOT_RELOAD.md`](docs/HOT_RELOAD.md).

## 17. Project structure

The root is intentionally limited to hidden configuration files, `package.json`, and `README.md`; application source, documentation, tests, and scripts live in dedicated folders.

```text
ocha-lidya-bot/
├── .env.example
├── .gitignore
├── README.md
├── package.json
├── data/                    # ignored runtime JSONL database and archives
├── docs/
│   ├── AUTO_GIT_SYNC.md
│   ├── CONTACTS_AND_GROUP_CACHE.md
│   ├── CHANGE_LOG.md
│   ├── CONFIGURATION.md
│   ├── DATABASE_DESIGN.md
│   ├── HOT_RELOAD.md
│   └── SOURCE_CONVERSION.md
├── logs/
├── scripts/
│   ├── check-syntax.js
│   ├── git-setup.js
│   └── git-watch.js
├── src/
│   ├── config.js
│   ├── core/
│   │   ├── auto-git-sync.js
│   │   ├── contacts.js
│   │   ├── group-metadata.js
│   │   ├── group-runtime.js
│   │   ├── jid-resolution.js
│   │   ├── ui.js
│   │   ├── database.js
│   │   ├── git-utils.js
│   │   ├── repository.js
│   │   ├── config.js
│   │   ├── dispatcher.js
│   │   └── plugin-loader.js
│   ├── lib/                 # converted source modules
│   ├── master/
│   └── plugins/
├── test/
└── sessions/                # ignored Baileys credentials
```

## 18. Version and change history

Current package version: **1.7.0** (configuration schema v11).

See [`docs/CHANGE_LOG.md`](docs/CHANGE_LOG.md) for release history and [`docs/DATABASE_DESIGN.md`](docs/DATABASE_DESIGN.md) for persistence internals.


## 19. Multi-provider AI assistant

AI only responds to non-command messages. In private chats, normal text can invoke AI. In groups, the bot responds **only** when the message explicitly mentions the bot's actual WhatsApp JID or replies to a message authored by the bot. Other group messages are ignored. Unknown prefixed commands never fall through to AI.

Provider fallback order by default: Groq → Gemini → DeepSeek → OpenAI. The default profile uses Groq `openai/gpt-oss-20b` first and Gemini `gemini-3.8-flash` as the next fallback. Providers without API keys are skipped. Multiple environment keys can be separated by commas, semicolons, or newlines. Owner-managed keys can also be added with `.apikey add`; they are stored in a restricted local vault. See `docs/AI_ENGINE.md`.

```dotenv
GEMINI_API_KEY=key_one,key_two
GROQ_API_KEY=key_one;key_two
DEEPSEEK_API_KEY=
OPENAI_API_KEY=
```

The engine warms a bounded in-memory history cache once at startup, attempts every eligible key within each provider before moving to the next provider, records per-key hits and response classifications, coalesces messages arriving within 350 ms from the same sender, and falls back across providers. If all keys are unavailable, AI enters silent maintenance and privately reports the inventory to the owner. Public model identity: Nexora-2.0-Flash. Delivery recovery is at-least-once if the process crashes during WhatsApp send. AI conversation turns are isolated by chat and sender.

Owner commands: `.aistatus`, `.aiset on`, `.aiset off`, `.aiset speed boost`, `.aiset speed fast`, `.aiset speed balanced`, `.aiset order groq,gemini,deepseek,openai`, `.aiset model <provider> <model>`, `.buttons on`, `.buttons off`, and `.buttons status`. Interactive replies are enabled by default; `.buttons off` switches all `m.reply()` command responses to plain text.

See [docs/AI_ENGINE.md](docs/AI_ENGINE.md) for provider model defaults, API details, recovery semantics, and operational guidance. Free tiers are not unlimited and depend on provider account, region, and quota; OpenAI and DeepSeek API usage should be treated as paid unless the account explicitly shows credits.


## 20. Permanent contacts, group metadata cache, and interactive commands

At startup Ocha Lidya creates `data/contact.jsonl` and `data/group-metadata.jsonl` if they do not exist. `contact.jsonl` stores one JSON object per line (JSONL), with the exact fields `{"number":"628...","name":"","gender":""}`. The file is a JSONL stream, not one bracketed JSON array. Only an explicit PN JID or a PN returned by Baileys' verified LID mapping is accepted. A number is stored without `@s.whatsapp.net`; duplicates are skipped both on startup and during append. Existing duplicate/invalid rows are compacted once, with the original file copied into `data/quarantine/` first.

The first connection performs one `groupFetchAllParticipating()` batch and persists the returned metadata. A `group.bootstrap.complete` marker prevents repeat full refreshes after a successful bootstrap. Thereafter `groups.upsert`, `groups.update`, and `group-participants.update` events update the local cache. A cached group does not trigger `groupMetadata()` network requests when `.groupinfo` is used. A group missing from cache may receive one lazy fetch, protected by an in-flight guard and configurable cooldown. Member additions/modifications add newly verified PN numbers to the permanent contacts file; member removals update only the group metadata log. When the bot itself is removed/leaves, that group's metadata cache entry is deleted, but contacts are never deleted.

`.groupinfo` in a private chat lists groups already in the metadata cache. Reply to the exact list message with `1`-`10` to open a group; `0` advances a page and `00` returns to the previous page. Reply `0` to a detail view to return to the list. `.groupinfo` inside a group shows that group's cache. It does not force repeated metadata requests. See [`docs/CONTACTS_AND_GROUP_CACHE.md`](docs/CONTACTS_AND_GROUP_CACHE.md) for event semantics, file formats, PN/LID resolution order, and recovery behavior.

Command responses use the serializer's ordinary text transport by default. This keeps every response readable, searchable, selectable, and copyable in standard WhatsApp clients. `.menu` and `.groupinfo` show explicit command syntax as text. A quoted reply to an active command screen is routed through the command-session lane before AI detection; these in-memory sessions are sender-bound and expire after 10 minutes by default. In groups, AI quoted-reply activation requires a known AI answer message ID, not merely any message authored by the bot. AI reply chains preserve up to 8 linked AI turns and 12,000 characters of context. See [`docs/REPLY_ROUTING_AND_TEST_MESSAGES.md`](docs/REPLY_ROUTING_AND_TEST_MESSAGES.md). The legacy `ui.buttonsEnabled` setting and `.buttons on/off/status` command remain for configuration compatibility, but ON does not wrap all command replies in native-flow payloads. Interactive APIs are available only to explicit feature implementations after client compatibility testing; a successful relay/ACK does not guarantee that a WhatsApp client can render the message.


## 21. Ocha Master Console, group mute, and message-flow telemetry

Master runners are independent in schema v11. `$` is controlled directly by `.master cli on/off`; JavaScript eval (`>` and `=>`), Python (`>>`), and Go (`>>>`) each have their own independent switches. There is no longer a global `exec` gate. `.master exec on/off` is only a temporary compatibility alias for `.master cli on/off`; use `cli` in new commands and documentation. `.master status` displays the owner-only console control panel. See [`docs/MASTER_CONSOLE.md`](docs/MASTER_CONSOLE.md).

All group interaction is muted by default through `features.groupsMuted: true`. `.mute on/off/status` is owner-only and private-chat-only. While muted, group commands and group AI are not dispatched, but incoming event processing still indexes verified contacts and maintains group metadata. Private-chat commands and AI are unaffected. See [`docs/GROUP_MUTE_AND_MESSAGE_FLOW.md`](docs/GROUP_MUTE_AND_MESSAGE_FLOW.md).

The message-flow monitor labels private/group destinations and consumes Baileys `messages.update` and `message-receipt.update` events. Its local terminal legend is `✓ SENT`, `✓✓ DELIVERED`, `✓✓ READ`, `✓✓ PLAYED`, and a separately colored `BOT REPLIED` marker. It does not modify WhatsApp's own tick UI or create a third WhatsApp checkmark. The monitor stores only bounded metadata, not message bodies.


### Master Console: full eval context and workload guard (v1.7.2)

JavaScript eval (`>` and `=>`) now receives live `sock`, serialized `m`/`message`, `config`, `logger`, `db`, `fs`, `path`, `os`, `crypto`, `childProcess`, `process`, `Buffer`, `require`, and `importModule` references. These are real host capabilities, not mocks. This is intentionally owner-only and is not a security sandbox: eval can affect the running bot and host account.

All master runtimes (`$`, `>`, `=>`, `>>`, `>>>`) pass through WorkloadTracker. Low-risk commands continue immediately. Suspicious operations are sent to Ocha's small workload-assessment request, then Ocha may auto-approve only an explicit `ALLOW` with low/medium severity. Otherwise the owner receives a quoted warning with impact, safer alternative, and a one-time `CONFIRM CODE` / `CANCEL` reply session (120-second expiry). If AI assessment is unavailable, the command fails closed. Static critical host-wide patterns (for example deleting the filesystem root, disk formatting/wiping, fork bombs, and host shutdown) are blocked without a chat override. Scoped destructive actions such as `rm -rf ./*/` require AI review and explicit owner confirmation.

The AI review is an advisory impact estimate, not a proof of safety. The confirmation mechanism reduces accidental execution but does not make arbitrary code safe. Run master commands only on a controlled host and keep backups.



## 22. Nexora Code Lab: isolated execution and temporary preview

Users can ask Ocha to run the most recent assistant code block by saying `coba jalankan` or `buat preview hasilnya`. The AI capability manager routes explicit execution intent to Code Lab. `.run` provides a direct command path. Python 3.12 and Node.js 22 execute in per-session containers; HTML/CSS/JavaScript is displayed in a sandboxed iframe. Python/Node execution is network-isolated and limited to standard libraries, 128 MiB memory, 0.5 CPU, 64 PIDs, 48 KiB combined captured output, and 120 seconds runtime by default.

Each session receives an unguessable path on a temporary `trycloudflare.com` Quick Tunnel. Session paths are independently revoked after 60 minutes, with automatic container and workspace cleanup. One shared Quick Tunnel is reused for concurrent sessions, then closed after a short idle grace period. SIGINT/SIGTERM/SIGHUP cleanup is supported; an independent heartbeat watchdog also removes labelled worker containers and temporary files after an ungraceful bot process loss. A hard power/kernel failure or unavailable container daemon can still delay cleanup.

Install Docker or rootless Podman, `cloudflared`, and pull `python:3.12-alpine` plus `node:22-alpine`. Use `.nexora status` to verify. Anyone who receives a preview URL can access it; do not include secrets or private data. Quick Tunnels are for temporary development/testing, not production hosting. Full lifecycle, security, resource limits, and configuration details are in `docs/CODE_LAB.md`.
