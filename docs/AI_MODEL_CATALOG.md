# Autonomous AI Model Catalogue — v1.10.11

## Purpose

The catalogue keeps Ocha's internal upstream model IDs current without changing the public Nexora identity. On each refresh it asks every configured provider for the model IDs visible to the stored credentials, filters Gemini to models that support `generateContent`, intersects the result with a conservative free/paid policy, and stores the recommendations. It does not send inference prompts or consume completion tokens.

## Storage and timing

The current snapshot and up to 30 compact historical snapshots are stored in `data/ai-model-catalog.json`. This file is separate from the main JSONL event journal because that journal is single-writer. Snapshot writes are atomic; a lock file prevents concurrent refreshes.

The scheduler is started automatically from `src/index.js` whenever `npm start` runs. The application starts its in-process scheduler and launches a singleton detached Node.js worker. The worker has an exclusive PID lock, a 30-second heartbeat, and an independent process lifecycle. It survives closing the interactive terminal or stopping the main WhatsApp process while the VPS remains online. It performs a refresh when the catalogue is missing or overdue, then schedules the next run for the persisted 24-hour deadline. A provider catalogue network outage is retried hourly. Adding or deleting API keys through `.apikey` triggers immediate rediscovery in the main process; every worker refresh reloads the vault from disk.

The worker writes its status to `data/ai-model-catalog-worker.json` and its log to `data/logs/ai-model-catalog-worker.log`. `.aimodels status` and `.aistatus` show its active state, PID, heartbeat, and next run. No systemd unit, cron entry, installer script, or manual refresh command is required.

A local process cannot execute while the VPS itself is powered off. When the bot next runs `npm start`, it checks the worker PID/heartbeat, starts a replacement if needed, and catches up from the saved catalogue timestamp. `.aimodels refresh` remains an optional owner-requested immediate refresh, not a setup requirement.

## Start and inspect

Run the bot normally:

```bash
npm start
```


## What is and is not automatic

The provider catalogue APIs return model IDs and model metadata, not a universal free-tier flag. Free-tier status is therefore based on checked official pricing/rate-limit documentation and a curated allowlist. The machine automatically discovers models visible to each supplied key every 24 hours and selects the newest preferred model that is both listed by the provider and in the verified free-tier policy. Unknown models are never auto-promoted into free-only routing because doing so could incur a charge. The live model catalogue is autonomous; `.aimodels status` reports newly listed chat models that are not yet classified by the free/paid policy. Free-tier eligibility remains a conservative policy gate and is not guessed from model names or a successful model-list response; new IDs must be verified against official pricing documentation before they can enter free-only routing.

The system uses only keys the owner already provides via `.env` or `data/secrets/provider-keys.json`; it cannot create accounts, mint API keys, bypass free-tier quota, or infer a provider's private billing state. A successful model-list request validates permission to read the catalog, not remaining inference quota. A real generation request is still needed to prove that the model can answer.

## Provider policy checked 21 November 2026

- **Groq:** `openai/gpt-oss-120b` is the only automatically selected primary for this deployment. Free-plan access is account/tier/limit dependent; the model has published usage pricing on the Developer tier and should not be described as universally free. Rate limits apply to the organization, not individual API keys; adding keys does not multiply the shared organization TPM quota.
- **Gemini:** current pricing documentation lists `gemini-3.8-flash` as free of charge in the Standard tier. It remains the secondary free-tier candidate. A temporary 503/high-demand response is a service-capacity problem, not evidence that the model ID is incompatible. Free-tier data may be used to improve Google's products; do not send confidential business data through a free-tier key without reviewing Google's terms.
- **DeepSeek:** current API pricing lists `deepseek-flash` and `deepseek-v4-pro` with per-token prices. Its error table defines 401 as authentication failure and 402 as insufficient balance.
- **OpenAI:** the API model catalogue lists GPT-6.2 Astra, GPT-6.2 Sol, GPT-6.1 Terra, and GPT-6 Luna; these are paid API models. No free API inference tier is assumed.

## Official references

- https://console.groq.com/docs/models
- https://console.groq.com/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/pricing (redirects to the current Google AI Studio pricing catalogue)
- https://api-docs.deepseek.com/api/list-models/
- https://api-docs.deepseek.com/quick_start/pricing/
- https://api-docs.deepseek.com/quick_start/error_codes/
- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/guides/rate-limits

## Provider compatibility audit — 23 November 2026 (v1.10.26)

The catalog now records a versioned policy (`policyVersion: 2`, `policyResearchedAt: 2026-11-23`). The authenticated `/models` endpoint is treated only as an inventory of IDs visible to a key; it is never treated as evidence that a model is free, compatible with chat generation, or currently healthy.

- **Groq primary:** `openai/gpt-oss-120b` remains the only automatically selected primary model for this deployment. Groq's current production catalog lists GPT-OSS 120B and 20B; the current rate-limit documentation lists 8,000 TPM / 1,000 RPD for GPT-OSS 120B on the documented Developer-plan table. The model itself is usage-priced on the Developer tier ($0.15/1M input and $0.60/1M output); free-plan access is governed by account tier/limits and must not be described as a universally free model. The bot therefore labels this as free-plan access subject to account quotas, not “free model”.
- **Gemini secondary:** `gemini-3.8-flash` is an official model ID and Google currently documents a free tier for Standard API usage. The observed HTTP 503 “high demand” response is a transient provider capacity failure, not evidence of an invalid model ID or key. Keep this as the secondary free-tier candidate, subject to project-specific quota and availability.
- **DeepSeek:** `deepseek-flash` and `deepseek-v4-pro` are valid current API model names, but the published API pricing is per token. They are excluded from `freeOnly` routing. HTTP 401 means the particular key is unauthorized/invalid; it is not a model-catalog mismatch.
- **OpenAI:** `gpt-6.2-sol` is a valid current API model ID, but the API is paid. It is excluded from `freeOnly` routing. A 429 daily/quota event is billing/quota state, not a model-name mismatch.

### Error diagnosis from the supplied runtime log

1. Groq's `openai/gpt-oss-120b` was recognized by the provider and accepted far enough to return HTTP 429. The supplied error explicitly says `tokens per minute (TPM)`, `Limit 8000`, `Used 2741`, `Requested 5445`. This is request-size / TPM pressure, not model incompatibility. v1.10.26 caps the default requested output at 4,096 tokens and applies a Groq-specific 18,000-character input budget plus a 2,048-token output cap. This is a conservative mitigation, not a guarantee against concurrent requests sharing the same organization quota.
2. Gemini's `gemini-3.8-flash` returned HTTP 503 with a high-demand message. This is a provider-side capacity incident. The key is not marked invalid and the model is not silently replaced with an invented ID.
3. DeepSeek's two HTTP 401 results indicate invalid/unauthorized keys. Its model catalog names are not the cause of those 401 responses.
4. OpenAI's HTTP 429 events are quota/daily-limit states. Its model IDs remain paid and are not included in the free-only route.

### Error classification and fallback rules

- HTTP 429 with TPM/RPM/per-minute wording becomes `rate_limited` with a short retry window; it is not mislabeled as a daily quota exhaustion.
- HTTP 429 with explicit daily/account quota wording becomes `daily_limit` and honors `Retry-After` where supplied.
- HTTP 503/5xx becomes `provider_error`; it does not invalidate a key or model ID.
- HTTP 401 becomes key-specific `invalid`; HTTP 403 is split between revoked/invalid, quota, and permission errors using the provider response.
- HTTP 400/404/422 is a request/model compatibility error and does not prove the API key is invalid.
- In `freeOnly` mode, DeepSeek and OpenAI remain excluded even when keys exist. Provider discovery cannot promote unknown IDs into the free route.

When every eligible provider fails, the user-facing AI lane remains silent. The owner receives one compact private maintenance report; provider errors are not echoed to the requesting chat. The report is not a reply to the user's request.

## Official sources

- Groq supported models: https://console.groq.com/docs/models
- Groq rate limits: https://console.groq.com/docs/rate-limits
- Groq billing FAQ: https://console.groq.com/docs/billing-faqs
- Groq model deprecations: https://console.groq.com/docs/deprecations
- Gemini model/pricing catalogue: https://ai.google.dev/gemini-api/docs/models and https://ai.google.dev/gemini-api/docs/pricing
- DeepSeek model pricing: https://api-docs.deepseek.com/quick_start/pricing/
- OpenAI model catalogue: https://developers.openai.com/api/docs/models
