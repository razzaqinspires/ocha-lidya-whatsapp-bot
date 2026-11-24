# ACIE Monitoring and Audit

## Current overview

`.acie status` reports contributions, contributors, original file totals, versions, languages, capability counts, provider lifecycle counts, command draft/collision/active counts, routing execution/fallback counters and worker job/failure status.

## Traceability

Each intake and provider-route operation receives a UUID trace ID. Audit records are JSONL at `contributions/audit/events.jsonl`. Audit payloads redact credential-like field names and do not include source text, user prompt contents or matched credential values.

## Provider metrics

Provider registry health tracks success/failure counts, consecutive failures, average response duration, last check, last classified error and circuit-breaker state. Routing statistics track executions, successes, failures, fallbacks, average response time, last execution and last successful execution. Registry health writes are lock-protected; if a metrics write fails after a provider succeeds, the request result is not reclassified as a failure.

## Integrity

Run `.acie contribution verify <id>` to compare current original files with the SHA-256 inventory. A mismatch reports missing/changed/unexpected paths; never patch source to make the hash pass. Sandbox execution repeats integrity checks before execution and after protocol tests.

## Command visibility

`.acie commands list`, `.acie commands conflicts`, and `.acie commands inspect <id>` show the generated command lifecycle. Only approved commands with an eligible provider appear in the shared plugin loader and therefore the existing menu/help catalog. Use `.acie commands sync` to refresh the virtual command registry after operational recovery.
