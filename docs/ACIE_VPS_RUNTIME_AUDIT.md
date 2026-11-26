# ACIE Dynamic Registry and Provider Health Audit

## Read-only VPS command

Run from the Ocha project root after dependencies are installed:

```bash
npm run ops:audit-runtime
node scripts/audit-runtime-state.js --json > acie-runtime-audit.json
```

The script reads `contributions/registry/providers.json`, `generated-commands/index.json` (canonical) and the compatibility command mirror. It evaluates provider activation gates, active command-to-provider mappings, capability matches, dynamic plugin loader results, canonical/alias collisions, recorded health freshness, consecutive failures and persisted circuit-breaker state. It probes only the configured Docker/Podman host and digest-pinned images; it does not start contributed source.

The report is read-only. It does not activate providers, modify command records, write health counters, authorize execution or send requests to external providers.

## Health semantics

Provider `health` in the registry is persisted from the last adapter protocol test or successful/failed provider execution. It is not a continuously refreshed endpoint ping. The audit classifies it as `healthy`, `degraded`, `rate-limited`, `unavailable`, `failed`, `not-tested`, `stale`, or `unknown`. A last check older than 24 hours is flagged stale. A provider with three or more consecutive failures or an open/half-open circuit requires review.

For a capability-specific live sandbox test, use the already registered owner-only command from the owner private chat:

```text
.acie provider test <provider-id> [capability-id]
.acie provider inspect <provider-id>
.acie routing inspect <capability-id>
.acie commands conflicts
```

The protocol test is a governance step and must be performed only for a quarantined provider after the adapter has been reviewed. It runs within the approved no-network sandbox and validates the provider's output contract. Do not create arbitrary live probes, because a contribution may implement non-idempotent operations.

## Machine-readable output

Use the direct Node entrypoint shown above for pure JSON output. It suppresses routine plugin-loader logging on stdout; diagnostic warnings remain on stderr. The regular `npm run ops:audit-runtime` command is intended for human-readable terminal output.

## Audit findings from the supplied base ZIP

The ZIP contains ACIE source and tests but no VPS `contributions/registry/providers.json`, canonical `generated-commands/index.json`, or live sandbox configuration. Therefore a real dynamic registry/health state cannot be asserted from the archive. Running the new command against the archive reports `NO_RUNTIME_DATA`; run it on the actual VPS for the operational snapshot.

## Known boundaries

- In-memory routing counters are process-local and are not reconstructed from a separate long-lived process by this CLI. Persisted per-provider health and circuit state remain authoritative for the cross-process snapshot.
- No Docker/Podman host was detected in this build container, so production sandbox availability must be checked on the VPS.
- Remote provider API connectivity is not probed by this audit. Use `.acie provider test` for an approved adapter protocol test.
