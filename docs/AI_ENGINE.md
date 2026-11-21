# Ocha Lidya AI Engine — v1.10.11

## Public identity

The public AI identity exposed in chat is **Nexora-2.0-Flash**. Provider and upstream model identifiers remain internal routing details. The public identity is an application abstraction; it does not mean every upstream provider is literally running a model named Nexora.

## Provider routing and failure classification

The default priority route is Groq → Gemini → DeepSeek → OpenAI. `.aiset order` changes the ordered chain; providers outside that list are never called. The router first checks whether a provider has credentials and eligible keys, then attempts its request. A successful, non-empty response ends the chain.

Key rotation is intentionally different from provider fallback:

- **401 / invalid credential:** key-specific. Try the next key in that provider's array.
- **403:** classify as permission, expiry, or quota based on the provider message; do not assume every 403 means the same thing.
- **429 / daily quota / account rate limit:** stop key fan-out and advance to the next provider. Replaying against sibling keys is wasteful when the quota is organization/account/project scoped.
- **402:** insufficient billing balance; stop the provider and advance. It is not a model-deprecation signal.
- **400 / 404 / 422:** request/model incompatibility; do not mark the key invalid and do not replay the same bad payload across sibling keys.
- **Timeout / network / 5xx:** provider-wide failure; record the checkpoint and advance immediately.

This distinction fixes a weakness exposed by the 21 November 2026 runtime log: nine Groq attempts with a network-level `fetch failed` should not fan out to nine different credentials. The router now makes one provider attempt for provider-wide faults and moves on. Account quota is also not multiplied by adding multiple keys to the same account or organization.

## Providers and free-tier policy (verified 21 November 2026)

| Provider | Preferred model when free-only is ON | Free access policy | Credential |
|---|---|---|---|
| Groq | `openai/gpt-oss-120b` | Free-plan limits are documented for GPT-OSS 120B/20B and Qwen 3.8 27B; quota is organization-level. | `GROQ_API_KEY` |
| Gemini | `gemini-3.8-flash` | Gemini 3.8 Flash is listed as free of charge on the Standard tier. Gemini 4 Carbon/Argon/Neon are paid-only in the current pricing document; older models are secondary only when still visible in the key's live model catalogue. | `GEMINI_API_KEY` |
| DeepSeek | `deepseek-flash` (paid mode only) | Current API pricing is token-billed; no zero-cost inference tier is documented in the checked pricing page. | `DEEPSEEK_API_KEY` |
| OpenAI | `gpt-6.2-sol` (paid mode only) | API usage is paid; current model documentation does not establish a free inference tier. | `OPENAI_API_KEY` |

Official references: [Groq model catalogue](https://console.groq.com/docs/models), [Groq rate limits](https://console.groq.com/docs/rate-limits), [Gemini models](https://ai.google.dev/gemini-api/docs/models), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [DeepSeek model list](https://api-docs.deepseek.com/api/list-models/), [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/), [DeepSeek error codes](https://api-docs.deepseek.com/quick_start/error_codes/), [OpenAI model catalogue](https://developers.openai.com/api/docs/models), and [OpenAI rate limits](https://developers.openai.com/api/docs/guides/rate-limits).

The provider model-list endpoint confirms which model IDs are visible to a particular API key. It does **not** expose a universal `isFree` field, prove that inference quota remains, or guarantee that an account's model permissions are active. The application therefore intersects the authenticated live catalogue with a conservative, documented free-model allowlist. New, unknown model IDs are never silently promoted into free-only routing; the allowlist needs an official pricing verification before they can be used. This avoids accidentally switching to a paid model.

## Autonomous model catalogue

`src/ai/model-catalog.js` queries the authenticated provider model-list API without sending an inference prompt:

- Groq: `GET /openai/v1/models`
- Gemini: `GET /v1beta/models` with pagination and `supportedGenerationMethods` filtering
- DeepSeek: `GET /models`
- OpenAI: `GET /v1/models`

The catalogue is persisted separately at `data/ai-model-catalog.json`. It stores provider model metadata, verified free-tier eligibility, recommended free/paid model IDs, timestamps, status, and up to 30 compact history snapshots. Raw API keys are never written; the listing adapter returns only metadata and an optional key fingerprint. The file is created with restrictive permissions and replaced atomically. A cross-process lock prevents concurrent scheduled refreshes.

The in-process scheduler and a singleton detached Node.js worker start automatically during `npm start`. The detached worker survives closing the terminal or stopping the main WhatsApp process while the VPS remains powered on. It refreshes when the catalogue is missing or overdue, schedules the next run from the persisted 24-hour deadline, and retries transient catalogue network outages hourly. `.apikey add/delete` requests an immediate refresh, and worker refreshes reload the vault from disk. The worker PID/heartbeat is stored in `data/ai-model-catalog-worker.json`; its log is `data/logs/ai-model-catalog-worker.log`. No systemd, cron, or installation command is required. If the VPS itself stops, the next `npm start` detects the stopped worker, starts it again, and catches up. The dedicated catalogue file avoids writes to the main single-writer event journal.

Owner commands:

```text
.aimodels status
.aimodels refresh
.aiset free-only on
.aiset free-only off
.aiset order groq,gemini,deepseek,openai
```

`free-only` defaults to ON. It limits runtime routing to Groq and Gemini models that exist in both the live provider catalogue and the documented free allowlist. When OFF, DeepSeek/OpenAI and their recommended paid models may enter fallback; billing is the owner's responsibility. A successful catalogue HTTP response proves that a key can list models, not that a model can complete inference or that free quota is still available. Newly listed chat models that are not covered by the policy appear in `.aimodels status` for review and are never auto-promoted to free routing. Runtime inference remains the final health signal.

The system does not create, purchase, scrape, or invent API keys. It uses only the owner-provided keys in environment variables and `data/secrets/provider-keys.json`. An account must be created and a credential issued by the provider's own console.

## API key manager

The owner-only `.apikey` command manages multiple keys per provider:

```text
.apikey add gemini AQ.xxx_xxx1,AQ.xxx_xxx2
.apikey list gemini
.apikey get gemini <fingerprint>
.apikey delete gemini <fingerprint>
```

`list` and `get` never reveal the full secret: they show a masked key and a SHA-256-derived fingerprint. Managed keys are stored in `data/secrets/provider-keys.json` with directory/file permissions restricted to the current OS user (`0700`/`0600` where supported). This is access-control hardening, not encryption. Environment variables remain supported; multiple keys can be separated by comma, semicolon, or newline.

## Provider checkpoints and maintenance

Before each provider attempt, the router persists an attempt checkpoint. It then persists skip/failure/success transitions as the request advances. Original queued job payloads are retained, so a restart during provider fallback can resume the job without losing its source messages. If every permitted provider is missing keys, has no eligible key, or fails, the subsystem enters maintenance and sends the owner a private status report. Local deterministic identity, greeting, and profile responses remain available while upstream AI is in maintenance.

Key counters and error classifications are reconstructed from the primary append-only JSONL event journal. The dedicated model catalogue never writes to that journal because the primary database is single-writer. Key status is response-driven, not a universal external key-expiry detector. A model-list request can validate catalog access, while an inference request is still needed to prove that a particular model can actually answer.

## Owner controls

- `.aistatus` — AI maintenance, provider route, per-key status, quota, counters, and catalogue timestamp.
- `.aimodels status` — latest provider catalogue, free-model candidates, recommendations, and refresh schedule.
- `.aimodels refresh` — force a catalogue refresh now.
- `.aiset free-only on/off` — enforce only documented free-tier models or allow paid providers.
- `.aiset order groq,gemini,deepseek,openai` — set provider priority.
- `.aiset model <provider> <model-id>` — set a configured model ID; automatic catalogue selection still chooses a verified free candidate when free-only is ON.
- `.aiset speed boost/fast/balanced` — tune request latency and output/context bounds.
- `.aiset identity on/off` — control public creator identity disclosure.
- `.apikey add/list/get/delete` — manage provider credentials without revealing full secrets.

## Runtime notes and limitations

- Requests use Node's built-in `fetch`; no provider SDK is required. Provider adapters currently use non-streaming chat requests.
- The 24-hour timer is independent from the WhatsApp process only after the installer is run on the host. It is not silently installed by bot startup because installation requires OS-level privileges.
- If a provider model disappears or is no longer supported by the API list, it is excluded from fresh catalogue recommendations. A last-known-good selection may be retained as stale for up to seven days when catalog access is temporarily unavailable; it is not treated as a fresh confirmation.
- Live API credentials and upstream inference were not testable in this build environment. Tests use simulated model-list and inference endpoints; verify the deployment with `.aimodels refresh` and a real message after installation.
- The default inference identity remains Nexora-2.0-Flash regardless of the upstream provider/model selected.

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
