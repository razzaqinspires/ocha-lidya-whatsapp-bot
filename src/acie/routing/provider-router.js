import crypto from 'node:crypto';
import { listProviders } from '../registry/provider-registry.js';
import { classifyProviderError } from './error-classifier.js';
import { appendACIEAudit } from '../telemetry/audit-log.js';
import { canActivateProvider } from '../security/policy.js';
import { assertSandboxExecutionAllowed } from '../runtime/runtime-manager.js';
import { executeProviderInSandbox } from '../runtime/sandbox-runner.js';
import { recordProviderExecution } from '../registry/provider-registry.js';

const circuits = new Map();
const stats = { executions: 0, successes: 0, failures: 0, fallbacks: 0, totalResponseMs: 0, averageResponseMs: 0, lastExecutionAt: null, lastSuccessfulExecutionAt: null, lastError: null };
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 60_000;

function circuitFor(providerId, persisted = null) {
  if (!circuits.has(providerId)) circuits.set(providerId, { state: ['open', 'half-open'].includes(persisted?.state) ? persisted.state : 'closed', failures: Number(persisted?.failures || 0), openedAt: Number(persisted?.openedAt) || null, halfOpenProbe: false });
  const circuit = circuits.get(providerId);
  if (circuit.state === 'open' && Date.now() - circuit.openedAt >= CIRCUIT_COOLDOWN_MS) { circuit.state = 'half-open'; circuit.halfOpenProbe = false; }
  return circuit;
}

export function providerEligibility(provider, { root = process.cwd() } = {}) {
  const circuit = circuitFor(provider.providerId, provider.circuitBreaker);
  const activationGate = canActivateProvider(provider, { root });
  const quotaAvailable = provider.quota?.remaining === undefined || Number(provider.quota.remaining) > 0;
  const available = provider.availability !== false && (!provider.rateLimit?.blockedUntil || Date.parse(provider.rateLimit.blockedUntil) <= Date.now());
  const allowed = provider.status === 'active' && activationGate.allowed && circuit.state !== 'open' && quotaAvailable && available;
  const reason = allowed ? null : provider.status !== 'active' ? 'not-active' : !activationGate.allowed ? `activation-gate:${activationGate.missing.join(',')}` : !quotaAvailable ? 'quota-exhausted' : !available ? 'rate-limited-or-unavailable' : 'circuit-open';
  return { allowed, reason, activationGate, circuit: circuit.state };
}

export async function selectProviders(capability, { root = process.cwd(), exclude = [] } = {}) {
  const providers = await listProviders({ root });
  return providers.filter(provider => provider.capabilities?.includes(capability) && !exclude.includes(provider.providerId) && providerEligibility(provider, { root }).allowed)
    .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100));
}

function recordSuccess(providerId) {
  const circuit = circuitFor(providerId); circuit.state = 'closed'; circuit.failures = 0; circuit.openedAt = null; circuit.halfOpenProbe = false;
  return circuit;
}
function recordFailure(providerId, classified) {
  const circuit = circuitFor(providerId); circuit.halfOpenProbe = false;
  if (classified.retryable) circuit.failures += 1;
  if (circuit.failures >= CIRCUIT_THRESHOLD) { circuit.state = 'open'; circuit.openedAt = Date.now(); }
  return circuit;
}

export async function executeWithFallback({ capability, input, root = process.cwd(), idempotent = false } = {}) {
  const traceId = crypto.randomUUID();
  const attempted = [];
  const candidates = await selectProviders(capability, { root });
  if (!candidates.length) return { ok: false, traceId, error: { kind: 'provider-unavailable', retryable: false }, attempted, fallbackCount: 0 };
  for (const provider of candidates) {
    const circuit = circuitFor(provider.providerId, provider.circuitBreaker);
    if (circuit.state === 'half-open' && circuit.halfOpenProbe) continue;
    if (circuit.state === 'half-open') circuit.halfOpenProbe = true;
    attempted.push(provider.providerId); stats.executions += 1; stats.lastExecutionAt = new Date().toISOString();
    const startedAt = Date.now();
    try {
      assertSandboxExecutionAllowed(provider, { root });
      const result = await executeProviderInSandbox(provider, { capability, input, traceId }, { root });
      const elapsed = Date.now() - startedAt; stats.totalResponseMs += elapsed;
      if (!result || typeof result !== 'object' || result.ok === false) throw Object.assign(new Error('Provider returned invalid output'), { code: 'INVALID_OUTPUT' });
      const circuitState = recordSuccess(provider.providerId); stats.successes += 1; stats.averageResponseMs = Math.round(stats.totalResponseMs / Math.max(1, stats.successes + stats.failures)); stats.lastSuccessfulExecutionAt = new Date().toISOString();
      if (attempted.length > 1) stats.fallbacks += 1;
      await recordProviderExecution(provider.providerId, { success: true, durationMs: elapsed, fallbackCount: attempted.length - 1, circuitBreaker: { state: circuitState.state, failures: circuitState.failures, openedAt: circuitState.openedAt } }, { root }).catch(() => null);
      await appendACIEAudit('provider.execution.success', { traceId, providerId: provider.providerId, capability, fallbackCount: attempted.length - 1 }, { root });
      return { ok: true, traceId, providerId: provider.providerId, result, attempted, fallbackCount: attempted.length - 1 };
    } catch (error) {
      const classified = classifyProviderError(error);
      const elapsed = Date.now() - startedAt; stats.totalResponseMs += elapsed;
      const circuitState = recordFailure(provider.providerId, classified); stats.failures += 1; stats.averageResponseMs = Math.round(stats.totalResponseMs / Math.max(1, stats.successes + stats.failures)); stats.lastError = { kind: classified.kind, at: new Date().toISOString(), providerId: provider.providerId };
      await recordProviderExecution(provider.providerId, { success: false, durationMs: elapsed, errorKind: classified.kind, circuitBreaker: { state: circuitState.state, failures: circuitState.failures, openedAt: circuitState.openedAt } }, { root }).catch(() => null);
      await appendACIEAudit('provider.execution.failure', { traceId, providerId: provider.providerId, capability, errorKind: classified.kind, retryable: classified.retryable }, { root });
      if (!idempotent || !classified.retryable) return { ok: false, traceId, error: classified, attempted, fallbackCount: 0 };
    }
  }
  return { ok: false, traceId, error: { kind: 'all-providers-failed', retryable: false }, attempted, fallbackCount: 0 };
}

export function getRoutingStats() { return { ...stats, circuits: [...circuits.entries()].map(([providerId, value]) => ({ providerId, ...value })) }; }
export function resetRoutingStateForTests() { circuits.clear(); Object.assign(stats, { executions: 0, successes: 0, failures: 0, fallbacks: 0, totalResponseMs: 0, averageResponseMs: 0, lastExecutionAt: null, lastSuccessfulExecutionAt: null, lastError: null }); }
