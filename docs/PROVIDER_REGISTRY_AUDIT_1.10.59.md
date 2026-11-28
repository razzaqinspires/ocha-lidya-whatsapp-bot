# AI and ACIE Provider Registry Audit — Ocha Lidya v1.10.59

> Static source inventory only. No `.env`, provider-key vault values, credentials, health metrics, or live provider endpoints were read or probed.

## Nexora chat-generation providers

| Provider ID | Model identifier in `src/ai/providers.js` | Protocol               | Key name           | Default order |
| ----------- | ----------------------------------------- | ---------------------- | ------------------ | ------------: |
| `groq`      | `openai/gpt-oss-120b`                     | OpenAI-compatible      | `GROQ_API_KEY`     |             1 |
| `gemini`    | `gemini-3.8-flash`                        | Gemini generateContent | `GEMINI_API_KEY`   |             2 |
| `deepseek`  | `deepseek-flash`                          | OpenAI-compatible      | `DEEPSEEK_API_KEY` |             3 |
| `openai`    | `gpt-6.2-sol`                             | OpenAI-compatible      | `OPENAI_API_KEY`   |             4 |

The configured order/model values are source defaults from `src/config.js` and `src/ai/providers.js`; `ai.providerOrder` and `ai.models` are configurable. They do not establish that keys are set, accounts are active, a given model is offered, or an endpoint is reachable. Keys are loaded from environment values or `data/secrets/provider-keys.json`; diagnostics must expose only masked key identity and aggregate metrics.

## Nexora routing and fallback

- `src/ai/engine.js:executeWithFallback()` applies the configured provider order, shared job deadline, token/input budgets, checkpoint handling and telemetry.
- `src/ai/providers.js:generateWithFallback()` filters ineligible/cooling providers and tries configured candidates in order.
- `generateWithProvider()` handles bounded key rotation; `classifyProviderFailure()` separates invalid/expired credentials, forbidden access, per-minute throttling, daily quota, billing, request/model errors and transient network/server failures.
- Provider events and masked key metrics are persisted through Ocha's JSONL store; `getProviderInventory()` exposes inventory/status to owner controls.

Retry and provider fallback are not interchangeable. Key rotation is bounded to cases where another key may resolve a key-scoped fault; provider fallback moves to another configured compatible provider after a classified provider-level fault. Neither operation is a live health check. No retry policy should be generalized to non-idempotent contribution execution.

## ACIE contributed-provider registry — separate from Nexora

ACIE capability providers are not chat-generation providers. `src/acie/intelligence/capability-discovery.js` statically discovers candidate capabilities; it does not activate them. `src/acie/registry/provider-registry.js` stores provider records behind governance and integrity gates. `src/acie/routing/provider-router.js` selects a provider compatible with the capability contract and permits fallback only for explicitly idempotent tasks with a classified retryable error. Sandbox defaults remain deny/no-egress until configured and approved.

The supplied snapshot has no persisted `contributions/registry/providers.json`, `contributions/registry/commands.json`, or `generated-commands/index.json`. Therefore this report cannot confirm an active contributed provider, dynamic command, current health, circuit state, sandbox readiness or live fallback route. The Rizkyrohan Text Canvas capability candidate remains quarantined: license/asset rights and service contract are pending, execution authorization is not granted, and the source has not been executed.

## Capability discovery and command registration boundaries

- `src/acie/intelligence/interface-discovery.js`, `language-discovery.js`, `static-analysis.js`, and `capability-discovery.js` inspect interfaces and candidate capabilities without importing contributor code.
- `src/acie/command-engine/command-generation.js` checks existing public command descriptors and now applies the shared private-source policy so `.test` from the private runtime cannot collide with or be treated as a public descriptor.
- `src/acie/command-engine/runtime-commands.js` produces virtual descriptors only from eligible persisted command records; no persisted dynamic registry was supplied.
- `src/acie/response-engine/response-normalizer.js` validates normalized output; `src/acie/adapters/universal-adapter.js` and `legacy-whatsapp-bridge.js` provide host integration surfaces.

## Function map

| Function / surface                                 | File                                            | Role                                                              |
| -------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| `initializeProviderKeys`, `reloadProviderKeyVault` | `src/ai/providers.js`                           | Load provider key references without printing secrets             |
| `classifyProviderFailure`                          | `src/ai/providers.js`                           | Classify retryable/permanent provider errors                      |
| `generateWithProvider`, `generateWithFallback`     | `src/ai/providers.js`                           | One-provider request, key rotation and ordered provider fallback  |
| `executeWithFallback`                              | `src/ai/engine.js`                              | Enforce AI job order, budget/deadline and telemetry               |
| `discoverCapabilities`                             | `src/acie/intelligence/capability-discovery.js` | Static candidate capability discovery                             |
| `registerContribution`, `setProviderEnabled`       | `src/acie/registry/provider-registry.js`        | Persist quarantined contribution and govern activation            |
| `routeProvider`                                    | `src/acie/routing/provider-router.js`           | Capability-compatible routing and idempotent-only fallback        |
| `scanExistingPluginCommands`                       | `src/acie/command-engine/command-generation.js` | Static collision scan, excluding private-only plugin source paths |

## Validation limits

No key values were inspected. No `.env` values were read. No provider HTTP requests, model-list calls, VPS audits or sandbox probes were executed. This audit must not be interpreted as provider `ACTIVE` or `HEALTHY` status; check the live operator instance via the owner-restricted controls and `npm run ops:audit-runtime` after deployment.
