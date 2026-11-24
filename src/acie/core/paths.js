import path from 'node:path';

export function getACIEPaths(root = process.cwd()) {
  const projectRoot = path.resolve(root);
  const contributions = path.join(projectRoot, 'contributions');
  return Object.freeze({
    projectRoot,
    contributions,
    vault: path.join(contributions, 'vault'),
    registry: path.join(contributions, 'registry'),
    metadata: path.join(contributions, 'metadata'),
    dependencyLocks: path.join(contributions, 'dependency-locks'),
    executionProfiles: path.join(contributions, 'execution-profiles'),
    compatibility: path.join(contributions, 'compatibility'),
    audit: path.join(contributions, 'audit'),
    quarantine: path.join(contributions, 'quarantine'),
    adapters: path.join(projectRoot, 'adapters'),
    generatedCommands: path.join(projectRoot, 'generated-commands'),
    runtimeWorkspaces: path.join(projectRoot, 'runtime-workspaces'),
    config: path.join(projectRoot, 'config', 'acie.runtime.json')
  });
}

export const ACIE_DIRS = Object.freeze([
  'core', 'intelligence', 'workers', 'adapters', 'orchestration', 'routing',
  'runtime', 'registry', 'command-engine', 'response-engine', 'security',
  'monitoring', 'telemetry', 'governance'
]);
