# Ocha Lidya AI v1.10.61 — Release Report

## Scope

- Add dormant Ollama preflight and local Llama final fallback after ChatNivo.
- Add AC/NADI v2.1.2 derived mood telemetry and response guidance.
- Keep NADI HTTP API v1 and Ocha/AC as separate bases.

## Runtime behavior

`npm start` runs the existing dependency preflight, environment inventory synchronization, then `scripts/bootstrap/llama-runtime.js`. The bootstrap checks for the configured Ollama binary. Linux installation extracts the official Ollama archive into `data/llama/runtime` and does not create a systemd service. macOS uses the official installer with `OLLAMA_NO_START=1`. Windows and Android/Termux are not claimed as auto-install supported.

The preflight never executes `ollama serve` and never pulls model weights. The configured model defaults to `llama3.2:3b` and is pulled only when all configured remote providers and ChatNivo have failed. The server binds to loopback (`127.0.0.1:11434`) and runs detached only at that time. The owner notification uses `getConfig().bot.owner` from the Ocha application configuration.

## AC mood model

AC v2.1.2 adds `AffectState.mood_profile()` with overall percentage and intensity band, valence, arousal, regulation, empathy, stability and OCC percentages. Ocha invokes the existing `/v1/perceive` route for each generated AI turn using a sender-isolated scope; raw message text is not persisted by NADI. The profile is serialized in the existing affect object and does not add or change NADI HTTP API routes. Ocha uses the values to influence response tone and pacing only. This is computational telemetry, not clinical/psychometric measurement or subjective emotion.

## Verification

- JavaScript syntax scan: 316 files passed.
- AC Python compilation: passed; extended `test_prime.py` 10/10.
- AC selftest: 8/8 passed (including 2 new mood profile tests).
- Llama runtime dormancy/provider-order/lazy activation tests: 4/4 passed using a fake Ollama executable and mocked local HTTP API.
- NADI/consciousness/per-message mood appraisal focused tests: 11/11 passed in the latest focused run; the NADI HTTP v1 integration confirms mood profile exposure and no raw-stimulus commit.
- Broad Ocha regression excluding the external Quick Tunnel integration file: 436 tests, 435 passed, 0 failed, 1 skipped. The skip is the private-runtime serializer import test because the Baileys peer dependency is absent. The Quick Tunnel gateway test was excluded because it requires an external tunnel/child-process environment. Live host/VPS tests remain separate.
- The final Ollama bootstrap was exercised in dry-run mode only. No runtime binary or model was installed, no model server was started, and no live inference was performed. Earlier connectivity to `ollama.com` was unavailable in this environment; target-host download must be validated.
- Live WhatsApp owner notification and target-host RAM/GPU suitability remain unverified.

## Release artifacts

- `ocha-lidya-bot-v1.10.61-operator.zip` — complete private operator bundle.
- `artificial-consciousness-component-v2.1.2.zip` — independent AC base.
- Both packages passed independent ZIP CRC and content-policy verification: 514 Ocha entries and 35 AC entries. No `.env`, `node_modules`, sessions, runtime data, Ollama binary, or model weights are included. Four original ChatNivo contribution files are present in the Ocha operator bundle.
- Exact SHA-256 checksums and byte sizes are recorded in `TWO_BASE_RELEASE_MANIFEST.json` and `SHA256SUMS.txt`; independent inspection is recorded in `PACKAGE_CONTENTS_VERIFICATION.json`.

## Security and publication

- Local API binds to loopback only; no public Ollama endpoint is configured.
- No Llama API key is required.
- Model files, runtime binaries, logs and caches are stored under Git-ignored `data/llama/`; the release policy also excludes this directory.
- Operator bundle contains `.private/` and must not be uploaded to public GitHub.
- Source ZIP has no `.git` metadata; no commit or push is claimed.
