import test from 'node:test';
import assert from 'node:assert/strict';
import { auditACIERuntimeState } from '../src/acie/monitoring/runtime-audit.js';

const baseProvider = overrides => ({
  providerId: 'vendor-a-v1',
  status: 'active',
  capabilities: ['site.metadata'],
  health: {
    status: 'healthy',
    lastCheckAt: new Date(1_700_000_000_000).toISOString(),
    successCount: 3,
    failureCount: 0,
    consecutiveFailures: 0,
  },
  circuitBreaker: { state: 'closed', failures: 0 },
  ...overrides,
});
const baseCommand = overrides => ({
  commandId: 'ACIE-CMD-1',
  command: 'acie-site-info',
  aliases: ['siteinfo'],
  status: 'active',
  providerMapping: 'vendor-a-v1',
  capability: 'site.metadata',
  permission: 'owner',
  activation: { registeredInPluginLoader: true, visibleInUserMenu: true },
  ...overrides,
});

test('ACIE runtime audit passes a consistent provider and dynamically loaded command', () => {
  const provider = baseProvider();
  const command = baseCommand();
  const result = auditACIERuntimeState({
    providers: [provider],
    commands: [command],
    loadedPlugins: [{ plugin: { name: command.command, aliases: command.aliases, acieCommandId: command.commandId } }],
    providerGates: { 'vendor-a-v1': { allowed: true, missing: [] } },
    now: 1_700_000_000_000,
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.summary.commands.loaded, 1);
  assert.equal(result.errors.length, 0);
});

test('ACIE runtime audit reports active commands with inactive or mismatched providers', () => {
  const result = auditACIERuntimeState({
    providers: [baseProvider({ status: 'quarantined', capabilities: ['site.download'] })],
    commands: [baseCommand()],
    loadedPlugins: [],
    providerGates: { 'vendor-a-v1': { allowed: false, missing: ['owner-authorized'] } },
    now: 1_700_000_000_000,
  });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.errors.some(item => item.code === 'active_command_provider_not_active'));
  assert.ok(result.errors.some(item => item.code === 'active_command_capability_mismatch'));
  assert.ok(result.errors.some(item => item.code === 'active_command_not_loaded'));
});

test('ACIE runtime audit flags stale health telemetry and open circuit breakers', () => {
  const provider = baseProvider({
    health: {
      status: 'degraded',
      lastCheckAt: new Date(1_600_000_000_000).toISOString(),
      successCount: 1,
      failureCount: 5,
      consecutiveFailures: 4,
    },
    circuitBreaker: { state: 'open', failures: 4 },
  });
  const result = auditACIERuntimeState({ providers: [provider], commands: [], now: 1_700_000_000_000 });
  assert.equal(result.status, 'WARN');
  assert.ok(result.warnings.some(item => item.code === 'provider_health_stale'));
  assert.ok(result.warnings.some(item => item.code === 'provider_circuit_requires_review'));
});

test('ACIE runtime audit detects active command alias collisions', () => {
  const result = auditACIERuntimeState({
    providers: [baseProvider()],
    commands: [
      baseCommand(),
      baseCommand({ commandId: 'ACIE-CMD-2', command: 'site-info-alt', aliases: ['siteinfo'] }),
    ],
    loadedPlugins: [],
    providerGates: { 'vendor-a-v1': { allowed: true, missing: [] } },
    now: 1_700_000_000_000,
  });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.errors.some(item => item.code === 'active_command_alias_collision'));
});

test('ACIE runtime audit does not call unpopulated registries a successful provider audit', () => {
  const result = auditACIERuntimeState({ providers: [], commands: [], loadedPlugins: [] });
  assert.equal(result.status, 'NO_RUNTIME_DATA');
  assert.ok(result.limitations.some(item => item.includes('not a live external-provider ping')));
});

test('runtime audit CLI emits machine-readable JSON without plugin log contamination', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const env = { ...process.env, OCHA_PRIVATE_RUNTIME_REQUIRED: '0' };
  delete env.OCHA_PRIVATE_RUNTIME_PATH;
  const result = spawnSync(process.execPath, ['scripts/audit-runtime-state.js', '--json'], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const audit = JSON.parse(result.stdout);
  assert.equal(audit.project, 'Ocha Lidya AI');
  assert.equal(audit.projectVersion, '1.10.53');
  assert.ok(['NO_RUNTIME_DATA', 'WARN', 'PASS', 'FAIL'].includes(audit.audit.status));
});
