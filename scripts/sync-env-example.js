#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncEnvironmentArtifacts } from './lib/env-inventory.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const strict = process.argv.includes('--strict');

try {
  const result = await syncEnvironmentArtifacts(ROOT, { check, strict });
  const inventory = result.inventory;
  const production = inventory.entries.filter(entry => entry.production).length;
  const appConfig = inventory.entries.filter(
    entry => entry.production && entry.category === 'application-config',
  ).length;
  const secrets = inventory.entries.filter(entry => entry.production && entry.category === 'secret').length;
  const internal = inventory.entries.filter(entry => entry.production && entry.category === 'internal-runtime').length;
  const host = inventory.entries.filter(entry => entry.production && entry.category === 'host-environment').length;
  const testsOnly = inventory.entries.filter(entry => !entry.production && entry.test).length;
  const unresolvedDynamic = inventory.dynamic.filter(item => item.scope === 'production').length;

  process.stdout.write(
    `[ENV INVENTORY] ${inventory.codeFilesScanned} JavaScript files and ${inventory.shellFilesScanned} shell files scanned.\n`,
  );
  process.stdout.write(
    `[ENV INVENTORY] ${inventory.entries.length} unique static names (${production} production, ${testsOnly} test-only).\n`,
  );
  process.stdout.write(
    `[ENV INVENTORY] Project settings: ${appConfig}; secrets: ${secrets}; internal markers: ${internal}; host/OS names: ${host}.\n`,
  );
  process.stdout.write(
    `[ENV INVENTORY] ${inventory.entries.reduce((n, entry) => n + entry.usages.length, 0) + inventory.dynamic.length} JavaScript access sites; ${inventory.dynamic.length} unresolved computed access(es); ${inventory.passthrough.length} whole-env pass-through(s).\n`,
  );
  process.stdout.write(
    `[ENV INVENTORY] ${inventory.shellVariables.reduce((n, entry) => n + entry.usages.length, 0)} shell expansion sites; ${inventory.dotenvLoadSites.length} dotenv load/reload sites.\n`,
  );

  if (check && !result.upToDate) {
    process.stderr.write(`[ENV INVENTORY] Files need synchronization: ${result.changes.join(', ')}\n`);
    process.exitCode = 1;
  } else if (result.changes.length) {
    process.stdout.write(`[ENV INVENTORY] Updated: ${result.changes.join(', ')}\n`);
  } else {
    process.stdout.write('[ENV INVENTORY] .env.example and docs/ENVIRONMENT_VARIABLES.md are already synchronized.\n');
  }
  if (inventory.dynamic.length)
    process.stdout.write(
      `[ENV INVENTORY] ${inventory.dynamic.length} unresolved computed access(es) remain; see docs/ENVIRONMENT_VARIABLES.md.\n`,
    );
} catch (error) {
  process.stderr.write(`[ENV INVENTORY] ERROR: ${error.message}\n`);
  process.exitCode = 1;
}
