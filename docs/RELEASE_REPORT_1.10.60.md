# Release Report — Ocha Lidya v1.10.60

**Date:** 2026-11-28  
**Paired component:** Artificial Consciousness Component / NADI v2.1.1  
**Input:** supplied Ocha source ZIP plus `chatnivo-personal-exporter.zip` contribution  
**Input Ocha ZIP SHA-256:** `3ffeb819d647af8e6f797c653c085539e2b1e81c72327a93c9048b69697a965b`  
**Git ancestry:** unavailable in both extracted source workspaces; no commit or push is claimed.

## Release summary

Ocha v1.10.60 adds a private owner ChatNivo control/export command, a separately implemented and explicitly gated final AI completion fallback, a centralized non-secret runtime configuration file, and a secrets-only `.env.example`. The original ChatNivo contribution remains byte-for-byte preserved in the private contribution vault. The independent AC v2.1.1 Python implementation is unchanged; only its Ocha compatibility marker is paired with v1.10.60.

## ChatNivo contribution intake

- Original archive: `chatnivo-personal-exporter.zip`.
- Archive SHA-256: `ac34de7143596773749f8e6df8e40e82fdd80fde5fd31b75284b31f7871b6644`.
- Four original files are stored under `.private/contributions/chatnivo-personal-exporter-v1/original/chatnivo-personal-exporter/` and verified against the intake manifest:
  - `.env.example` — 208 bytes — `deaed05c4ad6767950943c19ff979654ed8f960515092d28fd115b98b48e474c`
  - `.gitignore` — 28 bytes — `2091f8dd47cd6369fb894767a09d88a1fed7ebd22aca25ffdfe8dbe0909b49aa`
  - `README.md` — 1,190 bytes — `2e3ecaa56a2d443e376da279693305ca3ce3f55f4a37d57df0540c95297465a4`
  - `chatnivo-exporter.mjs` — 6,311 bytes — `c9ab4315e054a8a1364ba699695234444f4d702f76ee91fe757a2aeca44a6a56`
- The contribution implements ChatNivo account signin and personal chat-history retrieval/export. It does not contain an inference SDK, completion route, prompt contract, or streaming implementation.
- Individual contributor name was not provided. No `LICENSE` or explicit license terms were included; redistribution rights beyond this private operator bundle remain pending confirmation.
- The original exporter source was not executed during intake. The host wrapper runs it only on an explicit owner `.chatnivo export` command, with an environment allowlist and bounded execution.

## ChatNivo host integration

- `src/integrations/chatnivo/exporter.js` provides a local owner-triggered export wrapper; export files are written under `data/private/chatnivo-exports`. Exported chat contents are not sent back to WhatsApp.
- `src/plugins/owner/chatnivo.js` registers `.chatnivo` as `ownerOnly` and `privateOnly`, with no aliases. Supported subcommands: `status`, `models`, `model <id>`, `fallback on|off`, `export`.
- `src/integrations/chatnivo/inference.js` implements a separate inference adapter: account signin, model discovery, then non-streaming `/api/chat/completions`, with bounded requests and in-memory session token handling.
- The AI router invokes ChatNivo only after the complete Groq → Gemini → DeepSeek → OpenAI primary route has been exhausted. It is not inserted into primary key rotation or the ACIE contribution provider registry.
- The contributed exporter itself is not the basis for AI inference. The completion adapter assumes an Open WebUI-compatible deployment contract. That API shape is documented by Open WebUI, but the actual ChatNivo service deployment has not been live-probed; this is not evidence that the ChatNivo account or deployment authorizes the same API.
- No ChatNivo credentials were present in this workspace, so remote sign-in, model discovery, completion, rate limits, MFA, terms and health remain `NOT_VERIFIED`. Local configuration only makes the adapter eligible for a future probe; it does not mean provider health is `ACTIVE`.

### Owner command

```text
.chatnivo status
.chatnivo models
.chatnivo model <model-id>
.chatnivo fallback on
.chatnivo fallback off
.chatnivo export
```

The command is owner-private only and rejects group use. `.chatnivo export` is explicit and writes local export output; it does not message the exported conversations to a chat.

## Environment and configuration

- Consolidated `AC_GITHUB_PAT` into the shared `GITHUB_PAT` after confirming that the supplied values were identical. Secret values are not reproduced here. Both Ocha and AC publishing helpers now read the shared variable, while keeping their repositories isolated.
- `.env` was retained as a secrets-only file and set to owner-only file mode. Its current keys are the four AI API keys, `GITHUB_PAT`, ChatNivo email/password, optional `OCHA_ROO_MASTER_KEY`, and optional `OCHA_NADI_API_TOKEN`. `AC_GITHUB_PAT` is absent.
- `.env.example` contains empty secret placeholders only. The environment inventory was regenerated; it reports 9 secret settings, 4 internal markers, and 23 host/OS names. Eleven dynamic environment accesses remain unresolved by static analysis and are reported in `docs/ENVIRONMENT_VARIABLES.md`.
- User-listed non-secret settings were moved to `config/runtime.json`: NADI repository/ref/path/update/port/heartbeat and optional runtime paths; kernel dashboard/telemetry and Roo paths; private runtime flags/paths; rental API host/port/tunnel/binary; Prettier and bootstrap tooling; ChatNivo base URL, model selection and fallback enablement.
- Legacy `OCHA_*` overrides remain supported for backwards compatibility but are classified as runtime-config overrides, not recommended `.env` entries. Empty optional config paths use code defaults.
- `OCHA_ROO_MASTER_KEY` remains an optional secret override for Roo User Vault encryption. When omitted, Roo uses a local protected 32-byte key file under `data/roo/.master-key`. Changing a manually supplied key after encryption can make existing data undecryptable.
- `OCHA_NADI_API_TOKEN` remains an optional Bearer secret for a remote NADI HTTP API. It is not required for the default local loopback sidecar.

## Static command and provider audit

- 49 plugin JavaScript files scanned; 48 command descriptors found; 89 aliases; 137 normalized identifiers; zero static name/alias collisions.
- `.chatnivo` appears as owner-only/private-only and has no aliases.
- Static descriptor audit excludes dynamic ACIE-generated and private-runtime commands; runtime collision checks remain the enforcement point for those sources.
- Primary providers remain Groq, Gemini, DeepSeek and OpenAI. ChatNivo is a separately identified final fallback only.

See `COMMAND_REGISTRY_AUDIT_1.10.60.md`, `PROVIDER_REGISTRY_AUDIT_1.10.60.md`, and `SOURCE_COMPONENT_INDEX_1.10.60.md`.

## Validation results

| Check                                                              |                                                        Result |
| ------------------------------------------------------------------ | ------------------------------------------------------------: |
| Focused Ocha integration/regression group                          |                                40 passed, 0 failed, 1 skipped |
| ChatNivo intake hash, owner/private descriptor and credential gate |                                      included above; 3 passed |
| AI fallback routing suite                                          |                                      included above; 6 passed |
| Environment inventory tests                                        |                                            6 passed, 0 failed |
| JavaScript syntax check                                            |                                              313 files passed |
| Markdown/link validation                                           |                     96 Markdown files; all local links passed |
| Publication audit                                                  | passed; 429 public paths inspected, 63 private paths excluded |
| Private runtime integrity                                          |                         4/4 immutable source modules verified |
| AC Python selftest                                                 |                                                    6/6 passed |
| AC isolation/bridge suite                                          |                                                    5/5 passed |
| AC extended suite                                                  |                                                  10/10 passed |
| AC Python compilation                                              |                                                        passed |

The one skipped Ocha test requires the Baileys peer dependency, which was not installed in this workspace. Environment inventory tests passed 6/6, including strict `.env.example` synchronization. The static scanner still reports 11 unresolved computed environment accesses for follow-up review; these are not hidden by the generated report. The complete Ocha suite was not claimed as passing. Tests use deterministic mocks for ChatNivo; no real ChatNivo or primary provider endpoint was contacted. No authenticated WhatsApp session or VPS connection was available.

## Release and operational status

- Source release: `BUILT` and archive content/hash checked.
- Contribution original: `PRESERVED`; source integrity verified.
- ChatNivo exporter adapter: `ADAPTER_READY`; live export not tested.
- ChatNivo inference adapter: `ADAPTER_READY`; remote health `NOT_VERIFIED`; activation requires owner credentials, model discovery and successful live completion.
- `.chatnivo` command: `REGISTERED` in source; runtime activation requires plugin loader and owner credentials on host.
- Ocha/AC GitHub sync: `NOT_VERIFIED`; no `.git` checkout or authenticated GitHub operation was available.
- VPS/WhatsApp runtime activation: `NOT_VERIFIED`.

The Ocha operator bundle contains ignored private source and contribution vault material. It is intended for controlled local operator installation and must not be uploaded to a public GitHub repository. Keep `.env`, live data, sessions and runtime state outside the release ZIP.
