import path from 'node:path';
import process from 'node:process';
import { runContributionIntake } from '../src/acie/orchestration/contribution-intake.js';
import { scanExistingPluginCommands } from '../src/acie/command-engine/command-generation.js';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) { result[key] = true; continue; }
    result[key] = value; index += 1;
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
if (!args.source || !args['contributor-id'] || !args.name) {
  process.stderr.write('Usage: npm run acie:intake -- --source <folder-or-zip> --contributor-id <id> --name <contribution-name> [--contributor-name <name>] [--contributor-contact <private-contact>] [--project-id ocha-lidya-bot] [--license MIT] [--attribution <text>]\n');
  process.exit(2);
}

try {
  const report = await runContributionIntake({
    source: path.resolve(args.source), contributorId: args['contributor-id'],
    contributorName: args['contributor-name'] || null, contributorContact: args['contributor-contact'] || null, contributionName: args.name,
    projectId: args['project-id'] || 'ocha-lidya-bot', license: args.license || null,
    attribution: args.attribution || null
  }, { existingPlugins: await scanExistingPluginCommands() });
  process.stdout.write(`${JSON.stringify({
    traceId: report.traceId, contributionId: report.contribution.manifest.contributionId,
    providerId: report.provider.providerId, version: report.contribution.manifest.version,
    files: report.contribution.manifest.originalFileCount,
    languages: report.contribution.manifest.languageDiscovery?.languages || [],
    dependencies: report.contribution.manifest.dependencies,
    capabilities: report.capabilities.map(item => ({ id: item.id, status: item.status })),
    commandDrafts: report.commandDrafts.map(item => ({ command: item.command, status: item.status, collision: item.collision })),
    integrity: report.integrity.status, security: report.security,
    activation: report.activation, sourceExecuted: false
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`ACIE intake failed: ${String(error.message || error)}\n`);
  process.exitCode = 1;
}
