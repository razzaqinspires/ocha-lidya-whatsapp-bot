import path from 'node:path';
import crypto from 'node:crypto';
import { intakeContribution, verifyContribution, refreshContributionHistoryAnchors } from '../core/contribution-vault.js';
import { analyzeContribution } from '../intelligence/static-analysis.js';
import { discoverCapabilities } from '../intelligence/capability-discovery.js';
import { registerContribution } from '../registry/provider-registry.js';
import { buildCommandDrafts, persistCommandDrafts, scanExistingPluginCommands } from '../command-engine/command-generation.js';
import { createExternalAdapterDescriptor } from '../adapters/universal-adapter.js';
import { buildLegacyWhatsAppBridgeDraft } from '../adapters/legacy-whatsapp-bridge.js';
import { writeJsonAtomic, ensurePrivateDir, readJson } from '../core/fs-safe.js';
import { getACIEPaths } from '../core/paths.js';
import { appendACIEAudit } from '../telemetry/audit-log.js';
import { runWorker } from '../workers/worker-orchestrator.js';
import { evaluateContributionGovernance } from '../governance/governance-manager.js';

function adapterLanguage(entryPoint, fallback) {
  const ext = path.extname(String(entryPoint || '')).toLowerCase();
  return ({ '.js': 'javascript', '.cjs': 'javascript', '.mjs': 'javascript', '.py': 'python', '.go': 'go', '.php': 'php', '.java': 'java', '.sh': 'bash' })[ext] || fallback;
}

export async function runContributionIntake(input, { root = process.cwd(), existingPlugins = [] } = {}) {
  const traceId = crypto.randomUUID();
  const received = await runWorker('contribution-observer', { traceId }, () => intakeContribution({ ...input, root, analyze: false }));
  const contribution = received.result;
  const originalDirectory = contribution.originalDirectory;

  const acieConfig = await readJson(getACIEPaths(root).config, {});
  const analyzed = await runWorker('language-intelligence', { contributionId: contribution.manifest.contributionId }, () => analyzeContribution(originalDirectory, acieConfig.analysisLimits || {}));
  const analysis = analyzed.result;
  const discovered = await runWorker('capability-discovery', { contributionId: contribution.manifest.contributionId }, () => discoverCapabilities(analysis));
  const capabilities = discovered.result;

  const manifest = {
    ...contribution.manifest,
    languageDiscovery: { primaryLanguage: analysis.primaryLanguage, languages: analysis.languages, runtime: analysis.runtime, moduleSystem: analysis.moduleSystem },
    runtimeLanguage: adapterLanguage(analysis.entryPointCandidates?.[0], analysis.primaryLanguage),
    dependencies: analysis.dependencies,
    runtimeRequirements: analysis.runtimeRequirements,
    analysisCoverage: analysis.analysisCoverage,
    entryPointCandidates: analysis.entryPointCandidates,
    environmentVariables: analysis.environmentVariables,
    capabilities
  };
  await writeJsonAtomic(path.join(contribution.versionRoot, 'manifest.json'), manifest);
  await writeJsonAtomic(path.join(contribution.versionRoot, 'analysis.json'), analysis);
  await refreshContributionHistoryAnchors(contribution.manifest.contributionId, { root });
  contribution.manifest = manifest;
  contribution.analysis = analysis;
  contribution.capabilities = capabilities;

  const integrity = await runWorker('integrity-guardian', { contributionId: manifest.contributionId }, () => verifyContribution(manifest.contributionId, { root }));
  if (integrity.result.status !== 'verified') throw new Error(`Original contribution integrity failed immediately after intake: ${integrity.result.status}`);

  const providerId = `${manifest.contributorId}-${manifest.name}-${manifest.version}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const discoveredExisting = existingPlugins.length ? existingPlugins : await scanExistingPluginCommands({ root });
  const draftsRun = await runWorker('command-generation', { contributionId: manifest.contributionId }, () => buildCommandDrafts({ contributionId: manifest.contributionId, providerId, capabilities, existingPlugins: discoveredExisting }));
  const drafts = draftsRun.result;
  const governance = await runWorker('governance', { contributionId: manifest.contributionId }, () => evaluateContributionGovernance({
    contributorName: input.contributorName, license: input.license, attribution: input.attribution
  }));

  const paths = getACIEPaths(root);
  await Promise.all([ensurePrivateDir(paths.adapters), ensurePrivateDir(paths.dependencyLocks), ensurePrivateDir(paths.executionProfiles), ensurePrivateDir(paths.compatibility)]);
  const adapterResult = await runWorker('adapter-intelligence', { providerId }, async () => {
    const legacyCapability = capabilities.find(item => item.integration === 'legacy-whatsapp-inline');
    const adapter = legacyCapability
      ? buildLegacyWhatsAppBridgeDraft({ providerId, contributionId: manifest.contributionId, analysis, capability: legacyCapability })
      : createExternalAdapterDescriptor({ providerId, contributionId: manifest.contributionId, capabilities, entryPoint: analysis.entryPointCandidates?.[0] || null, language: analysis.primaryLanguage });
    await writeJsonAtomic(path.join(paths.adapters, `${providerId}.adapter.json`), adapter);
    return adapter;
  });
  const adapter = adapterResult.result;

  await runWorker('dependency-intelligence', { providerId }, async () => writeJsonAtomic(path.join(paths.dependencyLocks, `${manifest.contributionId}.json`), {
    contributionId: manifest.contributionId, providerId,
    managers: [...new Set((analysis.dependencies || []).map(item => item.manager))],
    dependencies: analysis.dependencies || [], status: 'discovered-not-installed',
    policy: 'Dependencies are not installed into the bot or original contribution.'
  }));
  await runWorker('compatibility', { providerId }, async () => writeJsonAtomic(path.join(paths.compatibility, `${providerId}.json`), {
    providerId, botRuntime: process.version, contributionRuntime: analysis.runtime,
    result: 'unverified', reason: 'No isolated runtime/sandbox validation has been completed.', checkedAt: new Date().toISOString()
  }));
  await writeJsonAtomic(path.join(paths.executionProfiles, `${providerId}.json`), {
    providerId, runtime: analysis.runtime, requestedPermissions: ['read-original-source'],
    grantedPermissions: [], network: 'denied', hostFilesystem: 'denied', botCredentials: 'denied',
    sandbox: 'not-configured', status: 'quarantined-no-execution'
  });

  const registryResult = await runWorker('command-registry', { providerId }, async () => {
    const provider = await registerContribution({ manifest, analysis, capabilities, commandDrafts: drafts }, { root });
    await persistCommandDrafts(drafts, { root });
    return provider;
  });
  const provider = registryResult.result;
  await runWorker('audit', { traceId }, () => appendACIEAudit('contribution.intake.completed', {
    traceId, contributionId: manifest.contributionId, providerId,
    files: manifest.originalFileCount, capabilities: capabilities.length,
    commandDrafts: drafts.length, integrity: integrity.result.status,
    governance: governance.result.status, securityFindings: analysis.security.findings.length, sourceExecuted: false
  }, { root }));

  return {
    traceId, contribution, provider, adapter, capabilities, commandDrafts: drafts,
    integrity: integrity.result, security: analysis.security, governance: governance.result,
    activation: 'quarantined-pending-license-sandbox-and-owner-authorization'
  };
}
