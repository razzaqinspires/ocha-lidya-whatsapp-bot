# Ocha Lidya AI Engine — v1.10.0

## Public identity

The public AI identity exposed in chat is **Nexora-2.0-Flash**. Provider and upstream model identifiers are internal routing details. The engine instructs the assistant not to disclose provider/model vendor names, and a direct question such as “kamu menggunakan model apa?” receives the fixed identity response. The product creator is a separate public identity: Arifi Razzaq, under Razzaq Ventures, configured through the non-secret allowlist in `bot.ownerName`, `bot.creatorName`, `bot.organization`, and `bot.publicCreatorDisclosure`. This is a product identity/abstraction layer; it does not mean every upstream provider is literally running a model named Nexora.

## Providers and default order

Qwen has been removed from provider configuration, routing, and the `.env.example` template. The remaining default priority route is Groq → Gemini → DeepSeek → OpenAI. A custom `.aiset order` changes priority only; any remaining configured provider is still appended and attempted. Only configured providers are considered. Current default upstream model IDs are configurable in `src/config.js`; the public identity remains Nexora-2.0-Flash.

| Provider | Default upstream model ID | Credential |
|---|---|---|
| Groq | `openai/gpt-oss-20b` | `GROQ_API_KEY` |
| Gemini | `gemini-3.8-flash` | `GEMINI_API_KEY` |
| DeepSeek | `deepseek-flash` | `DEEPSEEK_API_KEY` |
| OpenAI | `gpt-6-luna` | `OPENAI_API_KEY` |

Model availability and account entitlement can change. The provider's authenticated API response is the authoritative check for a particular key. Official catalog references: [Groq models](https://console.groq.com/docs/models), [Gemini model support](https://firebase.google.com/docs/ai-logic/models), [DeepSeek model list](https://api-docs.deepseek.com/api/list-models/), and [OpenAI API models](https://developers.openai.com/api/docs/models).

## API key manager

The owner-only `.apikey` command manages multiple keys per provider:

```text
.apikey add gemini AQ.xxx_xxx1,AQ.xxx_xxx2
.apikey list gemini
.apikey get gemini <fingerprint>
.apikey delete gemini <fingerprint>
```

`add` accepts comma-separated values. `list` and `get` never reveal the full secret: they show a masked key and a SHA-256-derived fingerprint. `get` returns detailed counters, status, last error, HTTP status, and retry time. `delete` removes keys managed in the local vault; keys supplied through `.env` must be removed from `.env` manually. Keys that were already added to the vault are not copied into JSONL configuration or logs.

Managed keys are stored in `data/secrets/provider-keys.json`, with directory/file permissions restricted to the current OS user (`0700`/`0600` where supported). This is access-control hardening, not encryption. Protect the host and encrypt backups. Do not share the file or the raw key as a WhatsApp message. Environment variables remain supported; multiple keys can be separated by comma, semicolon, or newline.

## Key validation and classification

The provider manager rotates eligible keys fairly using a per-provider round-robin cursor. The default Boost profile attempts up to three eligible keys per provider; Fast uses two and Balanced uses up to four. A successful request ends attempts for that provider for the current job. A successful request proves that the key worked for that request, not that it has unlimited quota. Every attempt increments the hit counter before the network request and writes an append-only `ai.key.event` event. Counters are reconstructed from the JSONL event history after restart.

| Observed response | Classification | Retry policy |
|---|---|---|
| HTTP 200 with non-empty output | `active` | Eligible immediately |
| HTTP 401 | `expired` when the provider explicitly says expired; otherwise `invalid` (revoked, malformed, or unauthorized) | Probe again after 6 hours |
| HTTP 403 with quota/billing indicators | `daily_limit` | Probe at provider `Retry-After` when supplied; otherwise use next UTC day boundary + 5 minutes as a fallback heuristic |
| HTTP 403 explicitly reporting expiry | `expired` | Probe again after 6 hours |
| HTTP 403 without quota/expiry indicators | `forbidden` (permission/project restriction) | Probe again after 1 hour |
| HTTP 429 with daily/quota indicators | `daily_limit` | Probe at provider `Retry-After` when supplied; otherwise use next UTC day boundary + 5 minutes as a fallback heuristic |
| HTTP 429 without daily/quota indicators | `rate_limited` | Probe at `Retry-After` when supplied; otherwise after 30 seconds |
| HTTP 400 | `request_or_model_error` | Does not prove key invalid; stop retrying other keys for the same malformed request and fall back |
| HTTP 5xx, timeout, network error | `provider_error` | Probe after 15 seconds |
| Other/unclassified response | `error` | Probe after 1 minute |

Important: API providers do not expose one universal “key expired” endpoint or universal daily-quota field. The engine infers status from authenticated request responses, response text/status codes, and `Retry-After` when present. The UTC reset estimate is only a fallback heuristic; actual quota reset clocks are provider-specific. It deliberately does not label a 400 model/payload error as an invalid key. Provider-side quota messages vary, so some 403/429 responses may be classified conservatively as `forbidden` or `rate_limited`. The owner can inspect the exact recorded reason and retry time using `.apikey list` / `.apikey get` and `.aistatus`.

The key counters include total hits, successes, failures, and reported token usage where the provider returns usage metadata. Token usage may be unavailable or differently defined by an upstream API; in that case it remains zero rather than being estimated.

## Fallback and maintenance

1. The engine obtains the configured provider order and its key inventory.
2. Each provider rotates to the next eligible key on subsequent requests; Boost attempts up to three keys, Fast two, and Balanced up to four when earlier keys fail.
4. The configured total deadline stops later fallback attempts once its budget is exhausted, preventing cumulative provider timeouts from growing without bound.
5. If every configured provider/key is unavailable, the AI subsystem enters persisted maintenance mode.
6. While maintenance is active, generative AI requests receive no reply. Local deterministic identity, greeting, conversation-recall, and profile responses remain available without provider calls.
7. The owner receives one private report with per-provider/per-key masked identity, fingerprint, hit/success/failure counters, status, reason, last HTTP status, and retry time.
8. Subsequent AI requests re-evaluate keys whose retry time has elapsed. If a key/provider recovers, AI resumes and maintenance is cleared. If none has recovered, the subsystem stays silent and does not spam the owner with repeated reports.

This is response-driven validation, not a guaranteed external expiry detector. A key can be valid but have no balance, lack model permission, or be temporarily rate-limited. Those conditions are reported separately where the provider response makes the distinction possible.

## Owner controls

- `.aistatus` — AI maintenance state, route, per-provider inventory, total hits, token usage, success/failure counts, and per-key status.
- `.apikey add <provider> <key1,key2>` — add managed keys.
- `.apikey list <provider>` — list masked keys and status.
- `.apikey get <provider> <fingerprint>` — detailed status for one key.
- `.apikey delete <provider> <fingerprint>` — delete a managed key.
- `.aiset on` / `.aiset off` — enable/disable AI.
- `.aiset speed boost` — low-latency profile: 3.5 s per provider, 14 s overall deadline, up to three round-robin key attempts/provider, 180 output tokens, 3 history turns, and 80 ms coalescing.
- `.aiset speed fast` — balanced low-latency profile: 4.5 s/provider, 20 s deadline, 220 output tokens, 4 history turns, and 120 ms coalescing.
- `.aiset speed balanced` — longer generation and wider key retry allowance.
- `.aiset order groq,gemini,deepseek,openai` — set provider order.
- `.aiset model <provider> <model-id>` — override an upstream model ID.
- `.aiset identity on/off` — allow or suppress public disclosure of creator and organization identity.
- `.profile` — display XP, level, role, rank, and interaction progress.

## Runtime notes and limitations

- Requests use Node's built-in `fetch`; no provider SDK is required.
- Provider adapters currently use non-streaming chat requests.
- The response-critical path no longer waits for AI job checkpoints, conversation-turn journaling, or provider hit/success telemetry writes. Those records are queued to the append-only journal in the background; in-memory conversation history and reply anchors are updated immediately. Disk failures are logged and do not delay the current user response.
- The default profile is Boost after schema v12 migration. Only known shipped defaults are migrated; custom owner timeout/output values are preserved. The v1.10.0 migration sets up to three attempts per provider and rotates fairly among eligible keys to avoid repeatedly selecting the same key.
- A provider may reject a model ID even when the API key itself is valid; that is recorded as a request/model issue, not an invalid key.
- The engine can only count calls made through this bot. It cannot report API-key hits made by other applications or direct dashboard/API calls.
- Total token counts are based on usage fields returned by the provider. Missing usage metadata is not fabricated.
- Maintenance and key-event history are persisted in the append-only JSONL database. The raw managed key vault is separate from the JSONL database.


## Quoted AI reply chains and command-session priority (v1.7.0)

The message dispatcher uses two distinct quoted-reply lanes:

1. **Command screen lane:** before ordinary command parsing and AI detection, the dispatcher checks whether the incoming message quotes an active command screen. The session is identified by the quoted message ID plus chat ID, bound to the sender who opened it, and consumed once a valid choice is selected. Invalid choices stay in the command lane and return the screen's instruction instead of reaching AI. The default session TTL is 10 minutes; sessions are memory-only and are lost on process restart.
2. **AI answer lane:** in groups, a quoted reply activates AI only when the quoted message ID is registered as a message previously sent by the AI engine. A reply to a bot command, menu, or generic system notice is not treated as an AI reply. Direct private-chat messages remain conversational by default; active command sessions still take priority.

AI answer anchors are persisted as `ai.reply.anchor` records and connect each response to its parent AI job. Startup warms this anchor index before the WhatsApp socket begins accepting messages, avoiding a race where an early quoted group reply could be misclassified. The engine walks the parent chain from root to the quoted answer, then appends the current user reply. The configured bounds are **8 AI answer levels** and **12,000 characters** of accumulated prior context. The quoted message text is also included as a separate reference, capped at 2,500 characters. When the maximum depth is reached, a new answer starts a new bounded branch while still receiving the immediate quoted text. This keeps the prompt bounded and prevents unrelated chat messages or command output from being merged into the chain.

Recovered AI jobs also register a quote anchor after the recovery response is sent. If a send operation does not return a WhatsApp message ID, the answer can still be delivered but cannot become a future quoted-chain anchor. Older bot messages sent before this feature was deployed do not automatically have an AI anchor; new AI answers create them from v1.7.0 onward.


## Public identity, conversation familiarity, and user profiles (v1.10.0)

The AI prompt receives only an allowlisted public identity object; it never receives the raw application config or API-key vault. The default public creator disclosure is **Arifi Razzaq** under **Razzaq Ventures**. The owner is verified against the configured WhatsApp PN identity in application code; a user cannot become owner by claiming so in chat. `.aiset identity on/off` controls whether the creator identity may be disclosed publicly. The `.about` response and `.owner` contact card use the same configured identity fields.

Simple greeting-only messages and creator/model identity questions are answered by a local policy layer before provider routing. Greeting variants rotate so a repeated `halo` does not return one fixed sentence. These deterministic responses remain available during provider maintenance.

Each AI participant has a separate persistent profile in the append-only JSONL repository. Eligible AI interactions award 5 XP, with a 10 XP first-active-day bonus and a 100 XP daily cap. Duplicate WhatsApp message IDs cannot award XP twice. Level thresholds use `50 * level * (level - 1)` cumulative XP. Ranks progress at levels 1/5/10/20/35/50/75: Iron, Bronze, Silver, Gold, Platinum, Diamond, and Mythic.

Relationship role is an application familiarity tier, not a claim that the AI has human emotions: Pengunjung, Kenalan, Teman Ngobrol, Teman Akrab, and Sahabat Digital. The owner has the fixed role Owner & Creator. The engine stores aggregate interaction counts, active days, and broad communication-style counters; it does not store raw user messages in the profile record. `.profile` displays XP, level, rank, role, progress, and interaction history. It renders a PNG card when optional `sharp` is available and falls back to a text card otherwise.

## Owner identity and configuration disclosure

The AI engine does not infer owner status from prompt text, push names, profile memory, or earlier turns. The message pipeline resolves the sender from Baileys PN fields or a verified Baileys LID mapping. For continuity, only mappings that resolve to the configured owner PN are persisted in `data/owner-lid-map.jsonl` with mode `0600`. The dispatcher recalculates authorization before command execution.

Configuration inspection is a deterministic backend route, not an LLM tool. A verified owner may request a complete non-secret configuration snapshot only in a private chat. Sensitive keys are recursively redacted, credential-like values and passwords embedded in database URLs are filtered, and selected environment-secret names expose only a configured/not-configured flag. The snapshot is not added to AI history. Requests for `.env`, API-key values, tokens, passwords, session credentials, or private keys are refused even for the owner; those values must be inspected locally on the VPS and are never passed to the model. Non-owner requests receive a deterministic denial.
