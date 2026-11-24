## v1.10.46 — ACIE intake: Rizkyrohan text-canvas contribution

### Added / Changed
- Detect JavaScript dynamic imports as dependency candidates so runtime packages such as `@napi-rs/canvas` are not omitted from dependency intelligence.
- Detect text-image Canvas signals from the combination of `createCanvas`, `loadImage`, `fillText`/`strokeText`, and JPEG encoding; mark the capability `image-canvas.render.text` as `unverified` until an adapter protocol test passes.
- Generate a no-argument `.textimage` command draft (alias `.timg`) for the current fixed-content contribution. Draft remains hidden and cannot execute while the provider is quarantined.
- Record external asset references and a separate contributor compatibility adapter plan without patching or importing the preserved original source.
- Record the repeated receipt as a duplicate of the earlier byte-identical contribution; retain both intake records and both original snapshots.

### Validation
- `npm run check`: 264 JavaScript files passed syntax validation. `npm test`: 351 total, 349 passed, 0 failed, 2 skipped. The new Rizkyrohan intake regression suite passed 7/7. Original source remains static-only and is not executed.
- Font/background asset binaries were not vendored: their GitHub repositories report no license metadata, so asset rights remain pending. Production rendering remains blocked until asset permissions, dependency isolation, and an approved adapter are available.

## v1.10.45 — ACIE Part 3: autonomous command engineering & live registry integration

### Added / Changed
- Complete ACIE command lifecycle from static capability drafts to owner-approved virtual plugin descriptors. Drafts remain hidden until provider, sandbox, adapter protocol, integrity, license, attribution, security and owner-approval gates pass.
- Integrate generated commands into the existing `src/core/plugin-loader.js` registry. Existing Ocha dispatcher, permission, cooldown, group policy, menu and command catalog remain authoritative; no second command framework or contributed-source imports are introduced.
- Add explicit lifecycle operations for command inspect, protocol test, approve (`public` or `owner`), reject, revoke and runtime registry sync. Owner-only generated commands are private-chat-only.
- Add collision-safe namespacing (`acie-...`) and drop conflicting aliases without overwriting existing commands. Unresolvable collisions remain blocked.
- Make `generated-commands/index.json` the canonical lifecycle registry and synchronize the compatibility `contributions/registry/commands.json` with exclusive locks.
- Strengthen provider eligibility to require license review, attribution confirmation, source integrity, adapter review, adapter test, protocol-test proof, sandbox approval, successful runtime probe, owner authorization, output-contract proof and no critical/high static findings.
- Clear stale protocol-test success before re-testing; persist provider health, consecutive failure, response duration and circuit-breaker changes.
- Add provider protocol command test `.acie commands test <command-id>` and expand owner operations/help.
- Normalize provider output through field allowlists, HTTPS-only references, bounded metadata, credential-pattern redaction and attribution mapping.
- Update ACIE Part 1–3 documentation and operations workflow.

### Validation
- `npm run check`: 262 JavaScript files passed syntax validation.
- `npm test`: 344 tests total, 342 passed, 0 failed, 2 skipped.
- ACIE focused command-engine/foundation/runtime tests passed. Live container execution, target VPS provider behavior and WhatsApp client rendering remain target-host checks.

### Operational boundaries
- The sandbox still uses `--network=none`; public-service downloader contributions cannot fetch external URLs. Dependencies must already be present in a reviewed pinned runtime image. Generic JSON-stdio execution currently supports Node.js, Python, Go, PHP, Java source-launch and Bash; TypeScript/Rust require dedicated build adapters. Generated command output currently renders text and HTTPS links, not arbitrary local media uploads. Vault encryption-at-rest remains an encrypted-host-volume responsibility.

## v1.10.43 — ACIE Part 1: preservation and audit hardening

- Harden contribution intake with source-vs-vault byte verification, empty-directory inventory, bounded ZIP input size, and SHA-256 verification of the preserved source archive.
- Add version integrity anchors for the final manifest, provenance and static analysis; refresh the anchors after the intake pipeline finalizes metadata.
- Extend integrity verification to report altered/missing archive files, metadata, and directory-tree discrepancies without modifying any original source bytes.
- Bound static analysis to 5,000 candidate files, 64 MiB scanned text and 8 MiB retained snippets; report partial coverage instead of exhausting memory on large contributions.
- Expand static text scanning to `.env`, PEM/key files, manifests, configuration and extensionless scripts. Credential findings store detector/file/line only; matched values are never retained in reports.
- Discover additional CommonJS export forms and runtime requirement metadata; keep all function/capability findings explicitly heuristic and unverified.
- Prevent worker error summaries from retaining exception messages that may contain embedded credentials.
- Add a dedicated governance evaluator that keeps contributor identity, license, attribution, independent review and owner authorization as separate states; submitted rights text never grants activation.
- Serialize provider registry updates and add a mandatory production-sandbox-available gate. A provider cannot become routable merely because registry metadata is edited to look approved.
- Keep all contributed source quarantined and non-executable. The production sandbox, dependency installation isolation, executable adapters and live generated-command activation remain later-part deliverables.
- Add Part 1 architecture/audit documentation and expanded preservation, security, budget, archive-integrity, metadata-integrity and sandbox fail-closed tests.

Validation: `npm run check` passed (255 JavaScript files); ACIE focused tests passed 23/23; full `npm test` passed 323, failed 0, skipped 2 (325 total). ZIP intake requires the declared `yauzl` dependency to be installed on the VPS.

## v1.10.42 — ACIE contribution intelligence foundation

### Added
- Introduce ACIE as an internal Ocha subsystem with private Git-ignored contribution storage, immutable version paths, original-file SHA-256 inventory, provenance records, static analysis, capability candidates, adapter descriptors, provider registry, command specification drafts, worker roles, routing/fallback primitives, circuit breaker, trace IDs and JSONL audit records.
- Add directory and ZIP intake through `npm run acie:intake`; ZIP extraction rejects traversal, absolute paths, symlinks, duplicate entries, special entries and configured size/count overflows. A source ZIP is retained byte-for-byte alongside the extracted original tree.
- Support static discovery for JavaScript/Node, CommonJS/ESM, TypeScript, Python, Go, PHP, Java, Rust and Bash, with heuristic runtime, dependency, imports, function/parameter, export, environment, network, output-shape and risk candidates.
- Add owner/private `.acie` commands for contribution inspection and verification, provider status, capability and command drafts, routing status, worker health, security/dependency/compatibility summaries and audit history.
- Add conservative command drafts and collision checks; active Ocha menu/plugin registration remains on the existing plugin loader and is not bypassed.
- Integrate ACIE initialization after the JSONL database and before WhatsApp socket startup. ACIE initialization errors are isolated so regular bot startup can continue.
- Add 17 ACIE architecture, preservation, intake, language, adapter, routing, fallback, command, runtime, security, governance, monitoring, troubleshooting and operations documents.

### Security and limitations
- Original contribution bytes are copied into `original/`, checked by SHA-256 and made read-only best effort. Every re-submission is a new version; no source patching/refactoring occurs.
- Original contributions are never imported or executed by the bot. Providers default to quarantined; command candidates default to pending validation; credentials are not printed or added to telemetry.
- The current release is a foundation, not full acceptance of all ACIE goals: no production Docker/OCI sandbox runner, isolated dependency installation, live multi-language process execution, automatic active command factory, external malware/license review, signed contributor identity, or ACIE-managed encryption-at-rest is included. The vault currently relies on restrictive host filesystem permissions; place it on an encrypted volume before accepting contributions containing live credentials. Provider activation is fail-closed until the execution and governance gates are implemented and proven.
- Language/capability/interface detection is static heuristic analysis; findings are candidates, not runtime proof. ZIP intake requires the already declared `yauzl` package to be installed.

### Validation
- `npm run check`: 254 JavaScript files passed syntax checking.
- ACIE focused tests: 14 passed, 0 failed. Tests cover path traversal rejection, multi-language recognition, capability candidate filtering, byte preservation, provenance, immutable versioning, provider quarantine, static alias collision scanning, fallback eligibility, credential redaction and error classification.
- Full `npm test`: 316 tests, 314 passed, 0 failed, 2 skipped. `npm run check`: 254 JavaScript files passed syntax checking.
- ZIP extraction was not exercised in this build environment because project dependencies were not installed here. The declared `yauzl` dependency must be installed with `npm install`; target-VPS/WhatsApp runtime validation is still required before production use.

## v1.10.37 — Native command menu, Kernel response reliability & profile canvas refresh

### Added / Changed
- Replace the two quick-access-only menu buttons with a native-flow category selector and paginated command selector sourced from the live plugin registry. Rows execute canonical command IDs through the regular dispatcher, permissions, tenant command policy, and quota checks.
- Hide owner-category and `ownerOnly` commands from non-owner interactive menus; owner category remains visible to backend-verified owner sessions. Add category navigation for General, Developer, and Owner/System plus Profile and Website shortcuts.
- Send an immediate local telemetry acknowledgement when `.kernel` is invoked, before waiting for Code Lab/TryCloudflare initialization. Follow with a WebView CTA and URL when available, or a clear diagnostic reply when the gateway is unavailable.
- Redesign the `.profile` SVG canvas to a 1080×1520 dark graphite/gold layout with level medallion, rank, XP progress, activity metrics, familiarity, trust, role progression, and achievement chips. Keep all profile fields escaped and progress values clamped.

### Validation
- `npm run check`: 225 JavaScript files passed.
- Focused menu, Kernel, profile-canvas and menu-renderer tests: 11 passed, 0 failed.
- Full `npm test`: 286 tests, 281 passed, 3 failed, 2 skipped. The failures are outside the edited modules: one AI local-policy XP threshold assertion and two test cleanup races (`ENOTEMPTY`) while asynchronous User Vault persistence is still finishing (AI batching and website-builder integration).
- SVG profile canvas passed XML parsing and local PNG rendering. Live button delivery, Cloudflare tunnel publication, and Sharp PNG rendering must still be confirmed on the target VPS/WhatsApp client.

## v1.10.36 — Chokidar dependency and watcher fallback reliability

### Fixed
- Pin `chokidar` to `4.0.3`, which remains compatible with the repository's Node.js `>=20.18.0` engine range.
- Route plugin hot reload and Auto Git Sync through a shared watcher adapter. Chokidar remains the primary watcher; a native Node.js filesystem watcher is used if the package cannot be resolved.
- Keep runtime/cache/session directories excluded from the native fallback and normalize add/change/unlink events for the existing transactional reload and Git-sync handlers.
- Prevent `npm start` preflight from aborting startup when `chokidar` is the only missing dependency; it reports the manual install command and uses the fallback. Other missing dependencies remain installation blockers.
- Add watcher regression tests for add, change, unlink and ignored-directory behavior.

### Validation
- `npm run check`: 222 JavaScript files passed.
- Focused watcher tests: 2 passed, 0 failed, including add/change/unlink, nested directory discovery, and ignored-directory behavior.
- Full `npm test`: 273 passed, 3 failed, 2 skipped. The six prior `ERR_MODULE_NOT_FOUND` failures caused by Chokidar are gone. The remaining failures are outside this watcher patch: one AI XP threshold assertion and two `ENOTEMPTY` cleanup races while asynchronous User Vault writes are still completing.
- Direct installation was attempted but the build container could not resolve `registry.npmjs.org` (`EAI_AGAIN`). The package remains pinned in `package.json`; run `npm install --no-audit --no-fund` on a host with registry access to install it and create/update `package-lock.json`.

## v1.10.35 — Website Builder, tenant dashboard mutations & Android source

### Added
- Add seven responsive professional website templates: business, portfolio, agency, storefront, creator, restaurant and event.
- Add persistent website drafts, private editing sessions, public publication through the existing shared Code Lab TryCloudflare gateway, custom sections, and website-specific audit records.
- Add text, image and MP4 website posts; images accept JPG/PNG/WEBP up to 10 MB, videos accept MP4 up to 20 MB, and site media is capped at 50 MB. Add 1:1 PNG share-card generation through optional `sharp`.
- Claim the non-renter's one-time website entitlement at first publication rather than draft creation. Keep one website slot per active rental group and restrict renter website management to the billing contact.
- Extend rental keys with `rental:write`, idempotent member-limit updates, queued `remove`/`promote`/`demote` actions, command allowlist/denylist endpoints, status history and audit entries.
- Add an autonomous membership worker that rechecks rental status, current group metadata, bot admin rights and target membership before applying an action.
- Reuse the existing Code Lab gateway for `/w/`, `/editor/`, `/editor-api/` and `/api/v1/` routes; do not start a second public tunnel in the normal setup.
- Add a native Java Android dashboard source project under `apps/android-dashboard/` for rental overview, member-limit changes, queued member actions, command policy, history and setup guidance.

### Security and limitations
- Public website URLs contain random tokens; only token hashes are persisted. Editor sessions expire after 24 hours, use a Bearer token and same-origin checks, and are separate from public website access.
- Rental API mutations require active tenant entitlement, matching billing-contact ownership, `rental:write`, a unique `Idempotency-Key`, and audit journaling. Member actions are queued, not executed directly from the HTTP request.
- The internal member limit cannot exceed the purchased plan ceiling or fall below current membership; it does not change WhatsApp's platform-wide maximum.
- Android source is included, but a compiled APK is not claimed: Android SDK/Gradle compilation was not available in the build environment. The PNG share-card command requires `sharp` to be installed on the host.

### Validation
- Focused tests cover website templates, public token and media routes, editor authorization, tenant command policy, dashboard API tenant ownership and idempotency, and existing website preview gateway.
- Live WhatsApp group actions, TryCloudflare behavior, live payment settlement, optional `sharp` execution and Android device installation remain target-host validations.

## v1.10.34 — Rental dashboard API, one-time website verification & command collision audit

### Added
- Add tenant-bound dashboard API keys with separate `rental:read` and `profile:read` scopes. Raw secrets use the `ocha_live_` prefix and are displayed once; SHA-256 hashes are stored in the JSONL repository.
- Add read-only HTTP endpoints `/v1/rental/overview` and `/v1/profile`, `x-api-key` authentication, no-store response headers, and a 60-request/minute per-key limiter.
- Add optional TryCloudflare quick-tunnel launch for the dashboard API (`OCHA_RENTAL_API_TUNNEL=1`, requires `cloudflared`).
- Add `.sewaapi` key creation/list/revoke commands and a two-choice interactive scope selector.
- Add `.website verify|paid|bukti|status` and owner `.webverify` review workflow. A verified account receives a blue-check entitlement and exactly one website slot; the Part 2 builder must consume the slot when publishing.
- Add `.commandaudit` to detect duplicate canonical commands and aliases, persist findings, and recommend a non-destructive rename/alias strategy.
- Add menu quick-access buttons for `.profile` and `.website`.

### Security and scope
- API key secrets are never persisted in plaintext. Rental keys are bound to one selected group; profile keys are bound to their issuing WhatsApp account.
- API Part 1 is read-only. Membership changes, raising member limits, quota mutations, public page editor, seven templates, shareable media posts, and APK packaging are deferred to Part 2 until write authorization, audit, and idempotency are implemented.
- Website verification costs Rp10.000 once. Payment evidence is stored privately and forwarded for manual review; screenshot receipt does not automatically grant a badge or website slot.
- Duplicate command detection does not delete or rewrite source automatically. It stages recommendations because semantic equivalence and compatibility require complete-file review, WorkloadTracker assessment, tests, and atomic source revision.

### Validation
- JavaScript syntax check: 213 files passed.
- Full test run: 257 passed, 6 failed, 2 skipped. The six failures were environment-related subprocess imports because `chokidar` was unavailable; dependency installation timed out in this environment. Full suite must be rerun after `npm install` on the target host.
- Live WhatsApp delivery, TryCloudflare tunnel, owner approval workflow, and public API calls remain target-host validation tasks.

## v1.10.33 — YouTube application config, rental customer portal & Baileys reference review

- Move YouTube executable paths and non-secret resource limits from `.env` into `DEFAULTS.youtube` in `src/config.js`; schema v36 migrates existing JSONL configurations without dropping owner-defined settings.
- Add owner-only `.ytconfig` controls for yt-dlp path, FFmpeg path, max output size, duration cap, search-result count, and reset. The downloader reads the persisted config dynamically; it no longer reads the five legacy YouTube environment variables.
- Add private customer self-service `.sewa invoice [id]` and `.sewa pesanan` lookup. Results are limited to the exact requesting WhatsApp JID and selected group; read-only lookup does not require current group-admin status.
- Add focused tests for customer/group isolation, invoice expiry labels, and dynamic YouTube settings.
- Add `docs/BAILEYS_REFERENCE_REVIEW.md` with source-linked review notes from the upstream Baileys guide and public Baileys bot repositories. Research recommendations are separated from delivered code.

### Validation
- Focused YouTube config, application-config migration, and rental customer-portal tests: 12 passed, 0 failed.
- JavaScript syntax validation: 205 files checked.
- Live WhatsApp delivery, YouTube binary execution, full dependency installation, and VPS/Cloudflare deployment remain target-host checks.

## v1.10.32 — Public Kernel WebView & live telemetry

### Added
- Added public `.kernel` command with `.kernelstatus` and `.nadiweb` aliases; it publishes a read-only WebView through the shared Nexora Code Lab HTTPS Quick Tunnel.
- Added persistent aggregate counters for inbound messages, bot output messages, correlated reply turns, AI requests/responses/failures, provider counts, response characters, and rolling latency percentiles.
- Added a live dashboard for NADI oscillator, homeostasis, OCC appraisal, neuromodulator fields, predictive self-model, EFE policies, integration and entropy proxies, memory-chain integrity, WhatsApp connection, and Node runtime diagnostics.
- Added bounded event history, 24-hour activity chart, explicit model equations, telemetry tests, and public-dashboard operational documentation.

### Security and interpretation
- The public endpoint uses a 256-bit random path token, GET-only handling, restrictive response headers, rate limiting, and the existing HTTPS tunnel; it does not expose the loopback NADI API.
- Public telemetry excludes message contents, phone numbers, JIDs, sender identities, user profiles, private conversation history, private memory, self-narrative, and workspace broadcast text. Runtime state values are synthetic computation, not evidence of biological emotion or phenomenal consciousness.
- Runtime telemetry and dashboard token are excluded from Git through `data/kernel/`. Counters start with this version and are not reconstructed from historical chat logs.

### Validation
- JavaScript syntax check: 201 files passed.
- Focused telemetry test: 1 passed, 0 failed.
- Full bot integration and live WhatsApp/Cloudflare rendering still require validation on the target host with declared dependencies and `cloudflared` installed.

## v1.10.31 — External NADI component separation

### Added
- Added an external NADI component manager using Node.js native `fetch`, bounded GitHub archive downloads, SHA-256 verification, safe ZIP extraction, component-layout validation, and atomic installation outside the Ocha source tree.
- Added configurable GitHub repository/ref support, optional immutable archive checksum pinning, a manual external source directory, and optional remote HTTP service mode.
- Added an HTTP client for NADI v2.1 with readiness checks, status polling, managed heartbeat controls, explicit ticks, sleep consolidation, integrity verification, and shutdown checkpointing.

### Changed
- Removed the embedded Python NADI package from `src/consciousness/`; NADI is now a separately versioned repository/component.
- NADI owns its drift-corrected heartbeat; Ocha polls telemetry instead of sending one tick per interval, avoiding duplicate heartbeat loops.
- Updated `.nadi` commands and runtime documentation for external component/version/source visibility.
- Preserved existing NADI state under `data/consciousness/` by default and preserved the entire Ocha feature tree, AI provider chain, plugin set, and database behavior.

### Security and fallback
- ZIP extraction rejects traversal, absolute paths, symbolic links, oversized archives, and excessive entries.
- NADI stays loopback-only by default; repository credentials remain in environment secrets.
- If the NADI repository is not yet configured, NADI is marked unavailable and normal WhatsApp/AI functions continue.

### Validation
- NADI Python base suite: 4/4 passed; extended suite: 8/8 passed.
- Ocha syntax check: 196 JavaScript files passed; focused NADI/runtime suite: 6/6 passed.
- Direct Ocha-to-external-NADI HTTP integration passed: startup, heartbeat, prompt telemetry, manual tick, chain verification, heartbeat pause/resume, and clean shutdown.
- Full Ocha suite: 250 passed, 2 skipped, 6 blocked by the missing local `chokidar` installation. `chokidar` remains declared in `package.json`; install declared dependencies before rerunning the full suite.
- GitHub archive download was not exercised because the standalone repository URL has not yet been supplied.

# Changelog

## [1.10.28] - 2026-11-24

### Added
- Added contextual feature-build intent resolution. A short confirmation such as `buat aja` is linked only to a recent user request plus Ocha's preceding offer to prepare that feature.
- Added private, encrypted owner feature backlog events (`feature.requested` / `feature.status`) with deduplication, acceptance criteria, status history, and account-scoped retrieval.
- Added owner-only `.features list|all|show|progress|complete|cancel|reopen` to review development requests from the authenticated owner's own User Vault.
- Added focused tests for intent confirmation, encrypted storage, cross-account isolation, append-only status changes, and explicit opt-in interactive UI.

### Changed
- Unsupported game requests now receive a conversational development offer instead of a hard stop. A confirmed owner request is recorded as a proposal; feature source is never self-written or self-installed by the model.
- Unknown natural-language command requests now ask for the desired outcome and offer capability matching or a development request instead of a blunt registry error. Restricted command execution remains backend-gated.
- AI-generated quick replies, lists, copy CTA, and URL CTA are ignored unless the current user explicitly requests the corresponding interactive presentation. Ordinary answers remain plain text.
- Capability grounding now instructs the model to find a legitimate alternative or prepare a feature proposal rather than terminating at an unavailable-feature statement.

### Validation
- Feature intent, encrypted vault lifecycle, owner backlog isolation, AI response UI, and command-intent tests: 13 passed, 0 failed.
- Syntax validation and full test suite are run separately in the release environment; provider and WhatsApp live behavior still require target-server validation.

## [1.10.26] - 2026-11-23

### Changed
- Re-audited official provider model IDs, pricing, free-tier eligibility, and rate-limit documentation. Model-list visibility is no longer treated as proof of free access or inference health.
- Groq free-plan routing now selects only the verified `openai/gpt-oss-120b` primary for this deployment; Gemini `gemini-3.8-flash` remains a documented free-tier secondary. DeepSeek and OpenAI remain excluded from free-only routing because their published inference APIs are usage-priced.
- Added policy version and research timestamp to the persisted model catalog. Unknown or merely visible models cannot be auto-promoted into free-only routing.
- Added Groq-specific request compaction (18,000 input characters) and 2,048 output-token cap to mitigate the observed 8K TPM pressure; default requested output budget reduced from 32,768 to 4,096 tokens.
- HTTP 429 TPM/RPM events now receive short rate-limit cooldowns instead of being mislabeled as daily quota exhaustion. HTTP 503 remains a transient provider capacity/network failure, not an invalid model/key signal.
- AI provider exhaustion remains silent to the requesting user. The owner receives one compact private maintenance report; provider diagnostics are not echoed into other users' chats.

### Validation
- Provider/model catalog, free-only routing, TPM fitting, provider error classification, and fallback tests: 20 passed, 0 failed.
- Syntax check: 184 JavaScript files.
- Official references and observed-log diagnosis: `docs/AI_MODEL_CATALOG.md`.

## [1.10.25] - 2026-11-23

### Added
- Expanded Ocha's versioned operational self-model with identity, session scope, relationship statistics, decision protocol, capability provenance, authority boundary, and explicit non-consciousness contract.
- Added owner-only rental support queue commands: `.rentals support [open|answered|closed|all]`, `.rentals reply <ticket-id> <message>`, and `.rentals close <ticket-id> [note]`.
- Added customer support intake through `.sewa masukan`, `.sewa saran`, `.sewa keluhan`, and `.sewa konsultasi`; duplicate submissions are deduplicated and tickets are auditable.
- Added post-approval request for an honest, transaction-backed review without requiring a positive score.
- Added higher rank milestones through Paragon, Nova, Cosmic, Apex, Transcendent, Nexus, and Singularity, followed by unbounded dynamic Singularity tiers for continued high-level progression.

### Changed
- Expanded default AI context to 96 recent turns and 96,000 input characters; raised requested output budget to 32,768 tokens and per-provider timeout to 60 seconds while retaining the 180-second shared task deadline.
- Completion recovery now continues until the shared deadline or a no-progress guard instead of stopping after a fixed number of attempts.
- Memory facts are relevance-ranked against the active query and can fill a larger adaptive context budget. The application has no fixed total fact-count cap; individual notes are bounded to 16,000 characters for storage safety.
- Historical private-conversation search selects more relevant excerpts based on the active input budget instead of a fixed 32-result ceiling.
- XP awards now require a valid daily first contact or unique meaningful content; repeating low-signal messages no longer farms XP. The durable profile retains message/content fingerprints without the previous 500/1,000-entry truncation.
- Relationship progress remains separate from authorization: level, rank, trust, and familiarity never grant access to owner commands or another user's memory.
- New-contact tone is explicitly reserved and mildly distant while staying respectful; owner affection is only included in the verified owner's private-chat prompt. Group/public conversations remain professional.
- Per-user encrypted `data/roo/<sha256-user-id>/` archives remain the source of record. Group conversations do not load private long-term memory.

### Validation
- Focused memory/identity/profile/vault/rental suite: 29 passed, 0 failed. Configuration and group-mute migration suite: 12 passed, 0 failed. Owner rental support plugin was exercised end-to-end with a mocked socket: ticket listing, owner DM reply, and close transition succeeded.
- Full repository suite: 224 passed, 6 blocked by the missing `chokidar` package in this build environment, 2 skipped. `npm install` could not complete within the build environment; `chokidar` is declared in `package.json` and is installed by the target startup bootstrap. `npm run check` validates all 184 JavaScript files.
- Live WhatsApp rendering, provider continuation, and the full suite must still be rerun on the deployment server after declared dependencies are installed.

## [1.10.24] - 2026-11-23

- Extended the adaptive AI runtime defaults to 48 history turns, 48,000 input characters, 16,384 requested output tokens, 45-second provider timeout, and 180-second shared job deadline.
- Increased truncation recovery to up to eight continuation attempts within one absolute deadline.
- Removed the fixed reply-depth fork: verified AI reply anchors retain their complete parent lineage with cycle detection; the prompt receives a recent bounded excerpt.
- Added owner-only `.aiset speed deep` profile for the full extended reasoning envelope.
- Updated identity, archive, XP/rank, and AI engine documentation for schema v32.
- Preserved provider, WhatsApp payload, disk-capacity, and project isolation safeguards.

## [1.10.23] - 2026-11-23

### Added
- Added a versioned Ocha Identity Kernel with stable operational persona traits, private-owner warmth in verified DMs, reserved-but-respectful behavior for new contacts, and professional group tone. It explicitly does not claim consciousness, AGI, or ASI.
- Added encrypted per-user `roo/<sha256-id>` storage for long-term private conversation archives, memory snapshots, relationship profiles, project repositories, indexes, and project history.
- Added one-time idempotent migration of legacy private-DM AI turns into each sender's encrypted vault. Migration retains original timestamps, skips group and ambiguous cross-chat rows, and does not rewrite the legacy append-only journal.
- Added `.memori status|fakta [page]|cari <query>|terbaru|ekspor|hapus-fakta <phrase>` for private self-service memory/archive operations.
- Added unbounded arbitrary-precision XP and levels, expanded ranks through Eternal, familiarity roles through Mitra Tepercaya, no daily XP ceiling, and per-user locking for concurrent profile updates.
- Added verified rental comparison, member estimator, features/FAQ, transaction-backed public ratings, one-review-per-approved-invoice, upgrade, and renewal commands under `.sewa`.
- Added per-user serialized memory writes and tests for migration isolation, idempotence, concurrency, and default `roo` project location.

### Changed
- Raised schema v31 AI defaults to 30-second per-provider timeout, 120-second shared job deadline, requested 8,192 output tokens, 24 recent history turns, and 24,000 user-input characters. Provider-level hard limits still apply.
- Truncated output may receive up to four deadline-bound continuation attempts on the originating provider.
- Project Library now uses the same normalized SHA-256 user namespace as the encrypted User Vault by default; legacy project folders are copied into that private namespace without overwriting existing destination data.
- Historical retrieval now includes up to 12 relevant excerpts and preserves original imported timestamps in the encrypted search index.
- Removed application event-count and XP daily caps. Physical disk limits, provider context/token ceilings, WhatsApp payload limits, and Project Builder resource quotas remain explicit safety controls.

### Validation
- New identity, vault migration, user-vault, memory concurrency, profile/XP concurrency, rental, provider-deadline, configuration, and project-library focused tests are run separately.
- Full `npm test` still requires all declared dependencies to be installed on the target runtime. Live provider and WhatsApp-client behavior must be validated after deployment.

## [1.10.22] - 2026-11-23

### Added
- Added live plugin/capability grounding to AI prompts, plus deterministic command-directory explanations for quoted `.menu`/command listings.
- Added explicit natural-language command invocation through the shared `executeRegisteredPlugin` policy gate. Only `.ping`, `.about`, and `.profile` are currently allowlisted with `aiCallable: true`; aliases inherit the canonical plugin policy.
- Added sender-scoped opt-in long-term memory in the namespaced repository, with private-chat-only controls, 20-fact bounds, secret/sensitive fact rejection, and matching/full deletion.
- Added deterministic guards for unsupported Tic-Tac-Toe/game requests and legacy fabricated-board continuations when no real game plugin is installed.
- Added common Markdown-to-WhatsApp formatting normalization, bounded output continuation, long-message chunking, and reply-anchor registration for delivered chunks.
- Added regression tests for WhatsApp formatting, code-fence splitting, completion inspection, command intent, game state guards, memory consent, and AI UI-plan validation.
- Recovered queued/generated AI jobs now use the same completion inspection, WhatsApp formatter, validated UI delivery, and per-chunk reply-anchor pipeline as live responses.

### Changed
- AI output defaults are now 900 output tokens, 8 recent history turns, 5,000 input characters, and 100 ms coalescing through configuration schema v29. The migration updates only known prior shipped defaults and preserves other owner overrides.
- AI replies use WhatsApp-native markers (`*bold*`, `_italic_`, `~strikethrough~`, monospace/backtick, and triple-backtick code blocks) rather than leaking `**Markdown**` syntax.
- AI message UI remains text-first. Quick replies/lists/copy/URL CTAs are validated; image/video/carousel output requires a registered backend media capability and is not invented by the model.
- Truncated provider outputs receive up to two bounded continuation attempts on the originating provider; unresolved truncation is explicitly disclosed rather than silently presented as complete.

### Validation
- Focused regression set: 46 passed, 0 failed. `npm run check`: 175 JavaScript files checked successfully.
- Four integration test files could not execute in this build container because `chokidar` is not installed; this is an environment dependency limitation, not a passing test.
- Live WhatsApp delivery, client-side button rendering, and provider continuation are not simulated by unit tests and still require a live deployment check.

## [1.10.21] - 2026-11-23

### Added
- Added owner-controlled `.buttons full all` adaptive command UI with aliases `.button`, `.fullbutton`, `.commandbutton`, `.buttonmode`, and `.uibuttons`.
- Added per-command policy evaluation, live registry audit/dry-run, persistent owner exclusions, plugin-defined safe actions, and alias inheritance from canonical plugin metadata.
- Added Quick Reply for one to three actions and Single Select for four to eight actions; long/code/progress/diagnostic output keeps the original text transport.
- Added permanent UI exemptions for commands that own a carousel, explicit Native Flow, image/contact card, menu pagination, checkout, or reply-session flow.
- Added schema v28 configuration and focused tests for action discovery, button type selection, alias inheritance, exemptions, temporary wrapping/restoration, and text fallback.

### Changed
- Dispatcher installs the adaptive reply adapter only after command authorization/guard/quota checks and restores the original serializer reply method in `finally`.
- Legacy `.buttons on/off/status` now controls the adaptive full-button setting while preserving the legacy `ui.buttonsEnabled` field.
- Group admin responses expose safe follow-up actions for group info, saved rules, and the admin help screen.

### Validation
- Full automated suite: 195 passed, 2 skipped, 0 failed (197 total).
- `npm run check`: 165 JavaScript files checked successfully.
- Static command/alias audit: 101 distinct registered command tokens; no alias collisions found. Runtime plugin-loader import was unavailable in this build container because `chokidar` is not installed.
- Live WhatsApp rendering was not exercised in this container; after enabling, validate Native Flow rendering on the target WhatsApp clients.

## [1.10.20] - 2026-11-23

### Added
- Expanded owner-only `.test` Native Flow lab into five independently runnable test pages, covering quick replies, single-select, CTA URL/call/copy, send location, reminders, Galaxy Flow, catalog/address forms, voice-call request, call permission, MPM, review-and-pay, and order-detail payloads.
- Added `.test identity` and `.test inspect` output for chat/sender PN-LID metadata, addressing mode, bot identity, message metadata, and parsed Native Flow callback fields.
- Added `.yts`, `.ytmp3`, `.ytmp4`, and `.ytm` YouTube commands. Search results use uploaded thumbnail media in carousel cards and offer MP3 plus every detected MP4 resolution; `.ytmp4` can also show or download a selected quality.
- Added an isolated audio-only path for `.ytm`: unique temporary folder per request, yt-dlp cache disabled, MP3-only post-processing, and no call into the MP4 downloader.
- Added YouTube command, installation, resource-limit, and licensing guidance.

### Changed
- Native Flow response parsing now preserves the full `paramsJson`, extracts nested IDs/row IDs, and exposes normalized response metadata to the standard command dispatcher.
- All quick-reply/list callbacks in the message lab now carry `.test response ...` command IDs so taps can be verified through normal command routing. CTA URL/call/copy and other app-native actions are explicitly treated as WhatsApp-client actions, not guaranteed bot callbacks.
- Carousel cards can prepare image URLs/Buffers with Baileys `prepareWAMessageMedia` and `waUploadToServer` before relay; each card's buttons are normalized losslessly.
- Resolved sender PN metadata is also copied into the serializer identity inspector after the connection pipeline resolves it.

### Validation
- Full automated suite: 186 passed, 2 skipped, 0 failed (188 total); `npm run check`: 163 JavaScript files checked successfully.
- Added tests for interactive message text, nested Native Flow response parsing, YouTube URL validation, MP4 resolution extraction, MP3/MP4 selection rows, and metadata formatting.
- Native Flow schema review follows Baileys `WAProto.proto`; relay success does not guarantee that every WhatsApp account/device/client renders every experimental action or sends a bot callback.
- Local YouTube unit tests do not perform live downloads. The current build environment does not have `yt-dlp` installed, so live search/download must be tested on the target server after installing `yt-dlp` and FFmpeg/ffprobe.

## [1.10.19] - 2026-11-22

### Added
- Private rental checkout routing: `.sewa` in a group stores a 12-hour group context and sends all checkout information to the verified user's DM.
- Group acknowledgement throttling (45 seconds per group/user) and a safe fallback when a private message cannot be delivered.
- Package member limits (Mini 50, Standard 200, Pro 1,000), order-time capacity checks, over-limit tenant enforcement, and owner `.rentals setmembers` control.
- Private payment-evidence upload for JPG/PNG/WEBP images up to 5 MB, a three-image per-invoice cap, private owner forwarding, audit metadata, and strict MIME/path/size/actor validation.
- `.gadmin` group admin toolbox for status, group rules, welcome messages, polls, and announcements; saved rules are readable by all group members.
- Detailed Indonesian customer guide and updated 100-item implemented-vs-roadmap rental catalog.

### Changed
- Customer checkout, QRIS/account instructions, payment reporting, and payment evidence are handled only in private chat.
- Accidental payment-evidence images sent with a rental command in a group are rejected; the bot attempts deletion and asks the sender to resend privately.
- Rental expiry reminders are delivered privately to the billing contact or verified group admins.
- Owner payment approval announces activation in the target group and privately confirms it to the requester; rejection notifications are private.
- Profile streak rendering now uses the interaction timestamp when returning a recorded interaction, removing a clock-dependent test inconsistency.

### Validation
- Added targeted tests for DM routing, one-time group acknowledgement, group evidence rejection/deletion attempt, checkout-context expiry, package member-cap enforcement, evidence validation, and group rules/welcome persistence.
- Full suite: 175 passed, 2 skipped, 0 failed (177 total); `npm run check`: 159 JavaScript files checked successfully.

## [1.10.15] - 2026-11-21

- Changed group activation to an in-context owner control: the verified owner sends `.mute off` inside the target group; `.mute on` mutes that same group.
- Added a narrow muted-group dispatch exception for verified owner `.mute` commands only. All other commands and AI interactions remain suppressed while muted. Non-owner `.mute` messages are silently ignored.
- Added schema v26 migration that restores the safe global MUTE default and clears prior per-group activation overrides, requiring deliberate owner activation in each group. Bulk activation is disabled; `.mute on all` remains an emergency mute.
- Changed participating-group hydration into a reconciled inventory refresh on connection startup, throttled to five minutes; detects groups joined while offline and removes stale groups no longer joined.
- Updated `.joingc` guidance and group-control documentation.

## [1.10.14] - 2026-11-21

### Added
- Added owner-only private command `.joingc <url>` using Baileys `groupGetInviteInfo()` and `groupAcceptInvite()` with strict HTTPS `chat.whatsapp.com` host validation.
- New groups joined by the owner are persisted as muted by default, and `features.lastJoinedGroupId` records the target for the follow-up `.mute off` command.
- Added per-group mute overrides while preserving the existing global mute default. `.mute on/off` targets the last joined group; explicit Group JIDs and `all` scope are supported.
- Updated `.groupinfo` to display per-group active/mute status, global totals, and the origin of each group's mute setting.

### Fixed
- A newly joined group can be activated independently without enabling bot responses in all other groups.
- Per-group mute overrides and last-joined target are cleared when the bot is removed from that group.
- Added configuration schema v25 migration and validation for Group JID keyed mute state.

### Validation
- Added tests for official invite URL validation, owner/private command restrictions, join result persistence, default-muted behavior, per-group enable/mute, global override clearing, group inventory status rendering, and schema v25 migration.
- Full suite: 151 tests, 149 passed, 2 skipped, 0 failed; syntax check: 130 JavaScript files.
- Baileys API method usage follows its documented `groupGetInviteInfo(code)` and `groupAcceptInvite(code)` pattern.

## [1.10.11] - 2026-11-21

### Changed
- Removed systemd/cron installation requirements and external model-catalog timer scripts; discovery is now managed by the main Node.js lifecycle after `npm start`.
- Replaced 15-minute polling with a one-shot timer aligned to the persisted 24-hour deadline, plus hourly retry for transient provider catalogue outages. `npm start` now also launches a singleton detached Node.js worker that survives terminal closure and main-bot shutdown.
- API key additions/deletions trigger immediate metadata-only rediscovery; worker refreshes reload the key vault, and `.aimodels status` / `.aistatus` show worker PID, heartbeat, and next run.
- The detached worker uses an exclusive PID lock, 30-second heartbeat, and separate log; the next `npm start` recreates it after VPS downtime and catches up from the saved catalogue timestamp.

### Validation
- Syntax check: 122 JavaScript files checked.
- Offline suite: 132 passed, 2 skipped, 0 failed (134 total).
- Detached-worker smoke test: worker remained alive after its launcher exited, wrote PID/heartbeat status, and cleaned up its lock on SIGTERM.
- Provider catalog tests use mocked endpoints; live provider credentials and inference still require verification on the target host.

## [1.10.10] - 2026-11-21

### Added
- Added authenticated model-list discovery for Groq, Gemini, DeepSeek, and OpenAI, with no inference prompt or output-token use during catalog refresh.
- Added a 24-hour autonomous scheduler, dedicated atomic catalogue database (`data/ai-model-catalog.json`), 30-snapshot history, and cross-process refresh lock.
- Added independent systemd service/timer installer with cron fallback, so catalogue refresh continues when the WhatsApp bot and terminal are stopped while the host remains powered on.
- Added owner controls `.aimodels status/refresh` and `.aiset free-only on/off`; safe default allows only models intersecting the documented free-tier allowlist.
- Added provider-specific current free/paid policies, model recommendation selection, Gemini `generateContent` filtering, and stale last-known-good retention for temporary catalog outages.

### Fixed
- Provider-wide network/timeout/5xx errors, 429 quota/rate limits, 402 balance errors, and malformed/unsupported model requests now stop same-provider key fan-out and advance to the next provider. Only key-specific authentication failures keep rotating sibling keys.
- Corrected HTTP 402 classification to `insufficient_balance`; DeepSeek's 402 is a balance issue, not model deprecation.
- Standalone catalog refresh skips the main JSONL event journal so the independent systemd process cannot race the application's single-writer database.
- Fixed schema migration ordering by applying schema v24 after migrations v11–v22; existing user-configured provider priority is preserved.

### Validation
- Syntax check: 121 JavaScript files checked.
- Offline suite: 127 passed, 2 skipped, 0 failed (129 total).
- Model discovery and fallback tests use mocked provider APIs; live provider credentials and inference still require verification on the target host.

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

## [1.10.26] - 2026-11-23

### Changed
- Re-audited official provider model IDs, pricing, free-tier eligibility, and rate-limit documentation. Model-list visibility is no longer treated as proof of free access or inference health.
- Groq free-plan routing now selects only the verified `openai/gpt-oss-120b` primary for this deployment; Gemini `gemini-3.8-flash` remains a documented free-tier secondary. DeepSeek and OpenAI remain excluded from free-only routing because their published inference APIs are usage-priced.
- Added policy version and research timestamp to the persisted model catalog. Unknown or merely visible models cannot be auto-promoted into free-only routing.
- Added Groq-specific request compaction (18,000 input characters) and 2,048 output-token cap to mitigate the observed 8K TPM pressure; default requested output budget reduced from 32,768 to 4,096 tokens.
- HTTP 429 TPM/RPM events now receive short rate-limit cooldowns instead of being mislabeled as daily quota exhaustion. HTTP 503 remains a transient provider capacity/network failure, not an invalid model/key signal.
- AI provider exhaustion remains silent to the requesting user. The owner receives one compact private maintenance report; provider diagnostics are not echoed into other users' chats.

### Validation
- Provider/model catalog, free-only routing, TPM fitting, provider error classification, and fallback tests: 20 passed, 0 failed.
- Syntax check: 184 JavaScript files.
- Official references and observed-log diagnosis: `docs/AI_MODEL_CATALOG.md`.


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

## [1.10.26] - 2026-11-23

### Changed
- Re-audited official provider model IDs, pricing, free-tier eligibility, and rate-limit documentation. Model-list visibility is no longer treated as proof of free access or inference health.
- Groq free-plan routing now selects only the verified `openai/gpt-oss-120b` primary for this deployment; Gemini `gemini-3.8-flash` remains a documented free-tier secondary. DeepSeek and OpenAI remain excluded from free-only routing because their published inference APIs are usage-priced.
- Added policy version and research timestamp to the persisted model catalog. Unknown or merely visible models cannot be auto-promoted into free-only routing.
- Added Groq-specific request compaction (18,000 input characters) and 2,048 output-token cap to mitigate the observed 8K TPM pressure; default requested output budget reduced from 32,768 to 4,096 tokens.
- HTTP 429 TPM/RPM events now receive short rate-limit cooldowns instead of being mislabeled as daily quota exhaustion. HTTP 503 remains a transient provider capacity/network failure, not an invalid model/key signal.
- AI provider exhaustion remains silent to the requesting user. The owner receives one compact private maintenance report; provider diagnostics are not echoed into other users' chats.

### Validation
- Provider/model catalog, free-only routing, TPM fitting, provider error classification, and fallback tests: 20 passed, 0 failed.
- Syntax check: 184 JavaScript files.
- Official references and observed-log diagnosis: `docs/AI_MODEL_CATALOG.md`.


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

## v1.10.7 — Owner confirmation during provider outage
- Keep single-provider Groq routing; never fall back to another AI vendor.
- If the workload assessor is unavailable, use local deterministic heuristics and require an explicit owner reply confirmation instead of silently denying all non-hard-blocked work.
- Every suspicious workload now requires confirmation even if an AI assessment recommends ALLOW.
- Confirmation is private-chat only, sender-bound, quoted-message-bound, one-time, expires after 120 seconds, and records a SHA-256 command hash.
- Hard-block rules for destructive OS/disk commands remain non-overridable.
- Flag direct process introspection, dynamic require, and WhatsApp socket send/relay calls for confirmation.

## v1.10.9 — Ordered AI provider fallback

### Added
- Added a shared AI provider-chain router used by chat generation and the owner Workload Assessor.
- Exhaust every currently eligible key in the active provider's key array for key-specific 401/403/429 failures before moving to the next provider in the configured order.
- Added automatic fallback across Groq, Gemini, DeepSeek, and OpenAI using the exact `.aiset order` priority list.
- Added provider-attempt, skip, failure, and success checkpoints. Workload assessments also persist provider checkpoints with a source hash rather than the raw submitted code.
- Added schema v22 migration from the previous Groq-only default to the ordered provider chain while preserving non-default owner-configured provider order.

### Fixed
- Fixed AI restart recovery so provider routing checkpoints do not overwrite and lose the original queued job/messages payload.
- Provider-wide network/timeout/5xx errors and malformed model/request errors now move to the next provider without wasting time retrying the same payload against every key.
- `.aiset speed` no longer silently resets the configured provider order or limits the number of quota-affected keys tried.

### Validation
- Added tests proving all Groq keys are attempted on quota exhaustion before Gemini succeeds, providers without keys are skipped, and queued jobs remain recoverable after provider checkpoints.

## [1.10.12] - 2026-11-21

### Added
- Transactional source update batches for bulk folder copy/replace, with a 4.2-second quiet window, write-finish stabilization, revision fencing, dual snapshots, bounded five-minute batch window, and JavaScript syntax validation before applying any update.
- Plugin-only updates now use a shadow registry and a single synchronous swap; core-source/dependency changes request one controlled process handoff. Auto Git Sync is paused during source writes and does not push syntax-rejected batches.
- Atomic single-instance lock with PID/start-time/token validation. The replacement process waits for the previous owner to release the lock before loading a second WhatsApp socket.
- Code Lab/Quick Tunnel handoff: a healthy detached Cloudflared process and public URL are retained across controlled hot reloads; watchdog protocol v2 follows owner.json and can transfer between main-process PIDs.
- Autonomous host CLI preflight for Git, Python 3, Go, Bash, Cloudflared, and container runtimes on supported Linux package managers when non-interactive privileges are available. Host state is fingerprinted and cached to avoid repeated installation on every code reload.
- `.env.example` restored for clean source/ZIP installation and documented the minimum first-run path.

### Fixed
- Prevented watcher flush races that could clear filesystem events arriving during snapshot validation and restart from a partial folder copy.
- Rejected JavaScript syntax errors without replacing the active runtime or pushing rejected source through Auto Git Sync.
- Replaced legacy Code Lab watchdogs that pin the old parent PID; protocol-v2 watchdogs can be reused during handoff without spawning duplicates.
- Fixed the Docker bootstrap PID-file check so `/proc/<pid>/cmdline` is opened only after the PID is numeric, greater than 1, and confirmed alive.
- Host bootstrap failures now schedule an in-process retry rather than waiting for a manual restart.

### Validation
- Transactional hot reload, single-instance locking, host-preflight, and Code Lab tunnel handoff regression tests passed in the v1.10.12 development baseline.


## [1.10.13] - 2026-11-21

### Added
- Added failure-safe Code Lab handoff rollback. If a controlled replacement cannot complete, the old process restores gateway ownership and re-adopts the existing healthy Cloudflare tunnel only after the replacement process has stopped. A dedicated integration test simulates a process-identity mismatch and verifies the old gateway resumes.
- Validate the replacement PID and Linux process start ticks before closing the Code Lab gateway or transferring tunnel ownership. For first upgrades from a legacy watcher with no lock file or handoff environment marker, the new process identifies its direct parent `src/index.js` and waits for it to exit before opening the WhatsApp socket.
- Force one updated host preflight when files under `scripts/bootstrap/` are included in a source update batch; normal code reloads continue to reuse the host preflight cache.

### Fixed
- Prevented a failed or unverifiable replacement PID from leaving Code Lab closed.
- Ensure a rollback does not take over a tunnel while another verified owner PID remains alive.
- Updated source hot-reload documentation to describe the full transactional watcher scope and the plugin-asset/core restart policy.

### Validation
- JavaScript syntax: 127 files checked.
- Full test suite: 148 tests, 146 passed, 2 skipped, 0 failed.
- Code Lab tunnel handoff integration test: passed; replacement adopted the same tunnel PID and URL without starting a duplicate Cloudflared process.

## [1.10.16] - 2026-11-21

### Added
- Replaced the manually maintained `.menu` command list with a live snapshot of the active plugin registry. Added/removed/reloaded plugins now appear in the next menu without editing a second list.
- Added command `usage` metadata for argument-taking plugins, including `.test <type> [args]` and `.apikey <add|delete|list|get> <provider> [value]`.
- Added a branded Ocha Lidya AI / Nexora menu banner asset and a compact command-registry summary widget (plugin count, category count, prefix mode, and bot mode).
- Expanded user profiles with current and best daily activity streaks, daily XP remaining, and milestone achievements; upgraded the profile card layout.

### Fixed
- Manual plugin reload now builds a complete shadow registry and swaps it atomically. Removed plugin files are removed from the registry, failed replacements retain the previous valid plugin when available, and duplicate plugin command names are rejected.
- Profile streaks use Asia/Jakarta calendar days, do not increase more than once per day, reset after a missed day, and do not appear active when the last interaction is older than yesterday.
- The menu no longer uses a hard-coded command list, preventing owner commands such as `.test` and `.apikey` from being omitted.

### Validation
- Added menu-renderer tests for live plugin metadata, argument placeholders, duplicate command names, prefix/mode widgets, and the master-console block.
- Added profile tests for consecutive-day streaks, missed-day reset, daily XP capacity, and SVG escaping.


## [1.10.18] - 2026-11-21

### Added
- Per-group rental subscriptions with Mini, Standard, and Pro 30-day plans and shared rolling 24-hour workload-weighted quotas.
- Customer package selection, invoice generation, QRIS/e-wallet/SeaBank instructions, customer payment reporting, and owner-only manual payment approval/rejection.
- Owner rental console for tenant/order inspection, quota usage, audit history, price/quota adjustments, manual activation/suspension, and term extension.
- Autonomous lifecycle scheduler for invoice expiry, quota rollover, subscription expiry, 48-hour grace, reminder delivery, and group suspension.
- Payment QR asset supplied by the owner and native-flow registry support for list, reply, CTA, flow, address, call, and commerce payload families.
- One hundred-feature rental capability catalog distinguishing delivered functionality from roadmap work.

### Changed
- Rental invoice terms are snapshotted at creation so later package price/quota updates do not alter pending invoices.
- Order, payment, approval, quota, and scheduler writes are serialized per tenant to avoid duplicate billing and state races.
- Failed group-mute side effects retry without writing redundant configuration events every scheduler cycle.
- Raw low-level `sock.relayMessage()` payloads are left untouched; `sendInteractive` validates only registered native-flow payloads and retains text fallback.

### Safety
- QRIS is static and payment reports never activate service automatically. Owner must verify settlement before approval. Screenshots are not treated as proof of settlement.
- Automatic payment webhooks, dynamic QRIS, refund/reversal, and payment-provider reconciliation are not included without authorized gateway credentials.

## v1.10.28 — Part 3: Stateful Game Engine

- Added a real Tic-Tac-Toe plugin with `.ttt`, `.tictactoe`, and `.xo` commands.
- Added deterministic Minimax opponent, legal move validation, win/draw detection, surrender, status, and restart controls.
- Persisted every accepted game transition in the player's encrypted User Vault journal.
- Added private-chat natural-language routing for game invitations and numeric moves; group game sessions remain disabled to avoid shared-state ambiguity.
- Added fail-closed behavior when User Vault integrity/authentication checks fail.
- Added regression tests including exhaustive legal human move sequences against Minimax.


## v1.10.29 — Master workload warning controls
- Added owner-only `.master warning status|on|off|compact|detailed` and `.master review status|on|off`.
- Added native-flow CTA Copy for one-time `CONFIRM CODE`, plus explicit confirm/cancel quick replies.
- Warning-off suppresses notification only; suspicious code is silently blocked and audit-logged.
- Review-off disables AI semantic assessment while retaining local heuristics, confirmations, and hard-blocks.
- Scoped private-chat `sock.relayMessage(m.chat, ...)`/`sock.sendMessage(m.chat, ...)` no longer triggers a blanket warning; arbitrary recipients and group sends remain flagged.


## v1.10.30 — NADI operational self-state heartbeat

### Added
- Integrated the uploaded AC-Kernel NADI v2 component under `src/consciousness/ac/` and started it as a private Python child process from the main Node.js runtime.
- Added a JSON-lines stdio protocol; no additional HTTP listener or API key duplication is required.
- Added a one-second heartbeat, periodic snapshot persistence, clean shutdown, and supervised restart after unexpected sidecar exit.
- Injected NADI runtime telemetry into the existing Nexora system prompt so the current Groq/Gemini/DeepSeek/OpenAI provider chain remains the only chat-generation service.
- Added owner-only `.nadi status|on|off|pulse|sleep|verify` controls.
- Added consent-first social autonomy policy helpers: member opt-in and group-admin approval are required for any future proactive introduction; ignored recipients are not pursued.

### Safety and privacy
- NADI does not receive raw WhatsApp messages, JIDs, or private account memories. The global kernel stores operational telemetry only; private conversations remain in each user's encrypted vault.
- Heartbeat does not initiate outgoing WhatsApp messages, call the provider chain every second, or grant command permissions.
- Angry, guilt-based, random-member, and repeated no-response messaging is explicitly prohibited.
- NADI is documented as an operational self-state architecture, not subjective consciousness or sentience.

### Fixed
- Calibrated homeostatic rates for a 1 Hz wall-clock heartbeat; disabled per-tick sleep consolidation to avoid excessive cycles and disk writes.
- Snapshot writes are batched every 60 pulses and flushed on clean shutdown.

### Validation
- Python component self-test: 5/5.
- One-hour simulated heartbeat: 3,600 ticks; energy and thermal load remained inside calibrated ranges; no user events were written to the global ledger.
- JavaScript syntax: 195 files checked.
- NADI sidecar integration test: start, heartbeat advance, hash-chain verification, and clean shutdown passed.

## v1.10.32 — External NADI GitHub source binding

- Bound the external NADI loader to `razzaqinspires/artificial-consciousness-component` at immutable commit `16c2fa6e1b500745f260bcf091284a6e18726883` (NADI 2.1.0).
- Kept all NADI Python source outside the Ocha source tree; the loader downloads the repository archive to the external component cache.
- Hardened ZIP layout normalization for GitHub-generated archive roots and versioned NADI release-folder wrappers.
- Added focused tests for configured repository/ref, safe offline failure, and unchanged Ocha fallback behavior.
- Preserved NADI data directory and HTTP sidecar API contract.

## v1.10.39 — Quoted AI, Test Lab, Auto Reaction
- Harden WhatsApp quoted-message extraction across wrapped message payloads and record privacy-safe quote diagnostics.
- Prevent generic greeting-only AI output from replacing the response to a quoted turn; add a contextual clarification guard.
- Replace manual message test setup with an owner-only interactive `.test` catalog backed by local fixtures in `assets/message-test/`; successful tests are silent in chat apart from the actual test payload, while failures are recorded in runtime logs.
- Add an owner-only interactive `.react` manager; command reactions use ⏳ → ✅, AI replies use 💭 → ✅, failures use ❌, and the feature remains disabled until the owner enables it.
- Track deferred AI turn/checkpoint writes and flush them during graceful shutdown to protect private conversation persistence.
- Align legacy test expectations with the current 60-second XP cooldown and the 2,048-token Groq free-tier output cap.
- Update configuration migration tests to schema v37.


## v1.10.40 — Quoted AI, Message Test Lab, Auto Reaction

- Hardened quoted-message context preservation and generic greeting suppression for quoted AI turns.
- Added deterministic contextual fallback for the quoted “Coba lihat sirkuitmu” example; it distinguishes the software runtime from physical hardware.
- Refined owner-only `.test` delivery logging: result IDs when present, errors with test IDs, and no verbose chat-side relay report.
- Added aggregate test result IDs and failure propagation so a failed test can end with the failure reaction.
- Kept local message-test fixtures under `assets/message-test/`.
- Added owner-only `.react` settings for global command and AI processing reactions; default remains disabled until owner activation.


## v1.10.41 — YouTube selection and pagination fix

- Preserve the matched command alias for the YouTube plugin while retaining canonical plugin identity for permission, rental quota, and cooldown policy. This fixes `.ytmp3` / `.ytmp4` native-flow selections being routed back into `.yts` search.
- Render YouTube results as text-only carousel cards with no thumbnail uploads.
- Show five search results per page and append a final **Hasil berikutnya** quick-reply card when more results are available.
- Add sender/chat-bound, expiring pagination sessions and bounded yt-dlp search offsets.
- Add regression tests for alias dispatch, selection row IDs, text-only carousel structure, next-page quick reply, and pagination session isolation.
- Validation: syntax check passed for 231 JavaScript files; full suite passed 300 tests with 2 skipped and 0 failures.

## v1.10.44 — ACIE Part 2: Runtime Isolation & Provider Orchestration

- Restored the missing external `universal-adapter.js` module referenced by the Part 1 intake pipeline.
- Added `acie-json-stdio-v1` adapter descriptors, bounded input/output normalization, and strict provider/contribution binding.
- Added Docker/Podman sandbox process runner using argv only, digest-pinned images, no network, read-only source mount, non-root identity, dropped capabilities, no-new-privileges, resource limits, timeout, and bounded output.
- Added runtime engine/image probe and owner-only `.acie runtime status|probe`.
- Routed provider execution through the internal sandbox runner; caller-provided executor callbacks are no longer used.
- Kept provider activation fail-closed until governance, adapter, sandbox, integrity, output-contract and owner authorization gates pass.
- Added Part 2 runtime, adapter and provider-routing documentation and tests.
- Generic runner supports CLI-style JavaScript, Python, Go, PHP, Java source-launch, and Bash entrypoints. TypeScript/Rust remain discovery-only pending dedicated build adapters.
- Production container execution was not tested in this environment because Docker/Podman is not installed; runtime remains unavailable by default.
