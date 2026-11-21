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

- **Groq:** current Free Plan Limits documentation lists `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, and `qwen/qwen3.8-27b`. Rate limits apply to the organization, not individual users; many keys on one organization do not create separate quotas.
- **Gemini:** current pricing documentation lists `gemini-3.8-flash` as free of charge in the Standard tier. The Gemini 4 Carbon, Argon, and Neon models are not available on the Free tier. Older free-tier candidates remain secondary only when still listed by the authenticated model API. Free-tier data may be used to improve Google's products; do not send confidential business data through a free-tier key without reviewing Google's terms.
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
