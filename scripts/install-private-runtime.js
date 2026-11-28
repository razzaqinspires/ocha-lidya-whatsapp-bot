import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getRuntimeSettings } from '../src/core/runtime-settings.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundledRoot = path.join(root, '.private', 'ocha-private-runtime');
const verifyOnly = process.argv[2] === '--verify-only';
const runtime = getRuntimeSettings();
const sourceArg = (verifyOnly ? process.argv[3] : process.argv[2]) || runtime.privateRuntime.path || '';
const sourceCandidate = sourceArg.trim() ? path.resolve(sourceArg) : bundledRoot;

let source;
try {
  source = await fs.realpath(sourceCandidate);
} catch (error) {
  if (error.code === 'ENOENT' && !runtime.privateRuntime.required) {
    console.log('Private runtime tidak ditemukan. Public compatibility mode tetap tersedia.');
    process.exit(0);
  }
  throw error;
}
const bundledReal = await fs.realpath(bundledRoot).catch(() => null);
const isBundled = bundledReal && source === bundledReal;
const relative = path.relative(root, source);
const isInsideRoot =
  relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
if (isInsideRoot && !isBundled) {
  throw new Error(
    'Refusing an arbitrary private runtime path inside the public checkout. Use the exact ignored .private/ocha-private-runtime directory or store external source outside this checkout.',
  );
}

const packageJson = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
if (packageJson.name !== '@razzaqventures/ocha-private-runtime' || packageJson.private !== true) {
  throw new Error('Selected directory is not the expected private Ocha runtime package.');
}
const integrity = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
const requiredPaths = [
  'src/lib/helpers.js',
  'src/lib/freply.js',
  'src/lib/serializ_simple.js',
  'src/plugins/owner/message-lab.js',
];
if (
  integrity.package !== packageJson.name ||
  integrity.version !== packageJson.version ||
  !Array.isArray(integrity.files)
) {
  throw new Error('Private runtime manifest does not match package metadata.');
}
const bySourcePath = new Map(integrity.files.map(item => [item.sourcePath, item]));
if (bySourcePath.size !== requiredPaths.length || requiredPaths.some(item => !bySourcePath.has(item))) {
  throw new Error('Private runtime manifest does not contain the exact four-module source set.');
}
for (const relativePath of requiredPaths) {
  const item = bySourcePath.get(relativePath);
  for (const candidate of [item.runtimePath, item.originalPath]) {
    const file = path.resolve(source, candidate);
    if (!file.startsWith(`${source}${path.sep}`))
      throw new Error(`Private package manifest path escaped package root: ${candidate}`);
    const realFile = await fs.realpath(file);
    if (!realFile.startsWith(`${source}${path.sep}`))
      throw new Error(`Private package symlink escaped package root: ${candidate}`);
    const data = await fs.readFile(realFile);
    const digest = createHash('sha256').update(data).digest('hex');
    if (digest !== item.sha256 || data.byteLength !== item.sizeBytes) {
      throw new Error(`Private source integrity check failed: ${candidate}`);
    }
  }
}

console.log(
  `Private runtime package verified: ${packageJson.name}@${packageJson.version} (${requiredPaths.length} immutable source modules).`,
);
if (verifyOnly) process.exit(0);
if (isBundled) {
  console.log('Private runtime is bundled under ignored .private/; no npm package copy is required.');
  console.log('Set OCHA_PRIVATE_RUNTIME_REQUIRED=1 to fail closed if this local package is later missing.');
  process.exit(0);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['install', '--ignore-scripts', '--no-save', '--package-lock=false', source], {
  cwd: root,
  stdio: 'inherit',
  timeout: 180_000,
  env: process.env,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log(`Private runtime ${packageJson.version} installed into node_modules; source remains at ${source}.`);
