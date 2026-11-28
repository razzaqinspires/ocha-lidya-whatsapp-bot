import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { createWriteStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { shouldIncludeOchaFile } from './release-policy.js';
import { isAcRuntimeIgnored } from '../src/core/ac-git-policy.js';

const require = createRequire(import.meta.url);
let archiver = null;
try {
  archiver = require('archiver');
} catch {}

const OCHA_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_AC_ROOT = path.resolve(OCHA_ROOT, '.private', 'artificial-consciousness-component');
const args = process.argv.slice(2);
function arg(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}
const AC_ROOT = path.resolve(arg('--ac-root', DEFAULT_AC_ROOT));
const OUTPUT_ROOT = path.resolve(arg('--out', path.join(OCHA_ROOT, '..', 'two-base-release')));
const ochaPkg = JSON.parse(await fs.readFile(path.join(OCHA_ROOT, 'package.json'), 'utf8'));
const acPyproject = await fs.readFile(path.join(AC_ROOT, 'pyproject.toml'), 'utf8');
const acName = acPyproject.match(/^name\s*=\s*["']([^"']+)["']/m)?.[1];
const acVersion = acPyproject.match(/^version\s*=\s*["']([^"']+)["']/m)?.[1];
if (acName !== 'ac-kernel-nadi' || !acVersion) throw new Error('AC component root is not an ac-kernel-nadi package.');
const acReleaseMarkerPath = path.join(AC_ROOT, 'OCHA_COMPONENT_RELEASE.json');
const acReleaseMarker = JSON.parse(await fs.readFile(acReleaseMarkerPath, 'utf8'));
if (acReleaseMarker.version !== acVersion || acReleaseMarker.compatibleOchaVersion !== ochaPkg.version) {
  throw new Error('OCHA_COMPONENT_RELEASE.json does not match this two-base release.');
}
const componentPin = acReleaseMarker.sourceCommit || null;
if (componentPin !== null && !/^[a-f0-9]{40}$/i.test(componentPin)) {
  throw new Error(
    'AC sourceCommit must be a 40-character Git SHA or null for an explicitly documented local snapshot.',
  );
}
if (componentPin === null && !acReleaseMarker.sourceSnapshot) {
  throw new Error('AC local snapshot must include sourceSnapshot provenance when no Git SHA is available.');
}
await fs.access(path.join(AC_ROOT, 'ac', 'kernel.py'));
await fs.access(path.join(AC_ROOT, 'ac', 'server.py'));
await fs.access(path.join(OCHA_ROOT, '.gitignore'));
await fs.access(path.join(OCHA_ROOT, '.private', 'ocha-private-runtime', 'manifest.json'));
const gitignore = await fs.readFile(path.join(OCHA_ROOT, '.gitignore'), 'utf8');
if (!/^\.private\/$/m.test(gitignore)) throw new Error('.gitignore must ignore the complete .private/ tree.');
const verifyEnv = { ...process.env, OCHA_PRIVATE_RUNTIME_REQUIRED: '1' };
delete verifyEnv.OCHA_PRIVATE_RUNTIME_PATH;
const integrityCheck = spawnSync(
  process.execPath,
  [path.join(OCHA_ROOT, 'scripts', 'install-private-runtime.js'), '--verify-only'],
  { cwd: OCHA_ROOT, env: verifyEnv, encoding: 'utf8', timeout: 30_000 },
);
if (integrityCheck.status !== 0)
  throw new Error(
    `Private runtime integrity verification failed: ${integrityCheck.stderr || integrityCheck.stdout || integrityCheck.error?.message || 'unknown error'}`,
  );

const componentRepo = 'https://github.com/razzaqinspires/artificial-consciousness-component';
const privateRoot = path.join(OCHA_ROOT, '.private', 'ocha-private-runtime');
const privateManifest = JSON.parse(await fs.readFile(path.join(privateRoot, 'manifest.json'), 'utf8'));
const privatePackage = JSON.parse(await fs.readFile(path.join(privateRoot, 'package.json'), 'utf8'));
if (privatePackage.name !== '@razzaqventures/ocha-private-runtime' || privatePackage.version !== ochaPkg.version) {
  throw new Error('Bundled private runtime does not match the Ocha release version.');
}

async function walk(root, relative = '', predicate = () => true) {
  const files = [];
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    const full = path.join(root, rel);
    if (!predicate(rel, entry)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in release packages: ${rel}`);
    if (entry.isDirectory()) files.push(...(await walk(root, rel, predicate)));
    else if (entry.isFile()) files.push(rel);
  }
  return files;
}

function acInclude(relative) {
  return !isAcRuntimeIgnored(relative);
}

async function sha256File(file) {
  return crypto
    .createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');
}

async function createZip({ root, name, output, files, generatedEntries = [] }) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  if (archiver) {
    const stream = createWriteStream(output);
    const archive = archiver('zip', { zlib: { level: 9 } });
    const closed = new Promise((resolve, reject) => {
      stream.once('close', resolve);
      stream.once('error', reject);
      archive.once('error', reject);
    });
    archive.on('warning', error => {
      if (error.code !== 'ENOENT') archive.destroy(error);
    });
    archive.pipe(stream);
    for (const relative of files) archive.file(path.join(root, relative), { name: `${name}/${relative}` });
    for (const item of generatedEntries) archive.append(item.content, { name: `${name}/${item.name}` });
    await archive.finalize();
    await closed;
  } else {
    // Python's standard-library zipfile is a dependency-free fallback for operator hosts
    // where npm dependencies have not yet been installed. No shell interpolation is used.
    const python = process.env.OCHA_PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
    const script = [
      'import json, os, sys, zipfile',
      'payload = json.load(sys.stdin)',
      'with zipfile.ZipFile(payload["output"], "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:',
      '  for rel in payload["files"]:',
      '    z.write(os.path.join(payload["root"], rel), arcname=payload["name"] + "/" + rel)',
      '  for item in payload["generatedEntries"]:',
      '    z.writestr(payload["name"] + "/" + item["name"], item["content"])',
    ].join('\n');
    const result = spawnSync(python, ['-c', script], {
      input: JSON.stringify({ root, name, output, files, generatedEntries }),
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        `ZIP fallback failed: ${result.error?.message || result.stderr || `python exited ${result.status}`}`,
      );
    }
  }
  return {
    path: output,
    sizeBytes: (await fs.stat(output)).size,
    sha256: await sha256File(output),
    fileCount: files.length + generatedEntries.length,
  };
}

const ochaFiles = await walk(OCHA_ROOT, '', relative => shouldIncludeOchaFile(relative));
const acFiles = await walk(AC_ROOT, '', (relative, entry) => acInclude(relative));
const stamp = new Date().toISOString();
const ochaBundleMeta = {
  schemaVersion: 1,
  artifact: 'Ocha Lidya Bot operator base',
  package: ochaPkg.name,
  version: ochaPkg.version,
  generatedAt: stamp,
  bundleType: 'complete-local-operator-bundle-not-for-public-upload',
  privateRuntime: {
    package: privatePackage.name,
    version: privatePackage.version,
    sourceCount: privateManifest.files.length,
    localPath: '.private/ocha-private-runtime',
    gitignored: true,
  },
  artificialConsciousness: {
    repository: componentRepo,
    commit: componentPin,
    sourceSnapshot: acReleaseMarker.sourceSnapshot || null,
    defaultRemoteRef: acReleaseMarker.defaultRemoteRef || componentPin,
    version: acVersion,
    localPrivatePath: '.private/artificial-consciousness-component',
    sourceMode: 'independent-nested-git-checkout',
    pythonSourceTrackedByOchaGit: false,
    pythonSourceIncludedOnlyInOperatorBundle: true,
    independentGitRoot: true,
  },
  excluded: [
    '.env and credentials',
    'sessions',
    'live databases and runtime state',
    'logs',
    'ACIE contribution registry/vault state',
    'node_modules',
  ],
};

const localReleaseDir = path.join(OCHA_ROOT, '.release');
await fs.mkdir(localReleaseDir, { recursive: true, mode: 0o700 });
const operatorBundleContent = `${JSON.stringify(ochaBundleMeta, null, 2)}\n`;
await fs.writeFile(path.join(localReleaseDir, 'OPERATOR_BUNDLE.json'), operatorBundleContent, { mode: 0o600 });
const ochaOutput = path.join(OUTPUT_ROOT, `ocha-lidya-bot-v${ochaPkg.version}-operator.zip`);
const acOutput = path.join(OUTPUT_ROOT, `artificial-consciousness-component-v${acVersion}.zip`);
const ochaResult = await createZip({
  root: OCHA_ROOT,
  name: 'ocha-lidya-bot',
  output: ochaOutput,
  files: ochaFiles,
  generatedEntries: [{ name: '.release/OPERATOR_BUNDLE.json', content: operatorBundleContent }],
});
const acResult = await createZip({
  root: AC_ROOT,
  name: 'artificial-consciousness-component',
  output: acOutput,
  files: acFiles,
});
const manifest = {
  schemaVersion: 1,
  generatedAt: stamp,
  compatibility: {
    ochaVersion: ochaPkg.version,
    acVersion,
    nadiCommit: componentPin,
    sourceSnapshot: acReleaseMarker.sourceSnapshot || null,
    sourceMode: componentPin ? 'git-commit-pinned' : 'local-snapshot-requires-OCHA_NADI_SOURCE_DIR',
    defaultRemoteRef: acReleaseMarker.defaultRemoteRef || componentPin,
    httpApi: 'v1',
  },
  artifacts: [
    { name: path.basename(ochaOutput), ...ochaResult },
    {
      name: path.basename(acOutput),
      ...acResult,
      sourceCommit: componentPin,
      sourceSnapshot: acReleaseMarker.sourceSnapshot || null,
    },
  ],
  publication: {
    ochaOperatorBundleContainsIgnoredPrivateSource: true,
    nestedAcGitMetadataIncluded: false,
    publishThisZipToPublicGitHub: false,
    rootOchaGitMustExcludeAllPrivatePaths: true,
    acRepositoryHasItsOwnGitRoot: true,
  },
};
await fs.writeFile(path.join(OUTPUT_ROOT, 'TWO_BASE_RELEASE_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
  mode: 0o600,
});
console.log(JSON.stringify(manifest, null, 2));
