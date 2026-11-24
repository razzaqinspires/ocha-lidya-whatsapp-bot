import { listContributions, listContributionVersions } from '../core/contribution-vault.js';
import { listProviders, listCapabilities, listCommandDrafts } from '../registry/provider-registry.js';
import { getRoutingStats } from '../routing/provider-router.js';
import { listWorkers } from '../workers/worker-orchestrator.js';

export async function getACIEOverview({ root = process.cwd() } = {}) {
  const [contributions, versions, providers, capabilities, commands] = await Promise.all([
    listContributions({ root }), listContributionVersions({ root }), listProviders({ root }), listCapabilities({ root }), listCommandDrafts({ root })
  ]);
  return {
    contributions: { total: contributions.length, totalFiles: versions.reduce((sum, item) => sum + Number(item.fileCount || 0), 0), contributors: new Set(contributions.map(item => item.contributorId)).size, versions: versions.length, languages: [...new Set(versions.map(item => item.language))].length, capabilities: capabilities.length },
    providers: { total: providers.length, active: providers.filter(item => item.status === 'active').length, disabled: providers.filter(item => item.status === 'disabled').length, quarantined: providers.filter(item => item.status === 'quarantined').length, unavailable: providers.filter(item => item.health?.status === 'unavailable').length },
    commands: { totalDrafts: commands.length, collisions: commands.filter(item => item.collision?.detected).length, active: commands.filter(item => item.status === 'active').length },
    execution: getRoutingStats(), workers: listWorkers()
  };
}
