# Ocha AI Engine

## Trigger contract

- Private chat: every non-empty message that is not command-prefixed can invoke AI.
- Group chat: AI responds only when WhatsApp metadata explicitly mentions the bot JID, or the incoming message quotes a message authored by the bot. No ambient group listening.
- A message beginning with an active command prefix is command intent. Unknown prefixed commands do not fall through to AI. In prefix mode `none`, a registered plugin command is executed; otherwise natural-language text can invoke AI.
- Master console syntax is handled before AI and remains owner-only.

Mention validation compares WhatsApp `mentionedJid` against the bot's actual session JIDs. It does not synthesize a phone-number JID from an LID. Reply validation uses the serializer's quoted-message author metadata.

## Providers and default order

The default order is Gemini → Groq → Qwen → DeepSeek → OpenAI. Only providers with configured credentials are attempted. The order and model IDs are persistent non-secret settings in `src/config.js` / JSONL config events.

| Provider | Default model ID | API credential | Notes |
|---|---|---|---|
| Gemini | `gemini-3.6-flash` | `GEMINI_API_KEY` | Native Gemini `generateContent` adapter; free-tier availability and quota are account/region dependent. |
| Groq | `openai/gpt-oss-120b` | `GROQ_API_KEY` | OpenAI-compatible Chat Completions endpoint; official model catalogue lists this model. |
| Qwen | `qwen3.8-flash` | `QWEN_API_KEY` | Alibaba Model Studio OpenAI-compatible endpoint; free quota is not universal: Alibaba documents eligibility restrictions (including China/Beijing region, identity verification, and a 90-day validity period) for its new-user quota. |
| DeepSeek | `deepseek-flash` | `DEEPSEEK_API_KEY` | OpenAI-compatible endpoint; API usage is paid unless the account has promotional balance. |
| OpenAI | `gpt-6-luna` | `OPENAI_API_KEY` | OpenAI API usage is billed; do not assume ChatGPT subscription includes API credits. |

Model IDs are defaults, not a promise that a given key/region/account has access. Update them with `.aiset model <provider> <model>` after checking the provider's live model catalogue.

## Credential arrays

Each provider accepts one or more API keys in its environment variable, separated by commas, semicolons, or newlines. Keys rotate across attempts. Example (local `.env` only):

```dotenv
GEMINI_API_KEY=key_one,key_two
GROQ_API_KEY=key_one;key_two
QWEN_API_KEY=
DEEPSEEK_API_KEY=
OPENAI_API_KEY=
```

Never store keys in JSONL config, database events, source code, command arguments, or logs. `.env` is excluded by `.gitignore`.

## Failover and resilience

1. Read provider order and model IDs from persistent config.
2. Skip providers without keys.
3. Persist an `ai.job.checkpoint` before/after provider attempts.
4. Retry transient errors (timeout, rate limit, server errors) and authentication-key rejection once per provider by default. Each retry rotates to the next configured key.
5. Continue to the next provider after a provider failure.
6. A small in-memory circuit breaker pauses a provider for 60 seconds after repeated transient failures.
7. Persist user/assistant turns as append-only `ai.turn` events. Conversation history is isolated by chat JID + sender JID.
8. On reconnect, queued/incomplete jobs are retried and delivered as a recovery message. Delivery is at-least-once if the process crashes between WhatsApp send and the final checkpoint; exactly-once delivery cannot be guaranteed by the WhatsApp send API.

Checkpoint events store prompt/history and provider attempt metadata in the local JSONL database. Do not enable AI for untrusted group traffic beyond the explicit mention/reply gate.

## Owner controls

- `.aistatus` — provider readiness, model IDs, key count, circuit state (never reveals keys).
- `.aiset on` / `.aiset off` — enable/disable AI.
- `.aiset order gemini,groq,qwen,deepseek,openai` — configure fallback order.
- `.aiset model groq openai/gpt-oss-120b` — override one model ID.

## Environment setup

Copy `.env.example` to `.env`, then configure at least one provider key. For a free-first setup, begin with Gemini and Groq, subject to current account quotas. Qwen may have limited introductory quota for eligible accounts. DeepSeek and OpenAI should be treated as paid APIs unless the provider account explicitly shows promotional credits.

## Operational limits

- This engine uses Node's built-in `fetch`; no additional provider SDK is required.
- Calls are non-streaming in this release.
- Provider request/response formats differ; adapters normalize them to `{ text, usage, model, provider }`.
- Conversation history is local and event-sourced. It is not cross-device synchronization.
- Free quotas and model availability change. Verify the account's live provider console before production use.

## Live provider references checked 18 November 2026

- Google Gemini model catalogue: <https://ai.google.dev/gemini-api/docs/models>
- Google Gemini API pricing/free tier: <https://ai.google.dev/gemini-api/docs/pricing>
- Groq model catalogue: <https://console.groq.com/docs/models>
- Groq rate limits: <https://console.groq.com/docs/rate-limits>
- Alibaba Model Studio Qwen rate limits: <https://www.alibabacloud.com/help/en/model-studio/rate-limit>
- Alibaba Model Studio introductory free quota and eligibility: <https://help.aliyun.com/en/model-studio/new-free-quota>
- DeepSeek API model and pricing: <https://api-docs.deepseek.com/quick_start/pricing>
- OpenAI API pricing: <https://developers.openai.com/api/docs/pricing>

Google's live catalogue currently lists Gemini 3.6 Flash as a stable model and its pricing page shows a limited free tier. Free tier data may be used to improve Google's products. Groq publishes model-specific limits; actual limits depend on account plan and are visible in the account console. Alibaba's free quota is conditional (including region and new-account eligibility), time-limited, and not a general unlimited allowance. OpenAI and DeepSeek API use should be treated as metered/paid unless the account explicitly displays promotional credit.

## Live provider references checked 18 November 2026

- Google Gemini model catalogue: https://ai.google.dev/gemini-api/docs/models
- Google Gemini API pricing/free tier: https://ai.google.dev/gemini-api/docs/pricing
- Groq model catalogue: https://console.groq.com/docs/models
- Groq rate limits: https://console.groq.com/docs/rate-limits
- Alibaba Model Studio Qwen rate limits: https://www.alibabacloud.com/help/en/model-studio/rate-limit
- Alibaba Model Studio introductory free quota and eligibility: https://help.aliyun.com/en/model-studio/new-free-quota
- DeepSeek API model and pricing: https://api-docs.deepseek.com/quick_start/pricing
- OpenAI API pricing: https://developers.openai.com/api/docs/pricing

Google's live catalogue currently lists Gemini 3.6 Flash as a stable model and its pricing page shows a limited free tier. Free tier data may be used to improve Google's products. Groq publishes model-specific limits; actual limits depend on account plan and are visible in the account console. Alibaba's free quota is conditional (including region and new-account eligibility), time-limited, and not a general unlimited allowance. OpenAI and DeepSeek API use should be treated as metered/paid unless the account explicitly displays promotional credit.
