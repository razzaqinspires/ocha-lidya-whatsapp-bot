import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getACIEPaths } from '../src/acie/core/paths.js';
import { listProviders, listCommandDrafts, inspectProvider } from '../src/acie/registry/provider-registry.js';
import { probeSandboxRuntime } from '../src/acie/runtime/runtime-manager.js';
import { auditACIERuntimeState } from '../src/acie/monitoring/runtime-audit.js';
import { loadPlugins, listPluginEntries } from '../src/core/plugin-loader.js';
import { configureLogger } from '../src/core/logger.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsonOutput = process.argv.includes('--json');
if (jsonOutput) configureLogger({ level: 'silent' });
const paths = getACIEPaths(root);
const [providers, commands] = await Promise.all([listProviders({ root }), listCommandDrafts({ root })]);
const providerGates = {};
for (const provider of providers) {
  const inspected = await inspectProvider(provider.providerId, { root });
  providerGates[String(provider.providerId).toLowerCase()] = inspected?.activationGate || {
    allowed: false,
    missing: ['provider-not-found'],
  };
}

// This probes only the configured container engine and digest-pinned runtime images.
// It never starts a contribution or a provider adapter.
const sandbox = await probeSandboxRuntime({ root });
const registryFiles = [
  path.join(paths.registry, 'providers.json'),
  path.join(paths.generatedCommands, 'index.json'),
  path.join(paths.registry, 'commands.json'),
];
const registryPresence = {};
for (const file of registryFiles) {
  try {
    await fs.access(file);
    registryPresence[path.relative(root, file).replaceAll(path.sep, '/')] = true;
  } catch {
    registryPresence[path.relative(root, file).replaceAll(path.sep, '/')] = false;
  }
}

let loadedPlugins = [];
let loaderFailure = null;
try {
  await loadPlugins();
  loadedPlugins = listPluginEntries();
} catch (error) {
  loaderFailure = {
    code: error.code || error.name || 'PLUGIN_LOAD_FAILED',
    message: String(error.message || '').slice(0, 240),
  };
}

const audit = auditACIERuntimeState({ providers, commands, loadedPlugins, providerGates });
if (loaderFailure) {
  audit.status = 'FAIL';
  audit.errors.push({ code: 'dynamic_plugin_loader_failed', ...loaderFailure });
  audit.summary.errors = audit.errors.length;
}
const output = {
  generatedAt: new Date().toISOString(),
  project: 'Ocha Lidya AI',
  projectVersion: JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version,
  runtimeHost: {
    node: process.version,
    platform: process.platform,
    sandbox: sandbox.sandbox,
    registryPresence,
    pluginLoader: loaderFailure ? 'failed' : 'loaded',
  },
  audit,
};

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} else {
  console.log(`ACIE runtime audit: ${audit.status}`);
  console.log(
    `Providers: ${audit.summary.providers} · Commands: ${audit.summary.commands.total} · Active: ${audit.summary.commands.active} · Loaded ACIE: ${audit.summary.commands.loaded}`,
  );
  console.log(
    `Provider health: ${JSON.stringify(audit.summary.healthByStatus)} · Errors: ${audit.summary.errors} · Warnings: ${audit.summary.warnings}`,
  );
  console.log(
    `Sandbox: configured=${sandbox.sandbox.configured} available=${sandbox.sandbox.available} engine=${sandbox.sandbox.engine || 'none'} probe=${sandbox.sandbox.probeReason || 'not-probed'}`,
  );
  if (audit.errors.length) console.error('Errors:', JSON.stringify(audit.errors, null, 2));
  if (audit.warnings.length) console.warn('Warnings:', JSON.stringify(audit.warnings, null, 2));
  for (const limitation of audit.limitations) console.log(`NOTE: ${limitation}`);
  if (!providers.length && !commands.length)
    console.log(
      'Belum ada registry runtime di checkout ini. Jalankan perintah yang sama pada VPS aktif untuk audit state sebenarnya.',
    );
}

if (audit.status === 'FAIL') process.exitCode = 2;
