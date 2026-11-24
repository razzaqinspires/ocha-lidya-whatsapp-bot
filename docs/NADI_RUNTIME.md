# Ocha NADI External Runtime — v1.10.33

## Architecture

Ocha Lidya and AC-Kernel NADI are separate projects. The Ocha repository contains only a small Node.js integration client and component loader; it does **not** contain the NADI Python package. NADI is downloaded from the user's GitHub repository into an external component directory (`~/.ocha/components/nadi/` by default), then launched as an isolated Python sidecar. Ocha calls its loopback HTTP API using Node's native `fetch`; Axios is not required.

```text
Ocha Lidya Bot (Node.js)
  ├── Existing WhatsApp, plugins, Nexora AI providers, vault, database, rental, games
  ├── NADI component loader (native fetch + archive validation + atomic install)
  └── HTTP client ── 127.0.0.1:<port> ──> External AC-Kernel NADI (Python)
                                               ├── managed heartbeat
                                               ├── homeostasis / synthetic affect / self-model
                                               ├── hash-chain ledger and scoped memory
                                               └── secured /v1 HTTP API
```

The Python package is cached outside the Ocha source tree. The persistent NADI state remains in the configured `OCHA_NADI_DATA_DIR` (default `data/consciousness/`) to preserve the current operational history from v1.10.30. Do not remove that data directory when updating bot code. The NADI component can be replaced independently by changing its Git ref and setting `OCHA_NADI_UPDATE=1`; the component source is never merged into `src/`.

## GitHub source settings

The default Ocha v1.10.33 configuration points to the verified repository `razzaqinspires/artificial-consciousness-component` and locks source ref `16c2fa6e1b500745f260bcf091284a6e18726883` (NADI 2.1.0). These defaults are used automatically; no extra environment variables are required. Override them only for a controlled release change:

```dotenv
OCHA_NADI_REPO_URL=https://github.com/razzaqinspires/artificial-consciousness-component
OCHA_NADI_REF=16c2fa6e1b500745f260bcf091284a6e18726883
OCHA_NADI_PORT=18765
OCHA_AC_HEARTBEAT_MS=1000
# Optional: pin the downloaded GitHub archive SHA-256 (64 hexadecimal chars)
OCHA_NADI_SHA256=
# Optional: custom external installation and persistent state paths
# OCHA_NADI_HOME=/path/outside/ocha-repository/nadi
# OCHA_NADI_DATA_DIR=/path/to/persistent/nadi-state
# OCHA_PYTHON_BIN=python3
```

Only point the loader at a repository you control and trust because the downloaded Python component is executable code. The shipped default uses the immutable commit SHA above, not a moving branch. Keep that SHA pinned until a deliberate NADI release upgrade is reviewed. The bot downloads a GitHub archive over HTTPS, applies size/path/symlink/entry-count limits, validates the package layout and `pyproject.toml`, computes SHA-256, and installs it atomically under the external component cache. If `OCHA_NADI_SHA256` is provided, the archive must match it. If an already installed ref is present, the cache is reused. For a controlled refresh, change `OCHA_NADI_REF` to a reviewed immutable commit SHA (the cache key changes automatically); `OCHA_NADI_UPDATE=1` forces a reinstall of the currently pinned ref. `GITHUB_PAT` may be used for a private GitHub repository and must remain secret.

Manual installation is also supported by setting `OCHA_NADI_SOURCE_DIR` to an existing NADI source checkout outside the Ocha repository.

## Runtime lifecycle

`npm install` hanya memasang dependency Node.js dan tidak menjalankan NADI. Sidecar NADI baru dimulai ketika `npm start` menjalankan `src/index.js`; loader mengambil source yang dipatok pada commit GitHub ke cache eksternal, lalu mencoba meluncurkannya dengan Python 3.10+. Jika Python atau komponen tidak tersedia, Ocha mencatat NADI offline dan tetap melanjutkan layanan WhatsApp serta AI utama. Tidak ada `postinstall` NADI.

- Ocha starts NADI after provider-key initialization.
- It launches `python -m ac --config <external-config> serve --host 127.0.0.1 --port <port>`.
- NADI owns its drift-corrected heartbeat; Node polls status but does not generate duplicate ticks.
- `.nadi on|off` starts/stops the NADI heartbeat through `/v1/heartbeat`.
- `.nadi pulse` invokes one explicit `/v1/tick`; `.nadi sleep` uses `/v1/sleep`; `.nadi verify` uses `/v1/verify`.
- On Ocha shutdown, Node stops the heartbeat, requests a checkpoint, and terminates the sidecar.
- Process restart uses capped backoff. If the NADI source is not configured or Python is unavailable, Ocha's WhatsApp and AI runtime continue without it.

## API and provider boundary

The integration uses `/v1/health`, `/v1/status`, `/v1/heartbeat`, `/v1/tick`, `/v1/sleep`, `/v1/verify`, and `/v1/checkpoint`. NADI does not receive Ocha provider API keys and does not generate chat replies through a second LLM. The existing Ocha Groq/Gemini/DeepSeek/OpenAI chain remains the only production response-generation path.

The current prompt integration uses global operational telemetry only. Raw WhatsApp messages, JIDs, profiles, relationship records, and encrypted User Vault content are not sent to the global heartbeat kernel. NADI v2.1's sender-scoped `/v1/perceive` capability remains available for a future explicitly enabled integration, but this release does not silently route user messages into that API.

## Security and data preservation

- The service binds to loopback by default. No public listener is opened.
- The NADI repo URL and ref are configuration, not credentials. `GITHUB_PAT` and any API token are secrets.
- Archive extraction rejects path traversal, absolute paths, symlinks, oversized archives, and excessive entries.
- The sidecar API is only addressed through loopback unless an operator deliberately configures `OCHA_NADI_BASE_URL`. For a remote service, `OCHA_NADI_BASE_URL` must use HTTPS (plain HTTP is accepted only for loopback), use private networking/TLS and a Bearer token. The Python process receives only a minimal environment allowlist; Ocha provider keys and GitHub credentials are not inherited by NADI.
- NADI's global heartbeat ledger is not a user memory store. The existing encrypted User Vault remains authoritative for conversations.
- `data/consciousness/` and its `.scope-salt` must be backed up. Do not delete them during code updates.
- Artificial-consciousness terminology is architectural; the system does not establish subjective consciousness or human emotion.

## Public kernel dashboard

The general `.kernel` command (aliases `.kernelstatus`, `.nadiweb`) publishes a public read-only WebView through the shared Code Lab Quick Tunnel. It displays aggregate inbound/output/reply counts, AI response totals and latency, and sanitized NADI operational circuits. It does not expose chat text, phone numbers, JIDs, profiles, private memory, or the loopback NADI API. See `docs/KERNEL_DASHBOARD.md` for setup, formulas, URL rotation, and data retention.

## Owner controls

- `.nadi status` — inspect component, heartbeat, telemetry, and connection state.
- `.nadi on` — start/enable heartbeat.
- `.nadi off` — pause heartbeat while preserving state.
- `.nadi pulse` — perform one manual tick.
- `.nadi sleep` — run memory consolidation.
- `.nadi verify` — verify the SHA-256 chain.
