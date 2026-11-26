import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OCHA_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_AC_ROOT = path.resolve(OCHA_ROOT, '..', 'artificial-consciousness-component');
const args = process.argv.slice(2);
function arg(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}
const AC_ROOT = path.resolve(arg('--ac-root', DEFAULT_AC_ROOT));
const OUTPUT_ROOT = path.resolve(arg('--out', path.join(OCHA_ROOT, '..', 'two-base-release')));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const python = process.env.OCHA_PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
const results = [];

function tail(value, lines = 12) {
  return String(value || '')
    .trim()
    .split(/\r?\n/)
    .slice(-lines)
    .join('\n');
}

function run(label, command, commandArgs, cwd, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    timeout: options.timeout || 180_000,
    maxBuffer: 12 * 1024 * 1024,
  });
  const record = {
    label,
    command: [command, ...commandArgs],
    cwd,
    exitCode: result.status,
    signal: result.signal || null,
    unavailable: Boolean(result.error),
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
  };
  results.push(record);
  const ok = result.status === 0 && !result.error;
  console.log(`\n[${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (record.stdoutTail) console.log(record.stdoutTail);
  if (record.stderrTail) console.error(record.stderrTail);
  if (
    !ok &&
    options.optionalPrettier &&
    /prettier[^\n]*(?:not found|not recognized)|(?:not found|not recognized)[^\n]*prettier/i.test(
      `${result.stdout || ''}\n${result.stderr || ''}`,
    )
  ) {
    record.status = 'NOT_AVAILABLE';
    record.unavailable = true;
    console.warn('[WARN] Prettier CLI is not installed; format check was not performed.');
    return record;
  }
  if (!ok) {
    const error = new Error(
      `${label} failed${result.error ? `: ${result.error.message}` : ` (exit ${result.status ?? result.signal})`}`,
    );
    error.record = record;
    throw error;
  }
  record.status = 'PASS';
  return record;
}

await fs.access(path.join(AC_ROOT, 'ac', 'kernel.py'));
await fs.access(path.join(AC_ROOT, 'OCHA_COMPONENT_RELEASE.json'));
await fs.mkdir(OUTPUT_ROOT, { recursive: true });
console.log('Ocha Lidya paired maintenance / release pipeline');
console.log(`Ocha: ${OCHA_ROOT}`);
console.log(`AC:   ${AC_ROOT}`);
console.log(`Out:  ${OUTPUT_ROOT}`);

try {
  run('JavaScript syntax', npm, ['run', 'check'], OCHA_ROOT);
  run('Documentation links', npm, ['run', 'docs:check'], OCHA_ROOT);
  run('Private source SHA-256 verification', npm, ['run', 'private-runtime:verify'], OCHA_ROOT);
  run('Public publication firewall', npm, ['run', 'security:publication'], OCHA_ROOT);

  const auditFile = path.join(OUTPUT_ROOT, 'ACIE_RUNTIME_AUDIT.json');
  const rawAudit = spawnSync(process.execPath, ['scripts/audit-runtime-state.js', '--json'], {
    cwd: OCHA_ROOT,
    env: { ...process.env, OCHA_PRIVATE_RUNTIME_REQUIRED: '0' },
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (rawAudit.status !== 0 || rawAudit.error)
    throw new Error(`ACIE audit CLI failed: ${rawAudit.stderr || rawAudit.error?.message}`);
  const acieAudit = JSON.parse(rawAudit.stdout);
  results.push({
    label: 'ACIE local registry/provider audit',
    command: [process.execPath, 'scripts/audit-runtime-state.js', '--json'],
    cwd: OCHA_ROOT,
    exitCode: 0,
    status: acieAudit.audit.status,
    stderrTail: tail(rawAudit.stderr),
  });
  await fs.writeFile(auditFile, `${JSON.stringify(acieAudit, null, 2)}\n`);
  console.log(`\n[${acieAudit.audit.status}] ACIE local registry/provider audit`);
  if (acieAudit.audit.status === 'FAIL') throw new Error('ACIE local registry audit reported FAIL.');
  if (acieAudit.audit.status === 'NO_RUNTIME_DATA')
    console.warn('[WARN] No persisted VPS registry state is present in this source archive.');

  run('Ocha-to-NADI HTTP API v1 integration', npm, ['run', 'test:nadi-integration'], OCHA_ROOT, { timeout: 60_000 });
  const npmTest = run('Full Ocha regression suite', npm, ['test'], OCHA_ROOT, { timeout: 240_000 });
  const testLine = `${npmTest.stdoutTail}\n${npmTest.stderrTail}`.match(
    /# tests\s+(\d+)\s+# suites\s+(\d+)\s+# pass\s+(\d+)\s+# fail\s+(\d+)\s+# cancelled\s+(\d+)\s+# skipped\s+(\d+)/s,
  );
  if (testLine)
    npmTest.testSummary = {
      total: Number(testLine[1]),
      suites: Number(testLine[2]),
      passed: Number(testLine[3]),
      failed: Number(testLine[4]),
      cancelled: Number(testLine[5]),
      skipped: Number(testLine[6]),
    };

  run(
    'AC Python bytecode compilation',
    python,
    [
      '-m',
      'py_compile',
      ...(await fs.readdir(path.join(AC_ROOT, 'ac')))
        .filter(name => name.endsWith('.py'))
        .map(name => path.join('ac', name)),
    ],
    AC_ROOT,
  );
  run('AC core self-test', python, ['selftest.py'], AC_ROOT, { timeout: 60_000 });
  run('AC extended privacy/lifecycle/stability tests', python, ['test_prime.py'], AC_ROOT, { timeout: 90_000 });

  const formatCheck = run('Prettier formatting check (non-mutating)', npm, ['run', 'format:check'], OCHA_ROOT, {
    timeout: 60_000,
    optionalPrettier: true,
  });

  const release = run(
    'Build two independent source bases',
    process.execPath,
    ['scripts/release-two-bases.js', '--ac-root', AC_ROOT, '--out', OUTPUT_ROOT],
    OCHA_ROOT,
    { timeout: 180_000 },
  );
  const manifestPath = path.join(OUTPUT_ROOT, 'TWO_BASE_RELEASE_MANIFEST.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const qa = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ochaVersion: JSON.parse(await fs.readFile(path.join(OCHA_ROOT, 'package.json'), 'utf8')).version,
    acVersion:
      (await fs.readFile(path.join(AC_ROOT, 'pyproject.toml'), 'utf8')).match(/^version\s*=\s*"([^"]+)"/m)?.[1] || null,
    results,
    acieLocalAudit: {
      status: acieAudit.audit.status,
      providers: acieAudit.audit.summary.providers,
      commands: acieAudit.audit.summary.commands,
      loadedPluginDescriptors: acieAudit.audit.summary.loadedPluginDescriptors,
      collisions: acieAudit.audit.summary.collisions,
      sandbox: acieAudit.runtimeHost.sandbox,
      persistedRegistryPresence: acieAudit.runtimeHost.registryPresence,
    },
    environmentLimitations: {
      vpsProviderHealth: 'NOT_VERIFIED_NO_VPS_REGISTRY_OR_HOST_ACCESS',
      liveWhatsApp: 'NOT_RUN_NO_AUTHENTICATED_SESSION',
      prettier: formatCheck.status === 'NOT_AVAILABLE' ? 'NOT_AVAILABLE_CLI_NOT_INSTALLED' : 'CHECKED',
      nodePeerDependentPrivateImport: 'MAY_SKIP_WHEN_BAILEYS_PEER_IS_NOT_INSTALLED',
    },
    releaseArtifacts: manifest.artifacts,
  };
  await fs.writeFile(path.join(OUTPUT_ROOT, 'TWO_BASE_QA_REPORT.json'), `${JSON.stringify(qa, null, 2)}\n`, {
    mode: 0o600,
  });
  manifest.verification = {
    automatedPipeline: 'maintain-two-bases',
    qaReport: 'TWO_BASE_QA_REPORT.json',
    acieAudit: 'ACIE_RUNTIME_AUDIT.json',
    result: 'PASS_WITH_ENVIRONMENT_LIMITATIONS',
    liveVpsAudit: 'NOT_PERFORMED_FROM_ARCHIVE',
    liveWhatsAppTest: 'NOT_PERFORMED_NO_SESSION',
    prettier: qa.environmentLimitations.prettier,
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  console.log('\nTwo-base maintenance pipeline completed.');
  console.log(`Ocha release: ${qa.ochaVersion}`);
  console.log(`AC component: ${qa.acVersion}`);
  console.log(`ACIE local audit: ${acieAudit.audit.status}`);
  console.log(`QA report: ${path.join(OUTPUT_ROOT, 'TWO_BASE_QA_REPORT.json')}`);
  console.log(`Manifest: ${manifestPath}`);
} catch (error) {
  console.error(`\nMaintenance pipeline stopped: ${error.message}`);
  process.exitCode = 1;
}
