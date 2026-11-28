# AI Provider Registry Audit — Ocha Lidya v1.10.60

> Static source audit plus deterministic mocked-protocol tests. No ChatNivo credentials were supplied or read and no live provider endpoint was probed.

## Primary Nexora chat providers

| Provider ID | Model default         | Protocol                           | Secret             | Role            |
| ----------- | --------------------- | ---------------------------------- | ------------------ | --------------- |
| `groq`      | `openai/gpt-oss-120b` | OpenAI-compatible chat completions | `GROQ_API_KEY`     | Primary order 1 |
| `gemini`    | `gemini-3.8-flash`    | Gemini `generateContent`           | `GEMINI_API_KEY`   | Primary order 2 |
| `deepseek`  | `deepseek-flash`      | OpenAI-compatible chat completions | `DEEPSEEK_API_KEY` | Primary order 3 |
| `openai`    | `gpt-6.2-sol`         | OpenAI-compatible chat completions | `OPENAI_API_KEY`   | Primary order 4 |

Primary provider keys retain existing bounded key rotation, quota classification, cooldown and fallback behavior. No primary model/provider contract was modified for ChatNivo.

## ChatNivo final fallback adapter

| Field               | Value                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Adapter             | `src/integrations/chatnivo/inference.js`                                                        |
| Router integration  | `src/ai/providers.js::generateWithFallback()`                                                   |
| Inventory identity  | `chatnivo` (separate final-fallback row; not added to primary `providerNames` or API-key vault) |
| Auth                | Account email/password → `POST /api/v1/auths/signin` → in-memory Bearer session token           |
| Model discovery     | `GET /api/v1/models`                                                                            |
| Inference           | `POST /api/chat/completions` with `stream: false`                                               |
| Credentials         | `CHATNIVO_EMAIL`, `CHATNIVO_PASSWORD` in `.env`                                                 |
| Non-secret settings | `baseUrl`, `modelId`, `fallbackEnabled` in `config/runtime.json`                                |
| Fallback position   | After all configured Ocha primary providers have been attempted/skipped/failed                  |
| Remote status       | `NOT_VERIFIED`                                                                                  |

The contribution itself does not implement generation. It contains account login and personal chat-history export routes only. The inference adapter is a separate Ocha integration using an Open WebUI-compatible request/response shape. Official Open WebUI documentation describes an OpenAI-compatible `POST /api/chat/completions` endpoint and Bearer authentication, but that documentation does not establish that the specific ChatNivo deployment exposes or authorizes the same API. The adapter therefore reports only local eligibility until actual login, model discovery and completion succeed.

### Activation conditions

1. Configure `CHATNIVO_EMAIL` and `CHATNIVO_PASSWORD` in the private `.env`.
2. Use `.chatnivo models`; choose `.chatnivo model <id>` when multiple models are returned.
3. Keep `chatnivo.fallbackEnabled` true (or use `.chatnivo fallback on`).
4. First live use must successfully authenticate, list/select a model and return a non-empty completion. No successful live probe has been recorded in this source workspace.

When no model ID is configured, automatic selection is allowed only if exactly one remote model is returned. MFA/extra authentication is not bypassed. The session token is never persisted or included in telemetry. Requests are bounded and use HTTPS.

### Fallback semantics

- ChatNivo is not a primary provider and does not participate in primary API-key rotation.
- It runs only after the complete primary Ocha chain has been exhausted, including configured providers that have no usable key or fail with quota, authorization, request, network or server errors.
- The same normalized messages and bounded generation budget are passed to the final adapter. A successful result is tagged `provider: chatnivo`, `fallbackUsed: true`, and `fallbackReason: all_primary_providers_exhausted`.
- If ChatNivo fails, its safe classification is added to `providerErrors` and the router raises `ALL_PROVIDERS_EXHAUSTED`.
- If the shared AI deadline has less than one second remaining, ChatNivo is skipped rather than extending the job beyond its budget.

### Validation

- `test/ai-provider-fallback.test.js`: 6/6 passed, including simulated Groq+Gemini HTTP 429 quota exhaustion followed by ChatNivo signin, model discovery and completion.
- `test/chatnivo-integration.test.js`: contribution SHA manifest, owner/private command descriptor and missing-credential gate passed 3/3.
- The tests use a mocked `fetch`; they verify local routing/protocol handling only. Remote ChatNivo API health, model entitlement, MFA flow, rate limits and terms of service are not verified.

## Environment/configuration separation

- One shared `GITHUB_PAT` authenticates the two isolated Ocha and AC Git publication lanes. It must be scoped to both named repositories only.
- Non-secret operational settings now live in `config/runtime.json`. Old `OCHA_*` environment overrides remain for compatibility and are classified as `runtime-config-override`; they are not standard `.env` settings.
- `.env` remains for provider API keys, GitHub PAT, ChatNivo credentials, optional Roo encryption key and optional NADI Bearer token.
- `OCHA_ROO_MASTER_KEY` must be 64 hexadecimal characters if supplied; otherwise Roo creates and protects a local 32-byte key under `data/roo/.master-key`.
- `OCHA_NADI_API_TOKEN` is an optional Bearer secret for a remote NADI HTTP API. It is not required for the default local loopback sidecar.

## ACIE provider registry remains separate

ACIE contribution providers are capability-specific, governed, sandboxed and activated through the ACIE provider registry. ChatNivo final chat completion is a Nexora AI Service fallback, not an ACIE capability provider. It is not registered in `contributions/registry/providers.json` and must not be described as such.
