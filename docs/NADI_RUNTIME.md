# Ocha NADI External Runtime — Ocha v1.10.60 / AC v2.1.1

## Architecture

Ocha Lidya and Artificial Consciousness Component (AC-Kernel NADI) are independent source bases. Ocha owns a Node.js loader, lifecycle manager and HTTP client. The AC Python package remains under its own base at `.private/artificial-consciousness-component` in the confidential operator bundle; it is not copied into `src/`. Ocha communicates with the Python sidecar over the versioned NADI HTTP API v1.

```text
Ocha Lidya (Node.js)
  ├── WhatsApp, plugins, Nexora AI, vault, data stores and rental API
  ├── AC component loader and lifecycle supervisor
  └── loopback HTTP client ──> AC-Kernel NADI (Python)
                                  ├── managed heartbeat
                                  ├── operational state / metrics
                                  ├── scoped memory and hash-chain ledger
                                  └── secured /v1 HTTP API
```

The sidecar binds to loopback by default. NADI provides operational state and telemetry; it is not an additional chat-completion model. Nexora's ChatNivo fallback is a separate integration with its own adapter and health gate.

## Current non-secret configuration

Operational settings belong in `config/runtime.json`, not `.env`. The current paired operator config is:

```json
{
  "schemaVersion": 1,
  "nadi": {
    "repositoryUrl": "https://github.com/razzaqinspires/artificial-consciousness-component",
    "ref": "16c2fa6e1b500745f260bcf091284a6e18726883",
    "sourceDir": ".private/artificial-consciousness-component",
    "update": false,
    "port": 18765,
    "heartbeatMs": 1000
  }
}
```

Other optional NADI fields are `home`, `sha256`, `baseUrl`, `dataDir`, and `pythonBin`. Leave them omitted or empty to use documented defaults. `paths.kernelDashboardDir`, `paths.kernelTelemetryFile`, `paths.rooRoot`, `privateRuntime.required`, `privateRuntime.path`, `rentalApi.*`, and `tooling.*` are also configured in this file. See `config/runtime.json` for the complete active settings.

The current `sourceDir` selects the co-located AC v2.1.1 source. The supplied source archive has no `.git` metadata, so no new upstream commit SHA is claimed for that snapshot. The `ref` remains the pinned remote fallback if `sourceDir` is cleared. Do not enable `nadi.update` or change the pin without reviewing the new component source and compatibility marker.

Legacy environment overrides such as `OCHA_NADI_SOURCE_DIR`, `OCHA_NADI_REF`, and `OCHA_NADI_PORT` remain accepted for compatibility with old deployments and tests. They are not standard `.env` settings and the recommended deployment configuration is `config/runtime.json`.

## Secrets

`GITHUB_PAT` is used only when a private GitHub repository must be fetched or published. Keep it in `.env`; it is never stored in `config/runtime.json` or embedded in the component URL.

`OCHA_NADI_API_TOKEN` is an optional Bearer secret for connecting to a remote NADI HTTP API. It is not needed for the default local loopback sidecar. When remote access is deliberately enabled, use HTTPS and private networking/TLS, configure the token in `.env`, and do not expose it in logs, status messages, process arguments or runtime JSON.

The Python child receives a minimal environment allowlist. Ocha provider API keys and the GitHub PAT are not inherited by NADI unless a narrowly scoped Git operation explicitly requires the PAT.

## Loader and runtime lifecycle

- `npm install` installs Node dependencies; it does not run NADI.
- `npm start` resolves and validates the configured component, then starts the Python sidecar when available.
- Local `nadi.sourceDir` is preferred when configured. Otherwise the loader uses the pinned GitHub archive and its external component cache.
- Remote archives are fetched over HTTPS, checked for path traversal, symlinks, size and entry limits, validated for Python package structure and `pyproject.toml`, hashed and installed atomically.
- NADI owns its heartbeat. Node monitors health but does not create duplicate ticks.
- `.nadi on|off` controls heartbeat, `.nadi pulse` performs a manual tick, `.nadi sleep` consolidates memory, and `.nadi verify` checks the hash chain.
- Ocha shutdown asks NADI to checkpoint and stops the sidecar. Restart uses bounded backoff.
- If Python or a valid component is unavailable, Ocha continues WhatsApp and primary AI functions without NADI.

## API and privacy boundary

The client uses `/v1/health`, `/v1/status`, `/v1/heartbeat`, `/v1/tick`, `/v1/sleep`, `/v1/verify` and `/v1/checkpoint`. Sender-scoped `/v1/perceive` and `/v1/commit` contracts remain explicit and must not be used to send raw chat content into global operational telemetry. The global heartbeat ledger is not a user chat-history store. The encrypted Roo User Vault remains the authoritative private memory store.

For a remote API, `nadi.baseUrl` must use HTTPS; plain HTTP is accepted only for loopback. Remote access requires private networking/TLS and the optional Bearer token. The default bind is `127.0.0.1` and no public listener is opened.

Persisted NADI data must be backed up before upgrades. Do not delete the configured `nadi.dataDir` or its scope salt during code updates. The default local state path is controlled by the component configuration; if you override it, document and back up that exact directory.

## Paired release status

- Ocha: v1.10.60.
- AC component: v2.1.1.
- HTTP API: v1.
- Local source: `.private/artificial-consciousness-component`.
- Git commit for the supplied local AC snapshot: unavailable because the archive contains no `.git` metadata.
- Python source: unchanged during Ocha v1.10.60 pairing; only compatibility metadata is updated.

Run the component checks from the AC root with `python -m py_compile ac/*.py`, `python selftest.py`, and `python test_prime.py`. The Ocha HTTP client integration is tested separately with `node --test test/nadi-runtime.integration.test.js`.

## Owner controls and dashboard

- `.nadi status` — inspect component, heartbeat, telemetry and connection state.
- `.nadi on` — start/enable heartbeat.
- `.nadi off` — pause heartbeat while preserving state.
- `.nadi pulse` — perform one manual tick.
- `.nadi sleep` — run memory consolidation.
- `.nadi verify` — verify the SHA-256 chain.
- `.kernel` — open the public read-only aggregate kernel dashboard; it does not expose chat text, phone numbers, JIDs, user profiles, private memories or the loopback NADI API.

Artificial-consciousness terminology is architectural. These modules do not establish subjective consciousness or human emotion.
