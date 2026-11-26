const VALID_PROVIDER_STATES = new Set(['quarantined', 'active', 'disabled', 'deprecated', 'rejected']);
const VALID_HEALTH_STATES = new Set([
  'not-tested',
  'healthy',
  'degraded',
  'rate-limited',
  'unavailable',
  'failed',
  'unknown',
]);

function normalizeId(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function timestampAge(timestamp, now) {
  if (!timestamp) return { state: 'never', ageMs: null };
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return { state: 'invalid', ageMs: null };
  const ageMs = Math.max(0, now - parsed);
  return { state: 'recorded', ageMs };
}

function healthSnapshot(provider, now, staleAfterMs) {
  const health = provider.health && typeof provider.health === 'object' ? provider.health : {};
  const lastCheck = timestampAge(health.lastCheckAt, now);
  const status = VALID_HEALTH_STATES.has(health.status) ? health.status : 'unknown';
  let freshness = lastCheck.state;
  if (lastCheck.state === 'recorded' && lastCheck.ageMs > staleAfterMs) freshness = 'stale';
  return {
    status,
    freshness,
    lastCheckAt: health.lastCheckAt || null,
    ageMs: lastCheck.ageMs,
    successCount: Math.max(0, Number(health.successCount) || 0),
    failureCount: Math.max(0, Number(health.failureCount) || 0),
    consecutiveFailures: Math.max(0, Number(health.consecutiveFailures) || 0),
    averageResponseMs: Number.isFinite(Number(health.averageResponseMs)) ? Number(health.averageResponseMs) : null,
    lastErrorKind: health.lastErrorKind || health.lastErrorCode || null,
    circuit: String(provider.circuitBreaker?.state || 'closed').toLowerCase(),
    circuitFailures: Math.max(0, Number(provider.circuitBreaker?.failures) || 0),
  };
}

/**
 * Pure audit over persisted ACIE registries and the plugin loader's current snapshot.
 * It deliberately does not execute providers or mutate registry state.
 */
export function auditACIERuntimeState({
  providers = [],
  commands = [],
  loadedPlugins = [],
  providerGates = {},
  now = Date.now(),
  staleAfterMs = 24 * 60 * 60 * 1000,
} = {}) {
  const errors = [];
  const warnings = [];
  const providerIds = new Set();
  const providerMap = new Map();
  const providerHealth = [];

  for (const provider of providers) {
    const id = normalizeId(provider?.providerId);
    if (!id) {
      errors.push({ code: 'provider_id_missing' });
      continue;
    }
    if (providerIds.has(id)) errors.push({ code: 'duplicate_provider_id', providerId: id });
    providerIds.add(id);
    providerMap.set(id, provider);
    if (!VALID_PROVIDER_STATES.has(String(provider.status || '').toLowerCase())) {
      warnings.push({ code: 'provider_status_unknown', providerId: id, status: provider.status || null });
    }
    const health = healthSnapshot(provider, now, staleAfterMs);
    providerHealth.push({
      providerId: id,
      status: health.status,
      freshness: health.freshness,
      lastCheckAt: health.lastCheckAt,
      successCount: health.successCount,
      failureCount: health.failureCount,
      consecutiveFailures: health.consecutiveFailures,
      averageResponseMs: health.averageResponseMs,
      circuit: health.circuit,
      circuitFailures: health.circuitFailures,
      lastErrorKind: health.lastErrorKind,
    });
    if (health.freshness === 'never' || health.freshness === 'invalid') {
      warnings.push({ code: 'provider_health_not_verified', providerId: id, freshness: health.freshness });
    } else if (health.freshness === 'stale') {
      warnings.push({ code: 'provider_health_stale', providerId: id, ageMs: health.ageMs });
    }
    if (health.status !== 'healthy' && provider.status === 'active') {
      warnings.push({ code: 'active_provider_health_not_healthy', providerId: id, health: health.status });
    }
    if (health.consecutiveFailures >= 3 || ['open', 'half-open'].includes(health.circuit)) {
      warnings.push({
        code: 'provider_circuit_requires_review',
        providerId: id,
        consecutiveFailures: health.consecutiveFailures,
        circuit: health.circuit,
      });
    }
    const gate = providerGates[id];
    if (provider.status === 'active' && gate && gate.allowed !== true) {
      errors.push({ code: 'active_provider_fails_activation_gate', providerId: id, missing: gate.missing || [] });
    }
    if (provider.status === 'active' && !gate) {
      warnings.push({ code: 'active_provider_gate_not_evaluated', providerId: id });
    }
  }

  const loadedIdentifierOwners = new Map();
  const loadedCommandIds = new Set();
  for (const item of loadedPlugins) {
    const plugin = item?.plugin || item;
    if (!plugin || typeof plugin !== 'object') continue;
    if (plugin.acieCommandId) loadedCommandIds.add(String(plugin.acieCommandId));
    for (const raw of [plugin.name, ...(Array.isArray(plugin.aliases) ? plugin.aliases : [])]) {
      const identifier = normalizeId(raw);
      if (!identifier) continue;
      const previous = loadedIdentifierOwners.get(identifier);
      if (previous && previous !== plugin.name) {
        errors.push({ code: 'loaded_command_identifier_collision', identifier, owners: [previous, plugin.name] });
      } else loadedIdentifierOwners.set(identifier, plugin.name);
    }
  }

  const commandIds = new Set();
  const activeIdentifiers = new Map();
  const commandCounts = {
    total: commands.length,
    active: 0,
    pending: 0,
    rejected: 0,
    revoked: 0,
    other: 0,
    loaded: loadedCommandIds.size,
  };
  for (const command of commands) {
    const commandId = String(command?.commandId || '').trim();
    if (!commandId) {
      errors.push({ code: 'command_id_missing' });
      continue;
    }
    if (commandIds.has(commandId)) errors.push({ code: 'duplicate_command_id', commandId });
    commandIds.add(commandId);
    const status = String(command.status || 'unknown').toLowerCase();
    if (status === 'active') commandCounts.active += 1;
    else if (['draft-pending-validation', 'draft', 'pending-review'].includes(status)) commandCounts.pending += 1;
    else if (status === 'rejected') commandCounts.rejected += 1;
    else if (status === 'revoked') commandCounts.revoked += 1;
    else commandCounts.other += 1;
    if (status !== 'active') continue;

    const names = [command.command, ...(Array.isArray(command.aliases) ? command.aliases : [])]
      .map(normalizeId)
      .filter(Boolean);
    for (const identifier of names) {
      const previous = activeIdentifiers.get(identifier);
      if (previous && previous !== commandId)
        errors.push({ code: 'active_command_alias_collision', identifier, commandIds: [previous, commandId] });
      else activeIdentifiers.set(identifier, commandId);
    }

    const providerId = normalizeId(command.providerMapping);
    const provider = providerMap.get(providerId);
    if (!provider) {
      errors.push({ code: 'active_command_provider_missing', commandId, providerId });
    } else {
      if (provider.status !== 'active')
        errors.push({
          code: 'active_command_provider_not_active',
          commandId,
          providerId,
          providerStatus: provider.status,
        });
      if (!Array.isArray(provider.capabilities) || !provider.capabilities.includes(command.capability)) {
        errors.push({
          code: 'active_command_capability_mismatch',
          commandId,
          providerId,
          capability: command.capability || null,
        });
      }
    }
    if (command.activation?.registeredInPluginLoader !== true || command.activation?.visibleInUserMenu !== true) {
      errors.push({ code: 'active_command_activation_flags_inconsistent', commandId });
    }
    if (!loadedCommandIds.has(commandId)) {
      errors.push({ code: 'active_command_not_loaded', commandId, command: command.command || null });
    }
  }

  const providersByStatus = Object.fromEntries(
    [...new Set(providers.map(item => String(item.status || 'unknown').toLowerCase()))]
      .sort()
      .map(status => [
        status,
        providers.filter(item => String(item.status || 'unknown').toLowerCase() === status).length,
      ]),
  );
  const healthByStatus = Object.fromEntries(
    [...new Set(providerHealth.map(item => item.status))]
      .sort()
      .map(status => [status, providerHealth.filter(item => item.status === status).length]),
  );

  return {
    status: errors.length
      ? 'FAIL'
      : warnings.length
        ? 'WARN'
        : providers.length || commands.length
          ? 'PASS'
          : 'NO_RUNTIME_DATA',
    summary: {
      providers: providers.length,
      providersByStatus,
      healthByStatus,
      commands: commandCounts,
      loadedPluginDescriptors: loadedPlugins.length,
      collisions: errors.filter(item => item.code.includes('collision')).length,
      errors: errors.length,
      warnings: warnings.length,
    },
    providerHealth,
    errors,
    warnings,
    limitations: [
      'Provider health is a persisted observation from the last protocol test or execution, not a live external-provider ping.',
      'A live provider check must use the approved ACIE adapter protocol test with a bounded, capability-specific input.',
      'This audit is read-only and does not activate providers, commands, sandbox execution, or fallback routes.',
    ],
  };
}
