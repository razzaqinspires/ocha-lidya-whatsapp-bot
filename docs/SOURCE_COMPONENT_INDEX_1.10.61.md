# Source Component Index — Ocha v1.10.61

Ocha v1.10.61 integrates a preserved ChatNivo personal-exporter contribution, a separate final-inference fallback adapter, and secrets-only environment configuration. AC remains independently versioned at v2.1.1; only the paired compatibility marker advances. This is a source ZIP workspace without Git ancestry metadata.

| Component ID             | Component                                           | Source and key surfaces                                                                              | Contract / data flow                                                                                                                   | Status                                       |
| ------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `CHATNIVO-INTAKE-001`    | Immutable team contribution                         | `.private/contributions/chatnivo-personal-exporter-v1/original/`; `CONTRIBUTION_MANIFEST.json`       | 4 source files, SHA-256 verified; auth and chat-history export only; no inference SDK                                                  | PRESERVED / ANALYZED                         |
| `CHATNIVO-EXPORT-001`    | Personal chat exporter adapter                      | `src/integrations/chatnivo/exporter.js`                                                              | Owner-initiated child process; HTTPS; env allowlist; bounded stdout/stderr and 30-minute timeout; output under private local directory | ADAPTER_READY; remote export not live-tested |
| `CHATNIVO-INFERENCE-001` | ChatNivo completion adapter                         | `src/integrations/chatnivo/inference.js`                                                             | Sign-in → model catalogue → Open WebUI-compatible non-streaming completion; token only in process memory; validates non-empty output   | ADAPTER_READY; remote health NOT_VERIFIED    |
| `CHATNIVO-COMMAND-001`   | Owner control command                               | `src/plugins/owner/chatnivo.js`                                                                      | `.chatnivo status                                                                                                                      | models                                       | model | fallback | export`; owner-only/private-only; no aliases | REGISTERED; collision audit 0 |
| `NEXORA-FALLBACK-001`    | Final AI chain fallback                             | `src/ai/providers.js::generateWithFallback`, `src/ai/engine.js::executeWithFallback`                 | Executes after configured Groq/Gemini/DeepSeek/OpenAI order is exhausted, within shared request deadline                               | TESTED with mocked fetch                     |
| `RUNTIME-CONFIG-001`     | Non-secret config layer                             | `config/runtime.json`, `src/core/runtime-settings.js`                                                | NADI, kernel paths, private runtime, rental API, tooling and ChatNivo non-secret options; legacy env overrides remain compatible       | TESTED by env/config regression              |
| `GITHUB-CREDENTIAL-001`  | Shared GitHub PAT                                   | `GITHUB_PAT`, `src/core/auto-git-sync.js`, `src/core/ac-auto-git-sync.js`, `scripts/ac-git-setup.js` | One token for the two separately rooted repositories; token value never stored in config                                               | SOURCE UPDATED; remote access NOT_VERIFIED   |
| `PRIVATE-RUNTIME-001`    | Private Ocha runtime package                        | `.private/ocha-private-runtime/`                                                                     | Metadata synchronized to 1.10.60; original four private modules remain SHA-identical                                                   | INTEGRITY VERIFIED                           |
| `AC-NADI-001`            | Independent Artificial Consciousness/NADI component | `.private/artificial-consciousness-component/`                                                       | AC v2.1.1; NADI HTTP API v1; compatibility metadata 1.10.60 only                                                                       | EXISTING COMPONENT; paired metadata updated  |

## Contribution provenance

- Archive: `chatnivo-personal-exporter.zip`
- Archive SHA-256: `ac34de7143596773749f8e6df8e40e82fdd80fde5fd31b75284b31f7871b6644`
- Individual contributor name: not supplied; contribution was marked as internal team contribution.
- Source version: unversioned snapshot.
- License: no `LICENSE` or explicit terms were provided; redistribution/third-party use remains pending license confirmation.
- All four original files are verified against the intake manifest. Integration changes live in separate host-owned adapters; original source bytes are not patched.

## Secret/runtime settings

`.env` contains secrets only: four provider API keys, one shared `GITHUB_PAT`, ChatNivo account credentials, optional `OCHA_ROO_MASTER_KEY`, and optional `OCHA_NADI_API_TOKEN`. Non-secret runtime values are read from `config/runtime.json`. The supplied workspace's `.env` value contents were not printed in this index.

## Verification limits

No `.git` metadata, no authenticated WhatsApp session, no VPS connection, no ChatNivo credentials, and no live provider health probes were available. Static registry audit and fake-fetch tests do not establish live activation or remote availability.

| Component ID | Component                   | Source                                                   | Related modules                                                        | Tests                        | Status                                              |
| ------------ | --------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------- |
| AI-LLAMA-01  | Ollama preflight            | `scripts/bootstrap/llama-runtime.js`                     | `package.json` prestart/predev, `config/runtime.json#/llama`           | `test/llama-runtime.test.js` | IMPLEMENTED; host install unverified                |
| AI-LLAMA-02  | Local Llama adapter         | `src/ai/llama-runtime.js`                                | `src/ai/providers.js`, `src/index.js`                                  | `test/llama-runtime.test.js` | ADAPTER_READY; runtime dormant until final fallback |
| AC-MOOD-01   | Derived affect mood profile | `.private/artificial-consciousness-component/ac/rasa.py` | `ac/server.py`, `ac/bridge.py`, `src/runtime/consciousness-runtime.js` | AC `selftest.py`             | TESTED                                              |

## v1.10.61 additions

| Component ID | Component                   | Source                                                   | Related modules                                                        | Tests                        | Status                                      |
| ------------ | --------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------- | ------------------------------------------- |
| AI-LLAMA-01  | Ollama preflight            | `scripts/bootstrap/llama-runtime.js`                     | `package.json` prestart/predev, `config/runtime.json#/llama`           | `test/llama-runtime.test.js` | Implemented; host install unverified        |
| AI-LLAMA-02  | Local Llama adapter         | `src/ai/llama-runtime.js`                                | `src/ai/providers.js`, `src/index.js`                                  | `test/llama-runtime.test.js` | Adapter ready; dormant until final fallback |
| AC-MOOD-01   | Derived affect mood profile | `.private/artificial-consciousness-component/ac/rasa.py` | `ac/server.py`, `ac/bridge.py`, `src/runtime/consciousness-runtime.js` | AC `selftest.py`             | Tested                                      |

## v1.10.61 source additions

| Component ID       | Capability                                            | Source files                                               | Contract / integration                                                  | Validation                                          | Status        |
| ------------------ | ----------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- | ------------- |
| AI-LLAMA-BOOTSTRAP | Detect/install Ollama runtime without starting server | `scripts/bootstrap/llama-runtime.js`                       | npm `prestart`/`predev`; local Linux archive; macOS `OLLAMA_NO_START=1` | dry-run and syntax tests; live install not verified | IMPLEMENTED   |
| AI-LLAMA-INFERENCE | Local final-fallback generation                       | `src/ai/llama-runtime.js`                                  | Ollama `/api/tags`, `/api/chat`; `config/runtime.json#/llama`           | dormant lifecycle + ordering tests                  | ADAPTER_READY |
| AI-LLAMA-ROUTER    | Provider fallback after ChatNivo                      | `src/ai/providers.js`                                      | existing AI Service normalized messages and deadline                    | static order regression                             | TESTED        |
| AC-MOOD-PROFILE    | Derive mood index/status/dimensions/OCC percentages   | `.private/artificial-consciousness-component/ac/rasa.py`   | additive `AffectState.to_dict()` field; NADI HTTP API v1                | AC selftest 8/8                                     | TESTED        |
| AC-MOOD-PERCEPTION | Apply current user stimulus to affect appraisal       | `src/runtime/consciousness-runtime.js`, `src/ai/engine.js` | NADI `POST /v1/perceive`, sender-scoped, no raw stimulus persistence    | loopback integration                                | TESTED        |

The workspace still has no `.git` metadata. The AC v2.1.2 source is a local paired snapshot; its historical remote pin `16c2fa6e1b500745f260bcf091284a6e18726883` is not a commit for this modified local source.
