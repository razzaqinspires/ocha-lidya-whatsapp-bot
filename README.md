# Ocha Lidya WhatsApp Bot

## NADI external operational-state component (v1.10.31)

Ocha Lidya and AC-Kernel NADI are now separate repositories. The bot keeps only the Node.js HTTP integration and a secure GitHub component loader; NADI's Python source is downloaded to an external cache (`~/.ocha/components/nadi/`) and is not bundled under the Ocha source tree. The connection uses Node's built-in `fetch` and a loopback HTTP sidecar. NADI owns its managed heartbeat; the bot reads operational telemetry and adds it to the existing Nexora prompt without creating a second LLM provider chain or duplicating API-key handling.

The external NADI loader is preconfigured for `https://github.com/razzaqinspires/artificial-consciousness-component` and immutable commit `16c2fa6e1b500745f260bcf091284a6e18726883` (AC-Kernel NADI 2.1.0). On first launch it downloads and validates the repository archive into `~/.ocha/components/nadi/`, outside this repository, then launches the Python sidecar over loopback HTTP. Optional `OCHA_NADI_SHA256` pins the archive checksum. Upgrade only by reviewing and pinning a new immutable commit. See `docs/NADI_RUNTIME.md` for details. The public live telemetry page is available through `.kernel`; see `docs/KERNEL_DASHBOARD.md` for the URL lifecycle, privacy boundary, and metric definitions.

## Adaptive conversation intelligence, stateful games, and feature-request workflow (v1.10.28)

Ocha now resolves short confirmations such as `buat aja` against the immediately preceding private conversation context. If the owner asks to play a game that is not installed, Ocha responds conversationally with a practical development offer; after owner confirmation in a private DM, the request is recorded as an encrypted `feature.requested` event in that owner's User Vault. It does not write source code, install plugins, or claim a capability is active. The owner-only `.features list|all|show <id>|progress <id>|complete <id>|cancel <id>|reopen <id>` command reviews and tracks the private development backlog.

AI interactive UI is now opt-in at the message level: natural-language AI responses remain plain text unless the current user message explicitly requests buttons, a list, copy action, or URL CTA. The response parser independently verifies that request and continues to reject command-like follow-up actions, unsafe URLs, and copy codes not shown in the response. See `docs/ADAPTIVE_CONVERSATION_INTELLIGENCE.md`.

## Persistent Ocha identity, isolated roo memory, and expanded AI reasoning envelope (v1.10.25)

The AI prompt now receives the live plugin/capability registry, so it can explain only features that actually exist. Explicit natural-language requests such as `tolong jalankan perintah ping` are resolved against the active plugin registry and are executable only for plugins explicitly marked `aiCallable: true`. The current allowlist is `.ping`, `.about`, and `.profile`; all calls pass the same authentication, role, quota, anti-spam, cooldown, and chat-scope checks as direct commands. Owner/system/developer commands remain direct-command-only.

AI text is normalized to WhatsApp formatting before delivery (`*bold*`, `_italic_`, `~strikethrough~`, inline monospace, and triple-backtick code blocks). Long output is split with code-fence preservation, and provider-reported truncation can receive deadline-driven continuation attempts until the shared job deadline or a no-progress guard. New private-DM turns are archived in encrypted per-user `data/roo/<sha256-user-id>/` journals; an idempotent migration imports eligible legacy private history while excluding group conversations. The archive has no application event-count cap, while model context remains provider-bounded and retrieval selects relevant history rather than transmitting everything. The active in-memory conversation cache is only a performance layer; the encrypted per-user archive remains the durable source of record. Explicit facts are stored in the same user's encrypted vault (no application fact-count ceiling; one memory note is bounded to 16,000 characters for storage safety). Ocha uses a persistent operational identity kernel, verified-owner relationship style, and independent per-user privacy partitions; this is not a consciousness claim. The bot rejects unsupported games when no game engine is installed. Text remains the default response type; validated quick replies, lists, copy, and user-supplied URL actions are available, while image/video/carousel delivery requires a registered backend media capability. New customer-support commands include `.sewa masukan`, `.sewa saran`, `.sewa keluhan`, and `.sewa konsultasi`; owner handles the queue with `.rentals support`, `.rentals reply`, and `.rentals close`. XP uses arbitrary-precision progression without a daily cap and awards repeatable progress only for unique meaningful contributions; dynamic Singularity rank tiers continue beyond level 1,000,000. See `docs/OCHA_IDENTITY_AND_PRIVATE_VAULT.md`, `docs/AI_ENGINE.md`, `docs/USER_PROFILES.md`, and `docs/RENTAL_USER_GUIDE.md`.

## Adaptive full-button command engine (v1.10.21)

Owner-only `.buttons full all` enables adaptive buttons for all eligible commands and aliases. The engine chooses Quick Reply, Single Select, or text per response; explicit feature UIs and session-driven screens remain exempt. Run `.buttons full audit` before enabling in a live group. See `docs/COMMAND_BUTTON_ENGINE.md`.

## Global command governance and AI command authoring (v1.10.17)

Global menu preferences are owner-controlled with `.setmenu descriptions on|off`, `.setmenu pages on|off`, `.setmenu limit <10-200>`, and `.setmenu status`. All users see the same menu. Pagination is off by default; when enabled, users reply to the menu message with a page number. Adaptive command cooldown and anti-spam are independent global controls: `.guard cooldown on|off`, `.guard antispam on|off`, and `.guard status`. Cooldowns are calculated per sender/chat/command from workload metadata; anti-spam uses an initial notice, five counted daily strikes, and escalating temporary suspensions. `.createcmd <instruction>` uses the configured AI provider chain and active plugin inventory to draft a plugin in an existing plugin folder. Reply to code or use `.createcmd => <source>` to wrap existing code without rewriting it. Review with `.createcmd show <id>` and install with `.createcmd apply <id>`.

## Live command directory and expanded profiles (v1.10.16)

`.menu` reads the active plugin registry instead of a hard-coded command list. It lists every loaded canonical plugin command, displays optional argument usage, follows the configured prefix, and includes a branded banner from `assets/menu-banner.jpg`. Owner commands such as `.test` and `.apikey` are included automatically. `.profile` now displays current/best daily streaks, daily XP remaining, achievements, aggregate interaction statistics, level progression, and an upgraded branded card. Streaks use Asia/Jakarta calendar days. See `docs/MENU_AND_COMMAND_REGISTRY.md` and `docs/USER_PROFILES.md`.

## Owner group management and in-group mute activation (v1.10.15)

Owner-only `.joingc <https://chat.whatsapp.com/INVITE_CODE>` joins a WhatsApp group using strict official invite URL validation. Every group starts MUTE. The verified owner activates a specific group by sending `.mute off` inside that group, and mutes it again with `.mute on`. Non-owner `.mute` messages are silently ignored. Private owner chat supports `.mute on all` as an emergency global mute; bulk activation is disabled. `.groupinfo` lists automatically detected participating groups and their active/mute state. Group membership and mute state do not disable metadata or contact synchronization. See `docs/GROUP_MUTE_AND_MESSAGE_FLOW.md`.

## Autonomous runtime, transactional hot reload, and persistent per-user Website Builder (v1.10.13)

Nexora now stores each user's website source in a private, durable repository namespace independent from temporary Code Lab previews. Each repository retains project memory (summary, architecture, features, decisions, next steps), task history, file hashes, version snapshots, and local Git history when Git is available. Follow-up requests update only changed files and preserve the rest of the repository. `.project list/status/use/history/memory/storage/zip` manages the user's own projects. ZIP delivery defaults to `ask`; `.project export always` sends an archive after every successful update, while `off` disables automatic delivery but leaves manual export available. ZIPs include only one selected repository—never the full library root—and Project Library operations are private-chat-only. See `docs/PROJECT_LIBRARY.md` and `docs/NEXORA_WEBSITE_BUILDER.md`.

## Runtime and owner-security hardening (v1.10.3)

The Nexora host preflight now defaults to `containerRuntime: 'auto'`: it validates an existing Docker daemon, starts Docker through the service manager that is actually PID 1, uses a single locked manual `dockerd` only when running as root without an init manager, and falls back to daemonless Podman. Root processes execute administrative commands directly; `sudo` is not required for UID 0. Non-root startup never opens an interactive privilege prompt. If the host kernel/container policy blocks all available engines, Code Lab remains fail-closed while WhatsApp and AI continue normally.

Owner verification is recalculated by the backend for each message using Baileys PN metadata or a previously verified owner-only LID→PN mapping. Chat claims, display names, conversation history, and stale `isOwner` flags are not authorization. Configuration inspection is handled locally and only in the verified owner's private chat; non-secret settings are shown while API keys, tokens, passwords, WhatsApp sessions, and private keys remain redacted and are never sent to the LLM. See `docs/OWNER_SECURITY.md`.

## AI response performance and resource envelope (v1.10.25)

Schema v34 ships with a 100 ms coalescing window, 96 recent history turns, a 96,000-character user-input ceiling, a 32,768-token requested output budget, a 60-second per-provider timeout, and a 180-second shared job deadline. Provider truncation can trigger continuation attempts until the shared deadline or no-progress guard. Reply threads keep their parent lineage; memory and historical excerpts are relevance-ranked and adapt to the configured prompt budget. These are application defaults, not a claim that upstream providers have unlimited context or output. Use `.aiset speed boost`, `.aiset speed fast`, `.aiset speed balanced`, or `.aiset speed deep` to select supported profiles. Provider telemetry and non-critical journal writes remain off the response-critical path. See `docs/AI_ENGINE.md` for trade-offs and `docs/OCHA_IDENTITY_AND_PRIVATE_VAULT.md` for long-term archive design.

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
# Isi provider API key / GITHUB_PAT sesuai fitur yang akan dipakai.
npm start
```

`npm start` menjalankan `prestart` otomatis. Dependency Node yang hilang akan dipasang, lalu host preflight mengurus Bash (jika bisa dipasang dengan hak non-interaktif), Git, Python 3, Go, Cloudflared, dan runtime container pada Linux yang didukung. Tidak diperlukan `npm install`, `npm run git:setup`, atau `git config` untuk menjalankan bot dan fitur inti. GitHub auto-push tetap opsional: diperlukan clone/remote yang sesuai serta `GITHUB_PAT`; ZIP source tidak akan diam-diam menginisialisasi atau mendorong kode ke repository pihak lain. Node.js dan npm sendiri adalah prasyarat untuk dapat menjalankan `npm start` dan harus tersedia sebelum langkah ini.

`npm install` hanya memasang dependency Node.js; perintah itu tidak menyalakan NADI. NADI dijalankan otomatis saat `npm start` memulai Ocha: loader mengunduh source AC-Kernel pada commit GitHub yang dipatok ke cache eksternal `~/.ocha/components/nadi/`, lalu mencoba menjalankannya sebagai sidecar Python. Python 3.10+ harus tersedia. Bila NADI gagal dimulai atau Python tidak tersedia, proses WhatsApp dan AI Ocha tetap berjalan; status NADI akan tercatat offline dan dapat diperiksa melalui `.nadi status`.

`npm start` first checks and installs missing declared Node dependencies. On Linux, after loading saved configuration, startup runs the Nexora host manager with the `auto` runtime preference by default. It detects the actual init system, avoids `sudo` when already root, attempts a locked manual Docker daemon only on a root host without a service manager, and tries Podman if Docker cannot start. It also validates/pulls the Python and Node images and verifies `cloudflared`. If host capabilities do not permit any container engine, the bot stays online and Code Lab execution is reported unavailable rather than pretending it is ready. See `docs/CODE_LAB.md` and `docs/OWNER_SECURITY.md`.

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
- Python 3.10+ for the external NADI component only (optional for the main WhatsApp bot).
- A dedicated WhatsApp account for the bot.
- Writable persistent storage for `data/` and `sessions/`.
- Node.js 20.18+ and npm run the main bot; Python 3.10+ runs the separately downloaded NADI sidecar. If NADI or Python is unavailable, the WhatsApp bot remains available without NADI.
- On supported Linux systems, `npm start` automatically checks/provisions Bash, Git, Python 3, Go, Docker/Podman, runtime images, and Cloudflared when a supported package manager and required non-interactive privileges are available.
- A host that blocks container namespaces, cgroups, netlink, or storage drivers cannot be made container-capable by application code. Code Lab reports that exact host limitation and keeps Python/Node container execution fail-closed; WhatsApp and AI continue.

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

Do not put bot name, owner number, prefixes, bot mode, feature flags, database paths, archive limits, execution switches, or runtime limits in `.env`. Those are managed through `src/config.js` and persisted in the JSONL database. WhatsApp login mode, pairing number, session folder, and connection timeouts are non-secret application settings persisted in the JSONL configuration database. GitHub/provider API keys, an externally supplied `OCHA_ROO_MASTER_KEY`, and an `OCHA_NADI_API_TOKEN` for a deliberately remote NADI service are secrets. Keep them in the private `.env` or deployment secret manager. The User Vault master key is optional: leave it empty and the application generates a protected local key file on first vault use. YouTube executable paths and limits are non-secret application settings stored under `youtube` in the JSONL configuration database; manage them with the owner-only `.ytconfig` command. Public identity fields (`bot.ownerName`, `bot.creatorName`, `bot.organization`, and `bot.publicCreatorDisclosure`) are non-secret application configuration; the AI prompt receives only this explicit allowlist, never the raw config object or secret vault.

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
| `ui.buttonsEnabled` | `true` | Legacy state mirrored by `.buttons on/off`; the adaptive adapter reads `ui.fullButton.enabled` |
| `ui.fullButton.enabled` | `false` | Opt-in adaptive command UI; owner enables it with `.buttons full all` |
| `groupMetadata.initialSync` | `true` | Perform a single initial batch load of participating group metadata |
| `groupMetadata.fetchCooldownMs` | 600,000 ms | Cooldown for a one-time lazy fetch of a group missing from cache |
| `ai.timeoutMs` | 60,000 ms | Per-provider request timeout in the standard profile; speed profiles may override it |
| `ai.totalBudgetMs` | 180,000 ms | Shared absolute budget for one AI job, including output continuation |
| `ai.maxOutputTokens` | 32,768 | Requested output budget; upstream model ceilings still apply |
| `ai.historyMessages` | 96 | Recent turns supplied to the model; long-term archive remains searchable |
| `ai.maxInputChars` | 96,000 | Application input envelope; provider context limits still apply |
| `ai.coalesceMs` | 100 ms | Merge rapid adjacent messages from one sender into a single AI turn |
| `prefix.mode` | `multi` | `single`, `multi`, or `none` |
| `prefix.single` | `.` | Single prefix |
| `prefix.list` | `. ! / #` | Multi-prefix list |
| `security.masterEvalEnabled` | `false` | JavaScript evaluator switch |
| `security.masterCliEnabled` | `false` | CLI shell (`$`) switch; independent of other runners |
| `security.masterPythonEnabled` | `false` | Python runner (`>>`) switch |
| `security.masterGolangEnabled` | `false` | Go runner (`>>>`) switch |
| `features.groupsMuted` | `true` | Global default for group command/AI mute; metadata/contact ingestion stays active |
| `features.groupMuteOverrides` | `{}` | Per-group interaction state keyed by WhatsApp Group JID |
| `features.lastJoinedGroupId` | `''` | Retained compatibility field; no longer used to guess a target for `.mute` |
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
| `.about` | `.botinfo` | Bot identity, creator, and organization information |
| `.profile` | `.me`, `.level`, `.xp` | Personal XP, level, rank, relationship role, and progress card |
| `.runtime` | `.system`, `.sysinfo` | Node runtime, memory, host and process details |
| `.kernel` | `.kernelstatus`, `.nadiweb` | Public read-only WebView for live AC-Kernel NADI circuits, WhatsApp activity, total bot outputs, AI response totals, latency, and mathematical telemetry |
| `.groupinfo` | `.gcinfo`, `.grouplist` | Owner-only private group list with active/mute statuses; in groups, show that group's cached metadata |
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
| `.aistatus` | `.aihealth` | Show AI provider readiness, creator identity policy, relationship profiles, key rotation, counters, timeout, and speed profile |
| `.nexora status` | `.capability`, `.aitools` | Show Nexora capability switches, Code Lab status, queue, workers, and tunnel |
| `.nexora code on/off` | — | Enable or disable the isolated Code Lab service |
| `.nexora auto-run on/off` | — | Enable or disable natural-language code execution |
| `.nexora tunnel on/off` | — | Enable or disable temporary public TryCloudflare links |
| `.nexora all on/off` | — | Turn all Nexora AI and Code Lab capabilities on/off globally |
| `.nexora workers 1-4` | — | Set simultaneous worker count (not session count) |
| `.nexora runtime docker/podman` | — | Select the container runtime |
| `.aiset on/off` | `.aiconfig` | Enable or disable AI |
| `.aiset speed boost/fast/balanced/deep` | — | Switch between low-latency, balanced, and extended reasoning profiles |
| `.aiset order <providers>` | — | Set provider fallback order |
| `.aiset model <provider> <model>` | — | Override one provider's model ID |
| `.aiset identity on/off` | — | Control public disclosure of creator and organization identity |
| `.buttons full all/off/status/audit` | `.button`, `.fullbutton`, `.commandbutton` | Owner control for the adaptive UI engine and per-command audit |
| `.master status` | `.masterconfig` | Show master runner switches |
| `.master eval on/off` | — | Enable/disable JavaScript evaluation |
| `.master cli on/off` | — | Enable/disable shell CLI directly; no global `exec` prerequisite |
| `.master python on/off` | — | Enable/disable Python runner |
| `.master golang on/off` | — | Enable/disable Go runner |
| `.joingc <url>` | `.joingroup` | Owner-only private command; joins a group using an official WhatsApp invite link and starts it muted |
| `.mute on/off/status` | `.groupmute` | Owner-only in-group control for the current group; private `.mute on all` is an emergency global mute |
| `.test <type> <options>` | `.testmsg`, `.messagetest` | Owner-only Baileys message lab: native-flow, hydrated template, event/date, poll, PTV, view-once, AI rich, and carousel |
| `.yts <query>` | `.ytsearch` | YouTube thumbnail carousel; each result offers MP3 and all detected MP4 resolutions |
| `.ytmp3 <url>` | — | Download audio as MP3 |
| `.ytmp4 <url> [resolution]` | — | Show available MP4 resolutions, or download a selected quality |
| `.ytm <song title>` | `.ytmusic`, `.ytplay` | Search and send audio only using an isolated temporary job directory |

All owner plugins use `ownerOnly: true`. The private group inventory from `.groupinfo` is limited to the verified owner; users in a group can still inspect that current group's cached metadata. `.joingc` is private-chat-only and accepts only a direct HTTPS invitation link hosted at `chat.whatsapp.com`; it verifies invite metadata when the Baileys socket supports it before joining. Newly joined groups start muted. To activate a group, the verified owner must send `.mute off` inside that group; `.mute on` mutes it again. Non-owner mute messages are silently ignored. Private owner chat supports `.mute on all` as an emergency mute; `.mute off all` and bulk activation are disabled. `.groupinfo` lists the local participating-group inventory, refreshed on connection startup and throttled to one full sync per five minutes.

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

All developer runners are disabled by default. Each runner is independent: `.master eval on` enables `>`/`=>`, `.master cli on` immediately enables `$`, `.master python on` enables `>>`, and `.master golang on` enables `>>>`. `.master exec on/off` remains only as a temporary legacy alias for `.master cli on/off`; it is not a separate global gate. Group interaction is muted by default. After `.joingc <url>`, the owner must send `.mute off` inside the target group; `.mute on` there mutes it again. Non-owner mute commands are ignored. `.mute on all` in private owner chat is an emergency mute; bulk activation is disabled. Group settings are persistent database settings, not environment variables.

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
- `npm start` — start the bot, run the dependency preflight, and start the automatic Git watcher together.

See [`docs/AUTO_GIT_SYNC.md`](docs/AUTO_GIT_SYNC.md) for behavior, failure handling, and security details.

## 16. Source hot reload

The transactional source watcher monitors regular files throughout `src/` and `scripts/`, plus dependency manifests. A stable batch of JavaScript plugin modules is imported into a shadow registry and swapped atomically without restarting WhatsApp. Core modules, plugin assets/manifests, scripts, and dependency changes trigger one controlled restart per completed folder-copy batch. The watcher validates JavaScript, shell, and JSON syntax, rejects invalid batches, pauses Auto Git Sync during writes, and waits for file revisions to stabilize before applying. Runtime directories such as `sessions/`, `data/`, and `logs/` are excluded.

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

Current package version: **1.10.21** (configuration schema v28).

See [`docs/CHANGE_LOG.md`](docs/CHANGE_LOG.md) for release history and [`docs/DATABASE_DESIGN.md`](docs/DATABASE_DESIGN.md) for persistence internals.


## 19. Multi-provider AI assistant

AI only responds to non-command messages. In private chats, normal text can invoke AI. In groups, the bot responds **only** when the message explicitly mentions the bot's actual WhatsApp JID or replies to a message authored by the bot. Other group messages are ignored. Unknown prefixed commands never fall through to AI.

Provider fallback order by default: Groq → Gemini → DeepSeek → OpenAI. Free-only mode is enabled by default: Groq `openai/gpt-oss-120b` is preferred first, then Gemini `gemini-3.8-flash`; DeepSeek and OpenAI are skipped unless the owner explicitly enables paid routing. Providers without API keys or eligible models are skipped. Multiple environment keys can be separated by commas, semicolons, or newlines. Owner-managed keys can also be added with `.apikey add`; they are stored in a restricted local vault. See `docs/AI_ENGINE.md`.

```dotenv
GEMINI_API_KEY=key_one,key_two
GROQ_API_KEY=key_one;key_two
DEEPSEEK_API_KEY=
OPENAI_API_KEY=
```

The engine warms a bounded in-memory history cache once at startup, rotates sibling keys for key-specific authentication failures, and immediately advances to the next provider for account quota/rate-limit, billing, network, timeout, server, or model/request failures. It records per-key hits and response classifications, coalesces messages arriving within the configured 100 ms default from the same sender, and falls back across providers. If all keys are unavailable, AI enters silent maintenance and privately reports the inventory to the owner. Public model identity: Nexora-2.0-Flash. Delivery recovery is at-least-once if the process crashes during WhatsApp send. AI conversation turns are isolated by chat and sender.

Owner commands: `.aistatus`, `.aiset on`, `.aiset off`, `.aiset speed boost`, `.aiset speed fast`, `.aiset speed balanced`, `.aiset speed deep`, `.aiset order groq,gemini,deepseek,openai`, `.aiset model <provider> <model>`, `.buttons full all`, `.buttons full audit`, `.buttons full off`, and `.buttons status`. Adaptive command buttons are opt-in; existing custom plugin interfaces remain independent of this switch.

See [docs/AI_ENGINE.md](docs/AI_ENGINE.md) for provider model defaults, API details, recovery semantics, and operational guidance. Free tiers are not unlimited and depend on provider account, region, and quota; OpenAI and DeepSeek API usage should be treated as paid unless the account explicitly shows credits.


## 20. Permanent contacts, group metadata cache, and interactive commands

At startup Ocha Lidya creates `data/contact.jsonl` and `data/group-metadata.jsonl` if they do not exist. `contact.jsonl` stores one JSON object per line (JSONL), with the exact fields `{"number":"628...","name":"","gender":""}`. The file is a JSONL stream, not one bracketed JSON array. Only an explicit PN JID or a PN returned by Baileys' verified LID mapping is accepted. A number is stored without `@s.whatsapp.net`; duplicates are skipped both on startup and during append. Existing duplicate/invalid rows are compacted once, with the original file copied into `data/quarantine/` first.

The first connection performs one `groupFetchAllParticipating()` batch and persists the returned metadata. A `group.bootstrap.complete` marker prevents repeat full refreshes after a successful bootstrap. Thereafter `groups.upsert`, `groups.update`, and `group-participants.update` events update the local cache. A cached group does not trigger `groupMetadata()` network requests when `.groupinfo` is used. A group missing from cache may receive one lazy fetch, protected by an in-flight guard and configurable cooldown. Member additions/modifications add newly verified PN numbers to the permanent contacts file; member removals update only the group metadata log. When the bot itself is removed/leaves, that group's metadata cache entry is deleted, but contacts are never deleted.

`.groupinfo` in a private chat is available only to the verified owner and lists groups already in the metadata cache with active/mute status. Reply to the exact list message with `1`-`10` to open a group; `0` advances a page and `00` returns to the previous page. Reply `0` to a detail view to return to the list. `.groupinfo` inside a group shows that group's cache. It does not force repeated metadata requests. See [`docs/CONTACTS_AND_GROUP_CACHE.md`](docs/CONTACTS_AND_GROUP_CACHE.md) for event semantics, file formats, PN/LID resolution order, and recovery behavior.

Command responses remain text-first by default. The owner can opt into the adaptive full-button engine with `.buttons full all`, inspect its per-command decisions using `.buttons full audit`, and manage exceptions using `.buttons full exclude add/remove <command|alias>`. The engine inherits a plugin's policy for every alias, chooses Quick Reply for 1–3 safe actions and Single Select for 4–8, and keeps long/code/progress/diagnostic replies in text. Commands that already own a carousel, Native Flow, image/contact card, checkout, menu pagination, or reply-session are excluded. The adapter is scoped to one plugin execution and restores the serializer reply function after completion. Taps re-enter the normal dispatcher and do not bypass authorization. See [`docs/COMMAND_BUTTON_ENGINE.md`](docs/COMMAND_BUTTON_ENGINE.md). A successful relay/ACK still does not guarantee identical Native Flow rendering on every WhatsApp client.


## 21. Ocha Master Console, group mute, and message-flow telemetry

Master runners are independent in schema v11. `$` is controlled directly by `.master cli on/off`; JavaScript eval (`>` and `=>`), Python (`>>`), and Go (`>>>`) each have their own independent switches. There is no longer a global `exec` gate. `.master exec on/off` is only a temporary compatibility alias for `.master cli on/off`; use `cli` in new commands and documentation. `.master status` displays the owner-only console control panel. See [`docs/MASTER_CONSOLE.md`](docs/MASTER_CONSOLE.md).

Group interaction defaults to mute through `features.groupsMuted: true`, with per-group overrides in `features.groupMuteOverrides`. `.joingc <url>` is owner-only and joins a WhatsApp group from a direct official invite link; the new group starts muted. The verified owner enables a group by sending `.mute off` inside that group. `.mute on` in that group mutes it again. Non-owner `.mute` commands are silently ignored. `.mute on all` is an emergency global mute; bulk activation with `.mute off all` is intentionally disabled. `.groupinfo` displays all cached groups with their active/mute state. Group metadata and verified contact indexing remain active while interactions are muted. See [`docs/GROUP_MUTE_AND_MESSAGE_FLOW.md`](docs/GROUP_MUTE_AND_MESSAGE_FLOW.md).

The message-flow monitor labels private/group destinations and consumes Baileys `messages.update` and `message-receipt.update` events. Its local terminal legend is `✓ SENT`, `✓✓ DELIVERED`, `✓✓ READ`, `✓✓ PLAYED`, and a separately colored `BOT REPLIED` marker. It does not modify WhatsApp's own tick UI or create a third WhatsApp checkmark. The monitor stores only bounded metadata, not message bodies.


### Master Console: full eval context and workload guard (v1.7.2)

JavaScript eval (`>` and `=>`) now receives live `sock`, serialized `m`/`message`, `config`, `logger`, `db`, `fs`, `path`, `os`, `crypto`, `childProcess`, `process`, `Buffer`, `require`, and `importModule` references. These are real host capabilities, not mocks. This is intentionally owner-only and is not a security sandbox: eval can affect the running bot and host account.

All master runtimes (`$`, `>`, `=>`, `>>`, `>>>`) pass through WorkloadTracker. Low-risk commands continue immediately. Suspicious operations are sent to Ocha's small workload-assessment request, then Ocha may auto-approve only an explicit `ALLOW` with low/medium severity. Otherwise the owner receives a quoted warning with impact, safer alternative, and a one-time `CONFIRM CODE` / `CANCEL` reply session (120-second expiry). If AI assessment is unavailable, the command fails closed. Static critical host-wide patterns (for example deleting the filesystem root, disk formatting/wiping, fork bombs, and host shutdown) are blocked without a chat override. Scoped destructive actions such as `rm -rf ./*/` require AI review and explicit owner confirmation.

The AI review is an advisory impact estimate, not a proof of safety. The confirmation mechanism reduces accidental execution but does not make arbitrary code safe. Run master commands only on a controlled host and keep backups.



## 22. Nexora Code Lab: isolated execution and temporary preview

Users can ask Ocha to run the most recent assistant code block by saying `coba jalankan` or `buat preview hasilnya`, including by replying directly to the AI message containing code. Quoted message text is checked first; truncated quoted code is completed by the AI before execution and is never run while incomplete. The AI capability manager routes explicit execution intent to Code Lab. `.run` provides a direct command path. Python 3.12 and Node.js 22 execute in per-session containers; HTML/CSS/JavaScript is displayed in a sandboxed iframe. Python/Node execution is network-isolated and limited to standard libraries, 128 MiB memory, 0.5 CPU, 64 PIDs, 48 KiB combined captured output, and 120 seconds runtime by default.

Each session receives an unguessable path on a temporary `trycloudflare.com` Quick Tunnel. Session paths are independently revoked after 60 minutes, with automatic container and workspace cleanup. One shared Quick Tunnel is created only on the first preview request and reused across concurrent users/sessions, then closed after a configurable five-minute idle grace period after the last session disappears. Startup does not launch a long-running cloudflared process; a cross-process lease and serialized lifecycle prevent duplicate tunnel children. SIGINT/SIGTERM/SIGHUP cleanup is supported; an independent heartbeat watchdog also removes labelled worker containers and temporary files after an ungraceful bot process loss. A hard power/kernel failure or unavailable container daemon can still delay cleanup.

The automatic host manager prepares Docker or Podman and the required Python/Node images where the VPS permits it. On a systemd host, the manager starts Docker directly as root; it does not call `sudo` when UID is 0. On non-systemd hosts it tries a lock-protected manual `dockerd` when root, then daemonless Podman. If both engines are blocked by the hosting container/kernel, the provider must enable container support or expose a supported runtime; do not force `--privileged` or weaken socket permissions. Use `.nexora status` to verify. Anyone who receives a preview URL can access it; do not include secrets or private data. Quick Tunnels are for temporary development/testing, not production hosting. Full lifecycle, security, resource limits, and configuration details are in `docs/CODE_LAB.md`.

## Nexora Website Builder

Users can ask Ocha to create and iteratively improve static websites in natural language. Source projects persist in a per-user Project Library across bot restarts; temporary preview sessions remain separate and may expire. Website projects do not start a process, tunnel, or container per user. The Builder uses bounded global/per-user queues, project task memory, local Git commits where available, retained version snapshots, and incremental file updates. `.project export ask` is the default; `.project export always` enables automatic ZIP delivery after every successful update; `.project export off` disables automatic delivery while preserving manual exports. ZIPs contain only the selected repository and are never built from the `/root` or library parent directory. Project commands and private source operations are restricted to direct chats. The builder currently supports static frontend prototypes, not production backend services or permanent hosting. Owner controls: `.nexora builder on/off` and `.nexora builder-workers 1-4`. See `docs/PROJECT_LIBRARY.md` and `docs/NEXORA_WEBSITE_BUILDER.md`.


## AI provider routing and autonomous model discovery (v1.10.11)

Ocha uses an ordered provider chain (Groq → Gemini → DeepSeek → OpenAI by default). Provider-wide network failures, model/request errors, billing balance errors, and quota/rate-limit responses stop same-provider key fan-out and advance to the next provider; authentication errors remain key-specific and can rotate to another key. The owner can inspect the exact provider state with `.aistatus`.

The model catalogue queries the official authenticated model-list API of each provider every 24 hours, intersects visible model IDs with an officially documented free-tier allowlist, and stores current and historical recommendations in `data/ai-model-catalog.json`. It does not save raw API keys or call inference during catalog refresh. Default `free-only` mode routes only to verified free-tier candidates (Groq and Gemini); DeepSeek and OpenAI remain excluded unless the owner uses `.aiset free-only off`.

The scheduler is started automatically by `src/index.js` during `npm start`; no systemd, cron, installer, or extra terminal command is required. Startup launches both an in-process scheduler and a singleton detached Node.js worker. The detached worker survives closing the terminal or stopping the main WhatsApp process while the VPS remains powered on; its heartbeat and PID are recorded in `data/ai-model-catalog-worker.json`, and its log is written to `data/logs/ai-model-catalog-worker.log`. It performs an immediate metadata-only refresh when the catalogue is missing or overdue, then schedules the next refresh from the persisted 24-hour deadline. Transient provider catalogue outages are retried hourly. Adding or removing an API key through `.apikey` triggers an immediate catalogue refresh and the detached worker reloads the key vault on its next refresh. If the VPS itself shuts down, no local process can run; the next `npm start` automatically re-creates the worker and catches up from the saved timestamp. `.aimodels status` and `.aistatus` report the detached worker status and PID.

Owner controls: `.aimodels status`, `.aimodels refresh`, `.aiset free-only on/off`, `.aiset order groq,gemini,deepseek,openai`, `.apikey list groq`. The catalogue can prove that a key may list model IDs; only a real inference request can prove that the model can answer and that quota remains. New models are not automatically labelled free unless their free access is verified in official pricing documentation. See [`docs/AI_ENGINE.md`](docs/AI_ENGINE.md) and [`docs/AI_MODEL_CATALOG.md`](docs/AI_MODEL_CATALOG.md).

## Live command directory and user profile

The `.menu` command is generated from the active plugin registry. It includes all loaded plugin commands (including owner-only tools such as `.test` and `.apikey`) and uses optional `usage` metadata to display arguments without lengthy descriptions. The menu banner is bundled at `assets/menu-banner.jpg`; if image delivery is unavailable, the command directory falls back to text.

`.profile` now includes rank/level progress, daily XP allowance, current and best activity streaks, aggregate interaction statistics, communication-style summary, and achievement milestones. Streak dates use the Asia/Jakarta calendar. Profile records keep aggregate statistics and bounded deduplication IDs only; raw conversation text is not added to profile storage.

See `docs/MENU_AND_COMMAND_REGISTRY.md` and `docs/USER_PROFILES.md` for plugin metadata and profile rules.

## v1.10.17 — Global Menu, Command Governor, AI Command Author

### Global menu settings

- `.setmenu descriptions on|off` controls command descriptions for every user.
- `.setmenu pages on|off` enables/disables global menu pagination.
- `.setmenu limit 10-200` sets the maximum number of entries per page.
- `.setmenu status` displays the shared settings.
- When pagination is enabled, reply to a menu message with a page number. The reply session is bound to the original sender and expires after 15 minutes.

### Adaptive command governance

- `.guard cooldown on|off` enables a command-specific cooldown computed from command metadata and workload signals. The key is isolated by sender, chat, and canonical command name.
- `.guard antispam on|off` enables burst/repeated-command detection independently of cooldown.
- `.guard status` displays global settings.
- Cooldown denial notices are rate-limited to one per remaining cooldown period.
- Anti-spam sends an initial warning before counting strikes. Five subsequent violations in the Asia/Jakarta day trigger a temporary suspension. Suspension duration escalates from 5 minutes to 15 minutes, 1 hour, 6 hours, and 24 hours. It is not a permanent ban. A live suspension blocks commands and AI replies; the daily warning counter resets at Jakarta midnight.
- Owner commands bypass user-facing cooldown and anti-spam enforcement so the owner can recover configuration.

### AI-assisted plugin authoring

- `.createcmd <instruction>` asks the configured AI provider chain to design a plugin against the current plugin inventory and existing plugin folders.
- Reply to source code with `.createcmd <instruction>` to ask Ocha to wrap/polish it. For source-only wrapping use `.createcmd => <source>`.
- Source-preservation mode requires the original snippet to remain byte-for-byte present in the generated plugin. The authoring prompt explicitly forbids syntax repair/rewrite.
- AI chooses among existing plugin directories only; new category folders are not created. Plugin metadata includes command name, aliases, category, usage, description, and owner/private policy.
- Generated source is not executed during drafting. It is statically policy-checked, reviewed by the Workload Assessor (local conservative analysis if AI review is unavailable), stored as a draft, and installed only after `.createcmd apply <draft-id>`.
- `.createcmd show <draft-id>` displays the full generated source for owner review. `.createcmd list` shows pending drafts. Supplied code must remain byte-for-byte present; syntax errors are reported, never silently repaired. Existing commands and aliases are never overwritten. The normal transactional source watcher discovers the installed plugin after the file is written and validated.
- Generated plugins may import only Node built-ins, Baileys, and approved internal `core`, `ai`, and `lib` modules. Dynamic process execution primitives and unsafe imports are rejected.

Configuration schema: v27. Existing installations migrate to menu descriptions OFF, pagination OFF, cooldown OFF, and anti-spam OFF. These controls are global, not per-user preferences.


## Rental subscriptions and private checkout (v1.10.19)

Ocha supports optional rental subscriptions for one WhatsApp group per tenant. The initial package settings are:

| Plan | Price / 30 days | Maximum members | Shared quota / rolling 24h |
|---|---:|---:|---:|
| Mini | Rp5.000 | 50 | 120 weighted units |
| Standard | Rp10.000 | 200 | 350 weighted units |
| Pro | Rp20.000 | 1,000 | 1,000 weighted units |

These are configurable starting values. All group members may use the bot features available to group participants while the subscription is active. Members share one tenant quota. The current workload weights are routine 1, AI/media 3, web/search/download/project 5, and code execution/build/deploy 12. Selected billing and status commands are quota-exempt. The 24-hour usage window is anchored to activation and reset by the rental scheduler.

**All checkout and payment steps run in the user's private chat with the bot.** In the target group, a WhatsApp admin sends `.sewa`. Ocha stores that group as the user's checkout context, sends instructions privately, and posts one short group acknowledgement (throttled for 45 seconds). No invoice, QRIS, bank/e-wallet details, payment report, or proof is processed in the group. The private context expires after 12 hours and can be changed by sending `.sewa` in another group. The bot rechecks WhatsApp admin status before creating an order or processing payment actions.

Customer private-chat commands:

- `.sewa` or `.sewa help` — package catalogue and checkout guide.
- `.sewa context` — selected group and context expiry.
- `.sewa plan <mini|standard|pro>` — create/reuse an invoice for the selected group.
- `.sewa pay <invoice> <qris|ovo|gopay|dana|seabank>` — select payment method and privately receive payment details.
- `.sewa paid <invoice>` — report that payment was made; manual verification is still required.
- Send a JPG/PNG/WEBP image up to 5 MB with caption `.sewa bukti <invoice> [note]` — attach payment evidence privately (up to three images per invoice).
- `.sewa status` — subscription state, group member count/cap, expiry and shared quota.
- `.sewa rating` / `.sewa testimoni` — verified review summary.
- `.sewa ulasan <1-5> [komentar]` — one honest review per approved invoice.
- `.sewa masukan|saran|keluhan|konsultasi <pesan>` — open a support ticket privately.
- `.sewa cancel <invoice>` — cancel a pending invoice.

Group admin toolbox (active rental required): `.gadmin info`, `.gadmin aturan`, `.gadmin aturan <text>`, `.gadmin aturan hapus`, `.gadmin welcome on [text]`, `.gadmin welcome off`, `.gadmin poll Question | Option 1 | Option 2`, and `.gadmin announce <text>`. All participants may read stored rules; only verified WhatsApp admins may change rules, welcome settings, polling, and announcements. Welcome messages trigger when a new member joins.

If a proof image is accidentally posted in a group with `.sewa bukti`, the bot refuses to use it and attempts to delete the group message. If it cannot delete the message, the sender is asked to remove it manually and resend it privately. Image proof never activates a subscription by itself.

Owner-only private commands:

- `.rentals status`, `.rentals plans`, `.rentals list`, `.rentals pending`, `.rentals show <invoice>`.
- `.rentals approve <invoice>` and `.rentals reject <invoice> [reason]`.
- `.rentals usage <group-jid>` and `.rentals audit [group-jid|invoice]`.
- `.rentals suspend <group-jid> [reason]`, `.rentals activate <group-jid> [days]`, `.rentals extend <group-jid> [days]`.
- `.rentals setprice <plan> <amount>`, `.rentals setquota <plan> <units>`, `.rentals setmembers <plan> <members>`.
- `.rentals support [open|answered|closed|all]`, `.rentals reply <ticket-id> <message>`, and `.rentals close <ticket-id> [note]` manage customer support tickets.

An invoice expires after 12 hours. The initial subscription term is 30 days, followed by a 48-hour grace period. During grace, ordinary bot interactions are paused but billing/renewal commands remain available. After grace, the tenant is suspended. Expiry reminders are delivered privately to the billing contact or verified group admins.

Payment uses static QRIS and configured e-wallet/bank instructions. Payment is manually verified by the owner against the actual merchant/bank settlement before `.rentals approve <invoice>`. QRIS is not dynamically bound to an invoice. Signed payment webhooks, automatic settlement reconciliation, automatic refunds, and a customer web dashboard are not delivered in this release.

See [`docs/RENTAL_USER_GUIDE.md`](docs/RENTAL_USER_GUIDE.md) for the full customer guide and [`docs/RENTAL_100_FEATURE_CATALOG.md`](docs/RENTAL_100_FEATURE_CATALOG.md) for implemented capabilities versus roadmap.

The internal native-flow registry supports lossless parameter forwarding for the registered sample button types. It distinguishes stable, observed and experimental payloads; it does not promise that all WhatsApp clients or business accounts render experimental commerce/call flows. The raw low-level `sock.relayMessage()` path is left untouched. `sendInteractive`/`sendNativeFlow` validate registered payloads and retain a text fallback. The owner-only `.test nativeflow all` sends five pages based on the current evaluation fixture; `.test identity` and `.test inspect` expose PN/LID and parsed-response diagnostics. Quick-reply and single-select test IDs route through `.test response ...`; URL, call, copy, and location controls may be handled entirely by the WhatsApp app and are not guaranteed to send a bot callback. See [`docs/NATIVE_FLOW_SERIALIZER.md`](docs/NATIVE_FLOW_SERIALIZER.md).

YouTube commands use `yt-dlp` plus FFmpeg/ffprobe installed on the host; these are system tools, not npm dependencies. `.ytconfig` lets the owner adjust their executable paths, maximum file size, maximum duration, and search count without editing `.env`. `.yts`, `.ytmp3`, `.ytmp4`, and audio-only `.ytm` are documented in [`docs/YOUTUBE_COMMANDS.md`](docs/YOUTUBE_COMMANDS.md). The executable path and media limits live in the non-secret `youtube` application configuration. Inspect or update them with `.ytconfig`; live retrieval still depends on YouTube availability and format changes.

See `docs/RENTAL_100_FEATURE_CATALOG.md` for the distinction between implemented capabilities and the roadmap. The catalog does not market dynamic QR, automatic refunds, payment webhooks or a customer web dashboard as delivered.

## Tic-Tac-Toe game

Private chat: `.ttt mulai [x|o]`, then send a position `1`–`9`, or use `.ttt status`, `.ttt menyerah`, and `.ttt ulang`. Natural invitations such as `main tictactoe yuk` are routed to the same persisted game session. Game state is stored in the player's encrypted User Vault; group play is not enabled.


## v1.10.29 — Master Console controls

Owner-only `.master warning` controls compact/detailed/off warning delivery, `.master review` toggles AI semantic assessment independently, and workload warnings use native-flow CTA Copy plus confirm/cancel actions. A private `sock.relayMessage(m.chat, ...)` or `sock.sendMessage(m.chat, ...)` operation is no longer blanket-flagged; arbitrary targets and group contexts remain reviewed.
