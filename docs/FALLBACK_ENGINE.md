# ACIE Fallback Engine

Fallback is conservative and traceable. A provider failure is classified before another provider is considered. A request must be explicitly marked idempotent and the error must be retryable. Authentication, invalid input, quota exhaustion, invalid output and permanent policy failures are not retried or replayed.

Circuit breakers count consecutive retryable failures. They open after three failures and enter half-open after a 60-second cooldown. A successful provider execution resets the circuit. Health and breaker state are persisted with the provider registry; persistence errors do not cause a successful remote operation to be reported as failed.

Every routing attempt receives a trace ID. Audit entries record provider ID, capability, classified error and fallback count without source text, user prompt contents or credentials.
