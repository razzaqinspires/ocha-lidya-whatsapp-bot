# Changelog

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
