# AI and ACIE Provider Registry Audit — Ocha Lidya v1.10.51

> Source inventory derived from `src/config.js` and `src/ai/providers.js`. Health and credential availability are intentionally **not** inferred from source code. No provider secrets or live telemetry are included in this report.

## Nexora chat-generation providers

| Provider ID | Default model identifier in source | Protocol               | Environment key name | Priority in default config |
| ----------- | ---------------------------------- | ---------------------- | -------------------- | -------------------------: |
| `groq`      | `openai/gpt-oss-120b`              | OpenAI-compatible      | `GROQ_API_KEY`       |                          1 |
| `gemini`    | `gemini-3.8-flash`                 | Gemini generateContent | `GEMINI_API_KEY`     |                          2 |
| `deepseek`  | `deepseek-flash`                   | OpenAI-compatible      | `DEEPSEEK_API_KEY`   |                          3 |
| `openai`    | `gpt-6.2-sol`                      | OpenAI-compatible      | `OPENAI_API_KEY`     |                          4 |

Defaults are configurable under `ai.providerOrder` and `ai.models`; values above identify what this snapshot configures, not an assertion that a provider currently serves or permits that model. Key values are read from environment or the private key vault `data/secrets/provider-keys.json`; reports must expose only masked values/fingerprints.

## Routing and fallback behavior

1. `src/ai/engine.js:executeWithFallback()` selects the configured provider order and applies the shared job deadline, input budget, token limits and checkpoints.
2. `src/ai/providers.js:generateWithFallback()` filters unavailable/cooling-down providers and attempts the remaining providers in configured order.
3. `generateWithProvider()` handles multi-key rotation. Key-specific authorization errors can advance to another key; provider-wide quota, billing, rate-limit and network/model failures are classified so keys are not pointlessly replayed.
4. `classifyProviderFailure()` distinguishes invalid/expired credentials, forbidden access, per-minute rate limits, daily quota, billing balance, request/model errors and transient server/network faults.
5. Provider outcome events and masked key metrics are persisted through the JSONL database. `getProviderInventory()` exposes status and metrics to owner controls.

Fallback must be considered separately from retry: key rotation is bounded to key-specific failure classes; provider fallback is the next compatible configured provider. A fallback cannot prove the original provider is healthy.

## ACIE contributed-provider registry (separate system)

ACIE providers are not the same registry as Nexora's four chat providers. `src/acie/registry/provider-registry.js` stores contributed capabilities and provider state. A provider begins quarantined and is not routable until license, attribution, source integrity, adapter review/test, protocol proof, sandbox approval, runtime probe, owner authorization, output-contract validation, and security gates pass. `src/acie/routing/provider-router.js` filters by capability/health/circuit/quota and allows fallback only for an idempotent operation with a classified retryable failure.

The runtime `contributions/registry/` and generated command state are deliberately absent from this archive. Consequently:

- No ACIE contributed provider can be asserted ACTIVE from this static archive.
- No live health, latency, circuit-breaker or quota value is claimed here.
- Default sandbox execution remains DENY and the runtime must be probed on the target host.
- The `image-canvas.render.text` capability from Rizkyrohan's contribution is an unverified candidate, not a working provider.

## Security and validation notes

- Do not read or print provider-key vault contents in diagnostics.
- Keep credentials in environment/private vault, never in `.env` distributed archives or public config snapshots.
- Provider source defaults and model catalogue discovery are not a live health check. Use `.aistatus`, `.aimodels status`, and `.acie provider list` only under their configured owner controls and inspect the actual runtime output.
- Source-level contract/tests exist in `test/ai-provider*`, `test/ai-engine*`, and ACIE provider/router tests; a full suite still requires the lockfile and installed dependencies, which are absent from this supplied archive.

## Function map

| Function                                      | File                                     | Responsibility                                         |
| --------------------------------------------- | ---------------------------------------- | ------------------------------------------------------ |
| `initializeProviderKeys`                      | `src/ai/providers.js`                    | Load vault and reconstruct key telemetry               |
| `reloadProviderKeyVault`                      | `src/ai/providers.js`                    | Reload key references without exposing values          |
| `classifyProviderFailure`                     | `src/ai/providers.js`                    | Classify permanent/transient provider errors           |
| `listProviderModels`                          | `src/ai/providers.js`                    | Fetch provider model metadata                          |
| `getProviderInventory`                        | `src/ai/providers.js`                    | Return masked status and metrics                       |
| `generateWithProvider`                        | `src/ai/providers.js`                    | Execute one provider with key rotation                 |
| `generateWithFallback`                        | `src/ai/providers.js`                    | Execute ordered multi-provider fallback                |
| `executeWithFallback`                         | `src/ai/engine.js`                       | Enforce AI-job provider order/deadline and telemetry   |
| `registerContribution` / `setProviderEnabled` | `src/acie/registry/provider-registry.js` | Persist quarantined contribution and govern activation |
| `routeProvider`                               | `src/acie/routing/provider-router.js`    | Route compatible ACIE provider and bounded fallback    |
