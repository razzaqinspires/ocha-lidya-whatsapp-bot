# Next Update Roadmap — Ocha + Artificial Consciousness

This roadmap follows Ocha v1.10.57 and AC v2.1.1. Items are proposals, not claims of implementation.

## Ocha — priority order

1. **Authenticated dual-repository dry run.** On the operator VPS, create both nested Git checkouts, verify both `origin` URLs and `main` branches, run `git:status`, then commit/push a controlled harmless change to each private/public test lane. Confirm that the parent Ocha index never contains `.private/` paths.
2. **Git transaction isolation.** Add per-lane filesystem locks and a single-flight queue to prevent overlapping debounce/manual/pre-restart push requests. Record last attempt, commit SHA, outcome class, and retry eligibility without recording tokens or sensitive source content.
3. **Retry policy.** Add bounded exponential backoff for transient network failures, while not retrying auth, policy, non-fast-forward, branch mismatch, or secret-scan failures. Preserve local commits on failure.
4. **Preflight and health.** Surface `READY`, `TOKEN_MISSING`, `REMOTE_UNREACHABLE`, `AUTH_FAILED`, `DIRTY`, `DIVERGED`, and `BLOCKED_PRIVATE_INDEX` separately. A `READY` state must not be interpreted as successful GitHub publication.
5. **Release attestation.** Produce signed/hashed manifests for both operator ZIPs, source provenance, ignore-policy results, test results, and whether a remote write was actually confirmed.
6. **Environment scanner.** After dependencies are installed, regenerate `.env.example` and `docs/ENVIRONMENT_VARIABLES.md`, confirm `AC_GITHUB_PAT` appears as a secret, and run `npm run env:check`, `npm test` and docs/security checks.

## Artificial Consciousness — continuous maintenance

1. **INTEROCEPTION numerical methods.** Compare current sub-stepped Euler integration against exact exponential integration for first-order state dynamics. Measure stability, numerical error, CPU cost, boundary behavior and equivalence under normal/large `dt`; do not replace the current method without reference tests.
2. **Heartbeat temporal integrity.** Test wall-clock jumps, monotonic clock selection, delayed heartbeat, long suspend/resume, duplicate ticks, jitter and process restart. Use monotonic time for elapsed intervals where supported.
3. **MIMPI overlapping windows.** Extend idempotence beyond identical window fingerprints to partially overlapping windows. Define deterministic episode membership and preserve the append-only ledger. Test restart/replay and concurrent consolidation.
4. **NEURO sensitivity and coupling.** Add deterministic parameter sweeps for arousal, stress, plasticity, recovery, and cross-subsystem coupling. Include range/invariant assertions and baseline snapshots.
5. **Ledger integrity and recovery.** Add crash-injection tests around `append_many`, checksum validation, torn final line recovery and backup/restore. Never silently rewrite historical records.
6. **NADI boundary.** Exercise API v1 health, backpressure, request timeout, malformed payloads, authentication, restart and fallback. Keep AI chat inference separate from AC kernel status/telemetry.
7. **Scientific claim discipline.** Describe the system as an artificial-consciousness architecture/model with measurable internal states. Do not claim subjective experience or consciousness has been scientifically demonstrated.

## Release gates

- No destructive rewrite of either repository history; no force-push.
- Separate least-privilege credentials for Ocha and AC.
- Private source remains in a private GitHub repository; no source encryption workaround.
- Run full Ocha tests with dependencies installed and AC Python suites.
- Validate both operator ZIPs, checksums, secret/runtime exclusions and provenance.
- Update both bases, command/provider/source component registries, changelogs, architecture and `AI_CONTEXT.md` in the same paired maintenance cycle.
