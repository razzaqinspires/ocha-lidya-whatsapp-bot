## [1.10.5] - 2026-11-21

### Added
- Added Nexora Project Library with persistent per-user website repositories, canonical PN-derived user namespaces, per-chat active repository selection, project memory, task history, file hashes, local Git commits, and bounded version snapshots.
- Separated permanent website source from temporary Code Lab preview sessions so previews can expire or be republished without deleting project source.
- Added incremental repository updates using changed-file manifests and explicit deletions; untouched files are preserved. Added static local-reference auditing for HTML assets, CSS URLs, and JavaScript imports before a project version is committed.
- Added `.project list/status/storage/use/history/memory/zip/export` commands and per-user ZIP preferences (`ask`, `always`, `off`).
- Added explicit repository-only ZIP exports with secret/symlink/path checks. ZIPs exclude the library parent, other users, `.git`, metadata, history, temporary files, runtime data, and credentials.
- Added user-private workspace quota accounting for repository source, Git data, and retained snapshots, plus serialized per-user write transactions.
- Restricted Project Library operations and ZIP delivery to private WhatsApp chats to prevent accidental source disclosure in groups.

### Fixed
- Metadata-only active-project lookup no longer loads full website source files into the AI request path.
- A manual ZIP request remains available even when automatic ZIP delivery is set to `off`.
- Failed project writes roll back the staged repository and do not prune prior history before the new version is committed.
- Queued same-user edits re-read the latest committed repository only after acquiring the build slot, preventing stale queued source from overwriting an earlier update. ZIP generation is serialized against repository writes.
- Project storage status measures the same source + Git + snapshot footprint used by quota enforcement.
- User-facing project status does not disclose the absolute host Project Library root.

### Validation
- Added unit/integration coverage for user isolation, incremental updates, project memory, version snapshots, local-reference auditing, export allowlisting, and private-chat restrictions.
- Final local suite: 117 passed, 2 skipped, 0 failed (119 total); syntax check: 115 JavaScript files.
- Live WhatsApp and public preview delivery still require deployment verification. Project Library is a logical private filesystem workspace, not a dedicated per-user Docker/Podman container.

## [1.10.3] - 2026-11-21

### Fixed
- Repaired schema migration ordering: schema v20 now runs after migrations v11–v19 rather than being nested inside the v11 block, so older installations no longer skip intermediate migrations.
- Changed host bootstrap to pass the configured `auto` runtime preference through to the host script. It now uses direct administrative commands when already root, checks the actual PID 1/init manager, starts Docker without `sudo` when appropriate, and falls back to daemonless Podman.
- Corrected manual `dockerd` PID/log file newline handling and retained the single-daemon lock. Bootstrap remains non-interactive for non-root users and does not weaken socket permissions or enable privileged containers.
- Persisted only Baileys-verified LID→PN mappings for the configured owner, so subsequent messages remain verifiable if alternate PN fields are omitted. Mappings are stored with restrictive file permissions.
- Centralized owner verification in the dispatcher and permission layer; stale `isOwner` flags, display names, and chat claims cannot authorize administrative commands.
- Added deterministic private-chat owner configuration inspection. Non-secret config is available to the verified owner; API keys, tokens, passwords, embedded database URL credentials, sessions, and private keys are redacted. Config snapshots are not sent to the LLM or persisted in AI history.

### Validation
- Syntax check: 111 JavaScript files checked.
- Offline test suite: 108 passed, 2 skipped, 0 failed (110 total).
- Added owner identity, LID mapping persistence, configuration intent, secret-redaction, bootstrap dry-run, root-without-sudo Podman fallback, Code Lab runtime fallback, and owner configuration-flow tests.
- Live Docker/Podman provisioning and real WhatsApp LID metadata still require validation on the target VPS; this environment cannot prove the host kernel permits nested containers.

## [1.10.1] - 2026-11-21

### Changed
- Changed the free Cloudflare Quick Tunnel from bot-startup/persistent operation to on-demand startup: the first public preview starts one shared tunnel and all concurrent users reuse that same process and hostname.
- Added serialized tunnel lifecycle operations and a cross-process exclusive lease with PID/start-time verification, token-bound cleanup, and orphan recovery. A replacement process is not started until the prior `cloudflared` process has closed and its lease has been reconciled.
- Removed unattended reconnect loops. An unexpected tunnel exit revokes preview sessions tied to the old hostname, applies bounded exponential backoff, and waits for a subsequent user preview request before starting a replacement.
- Added configurable idle shutdown (five minutes by default), request admission control at 160 concurrent requests to preserve headroom under Cloudflare Quick Tunnel's documented 200 in-flight limit, and richer tunnel status telemetry.
- Added parallel-start, cross-process lease, idle-shutdown, and forced-exit recovery tests. Bumped the package version and config schema to 1.10.1 / 19.

### Cloudflare limitations
- Quick Tunnels remain temporary development previews, not production hosting: no uptime guarantee, a random hostname on each creation, a 200 in-flight request limit, and no Server-Sent Events. Use a named Cloudflare Tunnel for stable production hostnames and multi-connector availability.

### Validation
- Syntax check: 107 JavaScript files checked.
- Offline test suite: 100 passed, 2 skipped, 0 failed (102 total).
- Tunnel lifecycle tests use a controlled local fake `cloudflared` executable. A live public Quick Tunnel and the target VPS networking/runtime still require deployment verification.

## [1.8.1] - 2026-11-20

- Added `.nexora all on/off` as a global owner-only master switch for AI chat, Code Lab, AI auto-run, and the shared public preview tunnel.
- Changed TryCloudflare lifecycle to one persistent Quick Tunnel per Ocha process; removed idle tunnel shutdown and added bounded reconnect supervision.
- Added startup preflight for `cloudflared`, Docker/Podman daemon health, and pre-pulled Python/Node runtime images.
- Reduced the default worker pool from three to two and capped configurable concurrency at four to make memory use more predictable.
- Clarified worker concurrency separately from total live preview sessions; direct `.run` remains available when AI auto-run is disabled.
- Deleted Python/Node source workspaces immediately after execution completes and started the host-side timeout after the runtime process is spawned.
- Updated Nexora status output and operational documentation to describe global controls, one shared tunnel, and headless bounded execution.

## [1.9.1] - 2026-11-20

### Fixed
- Code execution now reads `m.quoted.text` first, so replying directly to an AI message containing code is sufficient; it no longer depends on a persisted AI reply-chain anchor to recover the quoted source.
- Added parsing for incomplete fenced code blocks. If an AI answer was cut off by its output-token limit, Nexora asks the configured provider to complete the quoted code before passing it to the isolated worker; incomplete repair output is never executed.
- Added task-aware output budgets for code-generation requests (up to 4,096 output tokens and a bounded 45-second fallback budget) while ordinary chat keeps its low-latency budget.
- Provider request timeout now honors per-job coding/repair budgets instead of always using the short general-chat timeout.
- Docker/Podman prerequisite diagnostics now distinguish a missing/inactive daemon socket from missing runtime images and provide the correct recovery command.

### Validation
- Added regression tests for quoted-message priority, truncated quoted code completion, code-generation intent classification, and code-block parsing.
- Offline test suite and syntax checks run for this release; live WhatsApp quote serialization and Docker daemon operation still require verification on the VPS.

# Changelog

## [1.8.0] - 2026-11-20

### Added
- Added Nexora capability registry and owner controls for Code Lab, natural-language auto-run, public tunnel, worker concurrency, and Docker/Podman selection.
- Added isolated Python 3.12 and Node.js 22 execution workers plus sandboxed HTML/CSS/JavaScript browser previews.
- Added a shared free TryCloudflare Quick Tunnel with unique per-session 256-bit URL tokens, one-hour maximum session TTL, per-user quotas, FIFO worker scheduling, and rate limits.
- Added a loopback-only preview gateway, interactive stdin, bounded output, container resource limits, network isolation, and a detached orphan watchdog for abnormal process termination.
- Added `.run` / `.execute` / `.previewcode` and natural-language `coba jalankan` routing to the latest assistant code block.
- Added `docs/CODE_LAB.md` and schema v15 migration for Code Lab configuration.

### Safety and lifecycle
- Python/Node workers run without network access, with non-root UID, read-only root filesystem, read-only source mount, dropped capabilities, no-new-privileges, bounded memory/CPU/PIDs/tmpfs, and two-minute default execution limit.
- Session expiry revokes the per-session URL path, stops/removes workers, and deletes source workspace. The shared Quick Tunnel closes after a two-minute no-session grace period.
- Graceful shutdown handles SIGINT/SIGTERM/SIGHUP. A detached watchdog performs best-effort container/tunnel/workspace cleanup after an ungraceful bot process exit.

### Validation
- Syntax check: 89 JavaScript files checked.
- Offline suite: 71 passed, 2 skipped, 0 failed.
- Local smoke tests used mock Quick Tunnel and mock container runtime to verify concurrent session quota reservation, preview HTTP response, token rejection, interactive stdin, and gateway shutdown. Docker/Podman and real Cloudflare Quick Tunnel were not available in the build environment; live VPS/WhatsApp validation remains required.

## [1.7.3] - 2026-11-20

### Fixed
- Excluded `sessions/`, quarantined session backups, `data/`, `logs/`, and other runtime/cache/build directories from repository-wide Chokidar traversal. This prevents one watcher per Baileys auth file and addresses the observed `ENOSPC: System limit for number of file watchers reached` failure.
- Watcher `ENOSPC` errors now produce one compact actionable diagnostic and close the affected watcher instead of repeatedly emitting error dumps.
- Incoming user messages are no longer printed in `[OCHA FLOW]`; incoming records remain in memory for reply correlation, and outgoing bot responses/receipt updates remain observable.
- Added structured log redaction for Signal session key material and suppression of the known raw `Closing session: SessionEntry` libsignal dump.
- Terminal ANSI colors now honor `NO_COLOR`, `FORCE_COLOR`, TTY detection, and `TERM=dumb` to avoid escape-code leakage in redirected logs.

### Diagnostics
- The supplied `408 / ECONNRESET` reconnect sequence began about six minutes before the first `ENOSPC` watcher error. The watcher issue is real but is not sufficient to explain the initial WebSocket disconnect. The available logs cannot identify whether the earlier reset came from VPS networking, routing, or the remote WhatsApp edge. No evidence links the `.owner` command itself to the disconnect.

### Validation
- Added tests for runtime watcher exclusions, incoming-message log suppression, and Signal-key redaction. Offline tests do not reproduce the VPS inotify limit or live WhatsApp network conditions.

## [1.7.2] - 2026-11-20

### Added
- JavaScript eval receives live `sock`, `m` / `message`, config, logger, database API, filesystem/path/OS/crypto/process APIs, child_process, require, and dynamic import helper.
- WorkloadTracker classifies CLI, JavaScript eval, Python, and Go source before execution.
- Ocha AI impact assessment is invoked only for suspicious workloads to limit token usage.
- Quoted owner confirmation flow: exact one-time `CONFIRM CODE` or `CANCEL`, expires after 120 seconds.
- Static hard-blocks for critical host-wide destructive operations; AI assessment failure denies execution.
- Schema v13 migration; runner enablement remains unchanged.

### Safety notes
- Owner-only eval exposes real host capabilities and is not a security sandbox.
- AI review is advisory, not a safety proof. Scoped destructive actions require explicit confirmation; root/disk/host-wide critical patterns are blocked.

# Changelog

## [1.7.1] - 2026-11-19

### Changed
- Reduced the default AI coalescing window to 80 ms, output budget to 180 tokens, conversation history to 3 turns, input budget to 3,500 characters, and per-provider timeout to 3.5 seconds.
- Added `.aiset speed boost` with Groq-first routing, one eligible key attempt per provider, a 14-second total fallback deadline, 180 output tokens, and 80 ms coalescing. `fast` and `balanced` profiles remain available.
- Removed response-path waits for queued/generated/delivered checkpoints, AI turn journaling, provider hit/success telemetry, and reply-anchor persistence. Hot history and quote anchors are updated immediately; append-only durability writes continue asynchronously with error logging.
- Added an overall provider fallback deadline so slow providers cannot consume unbounded cumulative time. Boost/fast profiles use bounded per-provider key attempts; balanced mode permits more retries.
- Migrated schema v11 installations to v12, applying Boost values only when the stored setting still equals a known shipped default; owner-customized values are preserved.

### Validation
- Regression suite covers AI message coalescing, provider routing, config migration, reply-chain behavior, and command reply-session priority.
- Offline validation is recorded with the release archive; live provider latency and WhatsApp response timing still require measurement on the user's host and API keys.


## [1.7.0] - 2026-11-19

### Added
- Added a sender-bound quoted reply-session router. Active command screens are matched by chat and quoted message ID, validated before AI, consumed once on selection, and expire after 10 minutes by default.
- Reworked `.groupinfo` private-chat navigation: reply `1`-`10` to open a cached group, `0` for the next page, `00` for the previous page, and `0` from a detail screen to return to the list.
- Added persistent AI answer anchors and bounded quoted-reply chains. Group AI activates from a quote only when the quoted ID belongs to an AI answer, preserving up to 8 levels / 12,000 context characters.
- Added `.test <type> <options>` owner-only message lab for MessageType/StubType reference, local ButtonBuilder native-flow, quick reply, selection list, URL/call/copy/location/address/catalog CTA, legacy buttonsMessage, hydrated templates, reminder CTA, event/date, poll, image/video/audio/document/sticker/location/contact, PTV circle video, view-once image, AI rich response, and carousel messages.
- Improved serializer text extraction for event, poll, interactive response, template/buttons/list replies, rich responses and common media captions; expose symbolic `WAMessageStubType` metadata even for stub-only events.
- Added local `sock.ButtonBuilder()` alias for the existing project builder and reminder/cancel-reminder native-flow helper methods; corrected local CTA call parameters to `phone_number`.

### Changed
- AI no longer treats every quoted bot command/system message in a group as a conversational trigger. Group quoted-reply AI is restricted to persisted AI answer anchors; explicit bot mentions continue to trigger AI.
- AI checkpoint recovery now writes the same quote anchor as a normal AI delivery whenever WhatsApp returns a message ID.
- Documented that `MessageType` is a TypeScript key union (`keyof proto.Message`), `WAMessageStubType` is the system-event enum, and `ButtonBuilder` is a local project helper rather than a Baileys public export.

### Validation
- Unit tests cover sender-bound command sessions, one-time choice consumption, AI reply-chain bounding and dispatcher trigger rules.
- Syntax check: 77 JavaScript files. Offline test suite: 55 passed, 2 skipped, 0 failed; the two skips require the Baileys runtime dependency which was not installed in the build sandbox. AI reply-anchor history is warmed before the socket accepts incoming messages.
- Message delivery/rendering for hydrated, reminder, native-flow, event, poll, PTV, view-once, AI rich and carousel payloads still requires a live WhatsApp linked-device test. Media cases additionally require reachable URLs with matching MIME types.

## [1.6.3] - 2026-11-19

### Changed
- `.owner` now sends a native WhatsApp contact card instead of a text-only phone number and `wa.me` URL.
- Added serializer helper `m.sendContact()` so contact messages use the same JID normalization and outgoing-message tracking path as other serializer sends.
- Contact vCard includes structured `N` plus `FN`, a WhatsApp `waid` telephone field, and `Razzaq Ventures` organization metadata. The `displayName` field is placed inside the contact item for compatibility with the corrected Baileys contact-message shape.
- Added strict international phone-number validation and vCard escaping; no email, social profile, or unrelated personal metadata is fabricated.

### Validation
- Added unit coverage for number validation, vCard structure, and contact-item display name placement.
- Live delivery and save-to-address-book behavior still require verification on a linked WhatsApp client.

## [1.6.2] - 2026-11-19

- Simplified developer runner permissions: `.master cli on/off` directly controls `$`; `eval`, `python`, and `golang` are independent. Removed the confusing global `masterExecEnabled` gate and retained `.master exec` only as a compatibility alias for CLI.
- Added a formatted Ocha Master Console response with runtime, command, exit code, stdout, and stderr sections, plus local start/completion audit logs.
- Added owner-only private-chat `.mute on/off/status`; all group interactions are muted by default while group metadata events and verified PN contact indexing continue normally.
- Added bounded message-flow telemetry for private chats and groups, including sent/delivered/read/played states, group participant receipt counts, and a distinct colored bot-replied marker.
- Connected Baileys `messages.update` and `message-receipt.update` event streams. The console distinguishes a bot reply marker from actual WhatsApp delivery/read ticks; no client-side WhatsApp tick UI is modified.
- Added `docs/MASTER_CONSOLE.md` and `docs/GROUP_MUTE_AND_MESSAGE_FLOW.md`; updated README/menu and migrated configuration to schema v11.

### Validation
- Unit tests cover independent CLI authorization, legacy `.master exec` compatibility, muted group dispatch, always-on metadata/contact ingestion, and receipt-state aggregation.
- WhatsApp's real message status still requires a live linked-device session to verify; sandbox tests use event fixtures.


## [1.6.1] - 2026-11-19

### Fixed
- Removed the global monkey-patch that replaced every serializer `m.reply()` with a native-flow interactive message. All command replies now retain the serializer's ordinary `{ text }` sendMessage path, so they remain readable, selectable, and copyable in standard WhatsApp clients.
- Reworked `.menu` and private-chat `.groupinfo` output to text-first command lists with explicit copyable command syntax.
- Updated `.buttons` status/help text: the setting is retained for backwards compatibility, but cannot force an interactive transport that has caused unreadable messages.
- Updated README, configuration, and group-cache documentation to describe the text-first policy and avoid claiming that native-flow controls are sent by default.
- Added regression tests asserting command replies are never redirected to `sock.sendInteractive` when the compatibility preference is ON.

### Compatibility note
- Native-flow messages remain available only through explicit low-level APIs and are not used for ordinary command responses. A successful relay/ACK is not treated as proof that every WhatsApp client can render the interactive payload.
- Live WhatsApp client validation was not available in the build environment.


## [1.6.0] - 2026-11-19

- Removed Qwen from the provider registry, defaults, routing, `.env.example`, and owner configuration choices.
- Added a managed API-key vault and owner-only `.apikey add/delete/list/get` commands. Key secrets are masked in status output and identified by stable SHA-256 fingerprints; the vault is restricted to local owner permissions and is documented as unencrypted.
- Reworked provider routing to attempt every eligible API key for the current provider before moving to the next provider. Removed `maxKeyAttempts` from runtime config and migrated existing configurations to schema v10.
- Added per-key hit, success, failure, token-usage, last HTTP status, reason, and retry-time accounting using append-only `ai.key.event` records.
- Added response-based classifications for active, invalid/expired/revoked, forbidden, daily quota exhausted, rate limited, provider/network error, and request/model error. Cooldown keys are probed again after their retry time.
- Added persisted AI maintenance mode. If every configured key/provider is unavailable, AI stops replying to users silently and sends one detailed private report to the owner. Later requests probe recovered keys and automatically resume AI when one works.
- Added the public model identity `Nexora-2.0-Flash`; the assistant no longer identifies upstream provider/model names in ordinary chat.
- Expanded `.aistatus` into an AI control-center report with provider and per-key inventory, counters, cooldowns, and maintenance state.
- Updated AI/configuration documentation and tests. No live provider credentials were available, so provider behavior was tested with mocked HTTP responses only.

# Change Log

All notable changes to Ocha Lidya are recorded here. The newest release is listed first.

## [1.5.0] - 2026-11-19

### Added
- Dedicated `data/contact.jsonl` PN-only contact index. Each number is digits-only and stored once with blank `name` and `gender` fields. Legacy duplicate/bad lines are backed up to quarantine and compacted at startup.
- Dedicated `data/group-metadata.jsonl` event log, a one-time `groupFetchAllParticipating()` bootstrap, a durable completion marker, cached group listing in private chat, and lazy one-time fetch with cooldown only for an unknown group.
- Incremental group cache updates from `groups.upsert`, `groups.update`, and `group-participants.update`; participant add/modify events index verified PN contacts, participant removal updates only group metadata, and bot removal deletes only that group's cache entry.
- PN/LID resolution for DM and group message keys using `senderPn`, `remoteJidPn`, `remoteJidAlt`, `participantPn`, `participantAlt`, and `signalRepository.lidMapping.getPNForLID()` as a verified fallback. Existing group-cache participants and owner PN are also re-indexed into contacts at startup. Numeric LID fragments are never converted into PN JIDs.
- Native-flow quick-reply buttons on command responses by default, list selection for menu/group lists, copy action for owner contact, and owner command `.buttons on/off/status`.
- AI performance controls `.aiset speed fast/balanced`, bounded conversation-history cache warm-up, a 350 ms rapid-message coalescing window, duplicate incoming message ID suppression, smaller output budget, Groq-first fast fallback, one key attempt per provider in fast mode, and per-provider/overall deadlines. Provider latency EWMA and health counters are exposed in `.aistatus`.
- Added group cache, PN/LID, contacts, AI coalescing, and command-mode regression tests.

### Changed
- Bumped package to `1.5.0` and configuration schema to v9. `src/config.js` now contains `ui`, `groupMetadata`, and the low-latency AI defaults; existing custom model IDs are preserved during migration.
- `.groupinfo` is no longer group-only. In private chat it lists cached groups and selecting one displays stored metadata without re-fetching already-cached groups.
- Owner resolution uses the same verified PN extraction path as the contact database. Master runner messages now explain their individual opt-in switches; runners remain off by default.
- README, AI guide, configuration guide, and new contacts/group-cache guide updated.

### Validation
- Offline test suite: 36 tests passed, 2 Baileys-dependent serializer tests skipped because `@whiskeysockets/baileys` was not installed in this build sandbox.
- Syntax checks and ZIP package verification run after assembly.
- No live WhatsApp group, contact, or AI provider integration session was run in the build sandbox.

## v1.4.2 — 2026-11-18
- Updated `src/config.js` directly: WhatsApp login now defaults to `pairing` with the configured bot number.
- Added one-time JSONL configuration migration from schema v3 to v4 so existing v1.4.1 installs do not silently retain the old QR default.
- Added validation for WhatsApp auth mode, pairing number, and session directory.
- Updated README and WhatsApp connection documentation to match the actual shipped configuration.

- Moved WhatsApp login mode, pairing number, session directory, and connection timeouts out of `.env` into persistent `whatsapp` application configuration.
- Restricted `.env.example` to secrets and credentials only.
- Updated README and WhatsApp/configuration guides with the configuration API workflow.

# Change Log

All notable changes to Ocha Lidya are recorded here. The newest release is listed first.

## [1.4.0] - 2026-11-18

### Added
- WhatsApp login supports both QR scanning and phone-number pairing code through persistent `whatsapp.authMode` configuration.
- Pairing code is requested only after Baileys reports the socket as `connecting`, and the phone number is normalized and validated in international format.
- Added configurable session directory through persistent `whatsapp.sessionDir` configuration.
- Added pure connection-policy helpers and unit tests for phone normalization, disconnect classification, and reconnect delay.

### Fixed
- Replaced the one-shot reconnect guard with a single-timer reconnect scheduler, preventing repeated close events from suppressing future recovery attempts.
- Handles Baileys `restartRequired` (515) by recreating the socket promptly, as required after QR/pairing handshakes.
- Adds bounded exponential backoff with jitter for transient disconnects and stops automatic retries for logged-out/invalid sessions.
- Removes the startup dependency on fetching the latest WhatsApp Web version over the network; Baileys uses its bundled default unless the library itself is updated.
- Serializes credential-save operations to reduce overlapping session file writes.
- Adds explicit connection/query timeouts, keepalive interval, and disables link-preview generation on inbound processing for a lighter connection path.

### Notes
- Pairing code is a WhatsApp linked-device flow, not a phone-number/SMS OTP. It must be entered in WhatsApp's Linked Devices screen.
- Baileys is an unofficial WhatsApp Web client library. Reconnection logic cannot prevent account-side unlinking, network outages, or WhatsApp protocol changes.

## [1.3.1] - 2026-11-18

### Fixed
- Fixed the startup failure caused by importing `serialize`, `extendSocket`, and `trackSentMessageId` as named ESM exports when `serializ_simple.js` exposes them through its default export object.
- `src/index.js` now imports the serializer default object and destructures the required functions, preserving compatibility with the converted serializer module.

## [1.1.1] - 2026-11-18

### Added
- `.master` owner command for persistent control of developer runner switches.
- Append-only JSONL event database with sequence numbers and SHA-256 hash chaining.
- Primary journal and mirrored replica with startup integrity validation and automatic repair from the longest valid copy.
- Quarantine copies for journals that fail validation.
- Config persistence through `config.js` backed by `config.replace` events in the durable database.
- Segment identifiers so archived and active records can be deduplicated during interrupted rotations.
- Latest configuration checkpoint at `data/control/config.snapshot.jsonl`, preventing old archive retention from silently discarding the current bot settings.
- Namespaced append-only repository API (`putRecord`, `getRecord`, `listRecords`, `deleteRecord`) for user/group/plugin state.
- Repository-wide JavaScript syntax checker (`npm run check`) and core tests for JSONL recovery, persistent configuration, and entity CRUD.
- Size-triggered ZIP archives with SHA-256 metadata and archive verification before journal rotation.
- Streaming ZIP archive search through `.dbsearch`; archives are read without full extraction.
- Owner command `.dbstatus` for database health inspection.
- `docs/` directory for technical documentation.

### Changed
- `.env` now contains secrets only; bot mode, prefixes, execution flags, limits, and database policies are ordinary persistent settings.
- Prefix and bot-mode updates are written to the event database.
- `README.md` documents all current commands, architecture, settings, database behavior, recovery, and security constraints.
- `SOURCE_CONVERSION.md` moved from the project root to `docs/SOURCE_CONVERSION.md`.

### Security and reliability
- Database directories are created with restrictive permissions where supported.
- Every journal append is flushed with `fsync` when enabled.
- The archive source is validated and the ZIP is verified before active journal truncation.
- Retention is bounded by `database.archiveMaxCount`; archives beyond the configured retention window are pruned.

### Reliability refinements
- Runtime master-command switches and execution limits are now loaded from persistent config, not `.env`.
- Configuration replay includes archived JSONL segments, so auto-archiving does not erase saved settings.
- Archive segment identifiers make interrupted rotation recovery idempotent.

### Known limitations
- The JSONL database is a single-process, single-writer store; it is not a distributed database.
- ZIP archive lookup is linear across selected archive files. It avoids extraction but is not yet an indexed random-access database.
- A local mirror on the same disk protects against some logical corruption, not physical disk loss. Use off-device backups for disaster recovery.
- Multi-file session credentials remain managed by Baileys and must be backed up separately and securely.

## [1.2.0] - 2026-11-18

### Added
- Repository-wide automatic file monitoring for additions, edits, renames, and deletions across the project, including JS, JSON, Markdown, YAML, and other tracked file types.
- Automatic local commits and push to `origin/main` using `GITHUB_PAT` from `.env` through a temporary Git askpass helper.
- Jakarta-localized commit timestamps containing weekday, date, time, and WIB timezone.
- Git ignore enforcement using `.gitignore` plus Git's `check-ignore`; changed paths are staged individually and already-staged ignored paths block a commit.
- `npm run git:setup` and `npm run git:watch` operational commands.
- Source-wide JavaScript watcher, with plugin-level hot swap and controlled process restart for core/library/master JavaScript changes.
- Dedicated `docs/AUTO_GIT_SYNC.md` and `docs/HOT_RELOAD.md` technical references.
- Unit tests for Git status parsing, ignore-pattern extraction, and Jakarta commit timestamps.

### Changed
- Moved `CHANGE_LOG.md` to `docs/CHANGE_LOG.md`.
- Moved the central configuration API from root `config.js` to `src/config.js`; `src/core/config.js` now acts as the internal compatibility adapter.
- Root-level files are limited to hidden configuration files, `package.json`, and `README.md`; implementation, tests, scripts, and documentation stay in their respective directories.
- Updated README and configuration documentation to the new paths and automatic Git workflow.
- Bumped package version to `1.2.0`.

### Security and reliability
- GitHub PAT is never embedded in the remote URL, process command arguments, source files, JSONL settings, or application logs.
- Automatic push never uses force. Remote divergence and rebase conflicts stop the operation without deleting local changes.
- `.gitignore` excludes `.env`, dependencies, Git internals, session credentials, private runtime data, logs, and temporary artifacts. `.env.example` remains trackable.
- Core ESM source changes trigger a controlled restart rather than unsafe in-process cache replacement.

### Known limitations
- Automatic Git monitoring requires the app or `npm run git:watch` process to remain running; it is not an OS daemon.
- Auto-push requires Git, a correct local Git identity, branch `main`, the exact `origin` remote, network connectivity, and a valid PAT with repository Contents read/write access.
- Existing remote/local divergence is not force-resolved. Manual reconciliation is required when the two histories have diverged or contain rebase conflicts.
- The Git watcher and authenticated push path were not executed against GitHub in this build because runtime dependencies, a local clone of the target repository, and `GITHUB_PAT` were unavailable. The source passed syntax validation and the pure Git/timestamp helpers passed unit tests. The full serializer test requires `npm install` so `@whiskeysockets/baileys` is present.


## 1.3.0 — Multi-provider AI engine

### Added
- Multi-provider AI service for Gemini, Groq, Qwen, DeepSeek, and OpenAI using provider-specific HTTP adapters.
- Private-chat AI trigger for non-command messages; strict group gate requiring an explicit bot mention or a reply to a bot-authored message.
- Persistent conversation turns and AI job checkpoints in the JSONL event database.
- Automatic provider fallback, transient retry, API-key array rotation, timeout handling, and temporary circuit breaker.
- Startup recovery for unfinished AI jobs, with at-least-once delivery semantics.
- Owner controls `.aistatus` and `.aiset` for service status, provider order, and model overrides.
- `docs/AI_ENGINE.md` with trigger policy, providers, credentials, failover, checkpointing, and operations.

### Changed
- Added persistent AI defaults and validation to `src/config.js`.
- Added `QWEN_API_KEY` and `DEEPSEEK_API_KEY` to `.env.example`.
- Updated README command and AI documentation.

### Security
- Provider keys remain in `.env`; AI status never prints key values.
- Group AI is opt-in per message through mention/reply metadata; no unsolicited group responses.


## [1.4.3] - 2026-11-18

### Fixed
- Corrected the Baileys browser identity from the invalid custom label `Ocha Lidya` to the recognized `Chrome` browser profile on Ubuntu.
- Added `whatsapp.browserName` to the actual `src/config.js` defaults and validation, with schema v5 migration that normalizes existing saved configurations to `Chrome`.
- Pairing-code requests now wait for Baileys' initial `qr` readiness event, emitted after the initial `pair-device` exchange, instead of firing at the earlier `connection: connecting` event. The QR payload remains hidden in pairing mode.
- Updated pairing troubleshooting to explain that an emitted local code does not, by itself, prove server acceptance on upstream Baileys rc14; documented upstream PR #2559 as an unmerged follow-up rather than silently switching to an unmerged fork.

### Documentation
- Updated `README.md` and `docs/WHATSAPP_CONNECTION.md` with the required canonical browser-name setting and pairing readiness sequence.

### Validation
- Syntax checks and offline unit tests were run. Live WhatsApp pairing was not performed in the build environment.


## [1.4.4] - 2026-11-19

### Fixed
- A previously saved, registered WhatsApp session rejected with `401` in pairing mode no longer silently stops before a pairing code can be requested. The app waits for credential writes, moves the rejected session directory to a timestamped `.invalid-*` backup, and starts one fresh pairing attempt. The old auth data is preserved and never deleted.
- ZIP/source deployments without a `.git` directory no longer start an Auto Git watcher that repeatedly fails with `fatal: not a git repository`. Auto Git Sync now validates repository, branch, and remote before enabling its watcher.

### Changed
- Replaced the default JSON-line terminal logger with a compact, color-capable application logger with WIB timestamps, severity colors, scope labels, and structured details.
- Baileys now receives a dedicated Pino-compatible no-op logger configured at `silent`; application lifecycle and recovery logs remain visible through Ocha Lidya's logger.
- Added `whatsapp.recoverInvalidSession` and `logging` defaults/validation to the actual `src/config.js`, with schema v6 migration for existing installations.
- Updated README and connection, configuration, and Auto Git Sync documentation.

### Validation
- Added regression tests for one-time invalid-session recovery policy and schema v6 migration.
- Pairing against a live WhatsApp account was not run in the build environment; a printed code still requires phone-side confirmation and an eventual `connection: open` state.

## v1.9.0 — Nexora Website Builder

- Added a dedicated Website Builder capability for natural-language multi-file static website generation.
- Reuses the existing provider-key inventory, health tracking, provider fallback, shared Code Lab gateway, and single persistent TryCloudflare tunnel.
- Added bounded JSON manifest validation: 20 files maximum, 64 KiB per file, 256 KiB total, strict extension allowlist, safe paths, and required root `index.html`.
- Added tokenized project resource routes and a sandboxed iframe preview with restrictive Content Security Policy.
- Added owner/chat-scoped website revisions: follow-up edit requests reuse the current project's files and preserve its preview URL while incrementing the version.
- Website projects are held in bounded in-memory sessions and expire with the shared Code Lab TTL (maximum 60 minutes).
- Added global owner control `.nexora builder on/off`; `.nexora all on/off` now includes Website Builder.
- Added documentation and tests for website intent detection and project validation.
- Website Builder v1.9.0 supports static frontend prototypes only; real backend/database/authentication/payment/deployment are explicitly out of scope.


## v1.9.2 — Nexora automatic host dependency manager

### Added
- Added npm `prestart`/`predev` dependency checks; missing declared Node packages are installed automatically with `npm install --no-audit --no-fund`.
- Added `scripts/bootstrap/ensure-host.sh` and `src/runtime/bootstrap-agent.js` as an idempotent host dependency manager.
- After loading the saved configuration, `npm start` checks the selected container runtime, starts an existing Docker service, installs missing supported host packages, verifies `cloudflared`, and pulls only missing `python:3.12-alpine` / `node:22-alpine` images.
- Added a dry-run mode with `NEXORA_BOOTSTRAP_DRY_RUN=1` for safe inspection.

### Security and reliability
- The bootstrap runs synchronously once during startup and exits; it does not spawn a worker, terminal, tunnel, or background installer per user. Code Lab remains responsible for one shared persistent `cloudflared` process.
- The bot continues to start if optional host provisioning cannot complete. Code Lab reports unavailable runtime capabilities instead of disabling WhatsApp/AI chat.
- No automatic Docker socket chmod or docker-group membership changes; both could grant root-equivalent control. Privileged package/service operations require root or sudo.
- Package installation uses supported OS package managers and the official Cloudflare package source/release; no arbitrary remote shell script is piped into a root shell.

### Validation
- Added shell syntax, dry-run, and bootstrap integration tests. Host package installation and live Docker/Cloudflare operations must still be verified on the target VPS.


## v1.10.0 — Identity, Relationship & Experience Engine

### Added
- Added a safe public identity allowlist in configuration: owner/creator name, organization, and a public disclosure switch. Default creator and owner identity is Arifi Razzaq under Razzaq Ventures.
- Added deterministic local answers for creator identity, model identity, and simple greetings. These responses do not call an AI provider and remain available during generative-AI maintenance. Greeting variants rotate to avoid repetitive static replies.
- Added per-user persistent relationship profiles with XP, levels, rank tiers, active days, interaction counts, and aggregate communication-style preferences.
- Added `.profile` (`.me`, `.level`, `.xp`) with a professional PNG profile card when optional `sharp` is installed and a text fallback otherwise.
- Added public creator disclosure to `.about`, and use the configured owner name in the `.owner` contact card.
- Added `.aiset identity on/off` to control public creator disclosure.
- Added fair round-robin rotation among eligible provider keys and increased default per-provider attempts to three (Boost), two (Fast), and four (Balanced).

### Fixed
- Provider network errors are now wrapped instead of mutating native/fetch error objects. This fixes getter-only `code` properties that previously caused `Cannot set property code` and falsely exhausted Groq/Gemini routes.
- Verified owner identity is passed to the model only as a trusted application fact; ordinary chat claims cannot grant owner status.

### Privacy and limits
- Profile storage keeps aggregate counters and bounded message-ID deduplication only; raw chat content is not copied into profile records.
- XP has a 100-point daily cap. Relationship roles indicate interaction familiarity, not human emotion or psychological assessment.
- Only explicit public identity fields are exposed to the model; API keys, phone number, secret vault, and raw configuration remain excluded.

### Validation
- Added regression tests for provider error wrapping, round-robin key rotation, owner identity without provider availability, varied greetings, profile progression, duplicate-message XP protection, daily cap, and profile-card escaping.
