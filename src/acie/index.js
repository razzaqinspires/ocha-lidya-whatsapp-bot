import path from 'node:path';
import { getACIEPaths } from './core/paths.js';
import { ensurePrivateDir, readJson, writeJsonAtomic } from './core/fs-safe.js';
import { getACIEOverview } from './monitoring/metrics.js';
import { runContributionIntake } from './orchestration/contribution-intake.js';
import { listProviders, listCapabilities, listCommandDrafts, inspectProvider, setProviderEnabled } from './registry/provider-registry.js';
import { listContributions, listContributionVersions, findContribution, verifyContribution } from './core/contribution-vault.js';
import { readACIEAudit, appendACIEAudit } from './telemetry/audit-log.js';
import { inspectRuntimeHost, assertSandboxExecutionAllowed, probeSandboxRuntime } from './runtime/runtime-manager.js';
import { executeProviderInSandbox } from './runtime/sandbox-runner.js';
import { listWorkers } from './workers/worker-orchestrator.js';
import { getRoutingStats, selectProviders } from './routing/provider-router.js';
import { evaluateContributionGovernance } from './governance/governance-manager.js';
import { reviewProviderStage, testProviderAdapter } from './governance/provider-approval.js';
import { approveCommandDraft, rejectCommandDraft, revokeGeneratedCommand, synchronizeCommandRegistries } from './command-engine/command-lifecycle.js';

export async function initializeACIE({ logger = null, root = process.cwd() } = {}) {
  const paths = getACIEPaths(root);
  const directories = [paths.contributions, paths.vault, paths.registry, paths.metadata, paths.dependencyLocks, paths.executionProfiles, paths.compatibility, paths.audit, paths.quarantine, paths.adapters, paths.generatedCommands, paths.runtimeWorkspaces, path.dirname(paths.config)];
  for (const directory of directories) await ensurePrivateDir(directory);
  const defaults = {
    schemaVersion: 1, enabled: true, defaultExecution: 'deny', staticAnalysis: true,
    intakeLimits: { files: 20000, bytes: 1073741824, singleFileBytes: 268435456, archiveBytes: 1073741824 },
    analysisLimits: { maxTextFileBytes: 2097152, maxAnalysisBytes: 67108864, maxAnalyzedFiles: 5000, maxRetainedSnippetBytes: 8388608 },
    sandbox: { configured: false, engine: null, enginePath: null, images: {}, timeoutMs: 20000, resources: { memory: '256m', cpus: 1, pids: 64 }, network: 'deny', filesystem: 'read-only-source-and-ephemeral-workspace' },
    governance: { licenseReviewRequired: true, attributionRequired: true, ownerActivationRequired: true }
  };
  const storedConfig = await readJson(paths.config, {});
  const config = {
    ...defaults, ...storedConfig,
    intakeLimits: { ...defaults.intakeLimits, ...(storedConfig.intakeLimits || {}) },
    analysisLimits: { ...defaults.analysisLimits, ...(storedConfig.analysisLimits || {}) },
    sandbox: { ...defaults.sandbox, ...(storedConfig.sandbox || {}), images: { ...defaults.sandbox.images, ...(storedConfig.sandbox?.images || {}) }, resources: { ...defaults.sandbox.resources, ...(storedConfig.sandbox?.resources || {}) } },
    governance: { ...defaults.governance, ...(storedConfig.governance || {}) }
  };
  await writeJsonAtomic(paths.config, config);
  await appendACIEAudit('acie.initialized', { version: '1.0.0', executionDefault: 'deny' }, { root });
  logger?.info?.({ vault: paths.vault, execution: 'denied-by-default' }, 'ACIE contribution intelligence infrastructure initialized');
  return { active: true, executionEnabled: false, paths };
}

export { runContributionIntake, getACIEOverview, listProviders, listCapabilities, listCommandDrafts,
  listContributions, listContributionVersions, findContribution, verifyContribution, readACIEAudit, appendACIEAudit,
  inspectRuntimeHost, assertSandboxExecutionAllowed, probeSandboxRuntime, executeProviderInSandbox, listWorkers, getRoutingStats, selectProviders,
  inspectProvider, setProviderEnabled, evaluateContributionGovernance, reviewProviderStage, testProviderAdapter,
  approveCommandDraft, rejectCommandDraft, revokeGeneratedCommand, synchronizeCommandRegistries };
