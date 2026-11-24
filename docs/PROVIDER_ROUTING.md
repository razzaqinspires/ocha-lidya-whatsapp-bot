# ACIE Provider Routing

Provider selection filters by capability, active status, license and attribution review, source integrity, adapter review, adapter test, protocol-test proof, sandbox approval, runtime probe, owner authorization, output-contract validation, critical/high security findings, quota, rate-limit state, availability and circuit breaker. Priority is ascending numeric order.

Execution always passes through the internal sandbox runner. Provider health, execution counts, response duration, recent error class and circuit-breaker metadata are persisted to the provider registry. The in-memory circuit state is rehydrated from registry metadata at selection time.

Fallback is permitted only for an explicitly idempotent request and a classified retryable failure. Authentication, invalid-input, quota-exhaustion, invalid-output and other permanent failures are not replayed. Generated command wrappers currently mark metadata and search as idempotent; download operations are non-idempotent by default.

The sandbox has no network egress. Remote downloader capabilities remain unusable until an independently reviewed allowlisted egress service is designed; do not turn on unrestricted container networking.
