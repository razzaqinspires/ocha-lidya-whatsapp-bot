import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEnvironmentInventory, syncEnvironmentArtifacts } from '../scripts/lib/env-inventory.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function getEntry(inventory, key) {
  return inventory.entries.find(entry => entry.key === key);
}

test('AST inventory discovers direct, bracket, destructured, aliased, and provider-mapped environment names', async () => {
  const inventory = await collectEnvironmentInventory(root);
  assert.deepEqual(inventory.parseErrors, []);
  assert.ok(inventory.codeFilesScanned >= 300, 'the scanner should cover the repository JavaScript source and tests');

  for (const key of [
    'OCHA_HOST_PREFLIGHT_COMPLETED',
    'OCHA_NADI_PORT',
    'OCHA_NADI_API_TOKEN',
    'OCHA_KERNEL_TELEMETRY_FILE',
    'GITHUB_PAT',
    'AC_GITHUB_PAT',
    'GROQ_API_KEY',
    'GEMINI_API_KEY',
    'DEEPSEEK_API_KEY',
    'OPENAI_API_KEY',
  ]) {
    assert.ok(getEntry(inventory, key), `${key} must be present in the source inventory`);
  }

  assert.equal(getEntry(inventory, 'OCHA_HOST_PREFLIGHT_COMPLETED').category, 'internal-runtime');
  assert.equal(getEntry(inventory, 'GITHUB_PAT').category, 'secret');
  assert.equal(
    getEntry(inventory, 'GROQ_API_KEY').production,
    true,
    'provider registry dynamic access must be resolved',
  );
  assert.equal(
    getEntry(inventory, 'QWEN_API_KEY')?.category,
    'test-only',
    'stale test fixture key must not be confused with a production provider',
  );

  const counts = inventory.entries.reduce((result, entry) => {
    result[entry.category] = (result[entry.category] || 0) + 1;
    return result;
  }, {});
  assert.deepEqual(counts, {
    'application-config': 23,
    secret: 8,
    'host-environment': 23,
    'internal-runtime': 4,
    'test-only': 1,
  });
});

test('production dynamic environment reads are resolved or reported without hiding the unresolved location', async () => {
  const inventory = await collectEnvironmentInventory(root);
  assert.equal(
    inventory.dynamic.some(item => item.scope === 'production'),
    false,
    'production computed environment reads must be statically resolved or explicitly fixed before shipping',
  );
  assert.ok(
    inventory.dynamic.every(item => item.scope === 'test'),
    'remaining unresolved dynamic accesses currently belong only to test fixtures',
  );
  assert.ok(
    inventory.passthrough.some(item => item.file.startsWith('src/')),
    'whole-environment child-process pass-through must remain visible in the audit',
  );
});

test('shell tooling overrides distinguish external environment inputs from script-local variables', async () => {
  const inventory = await collectEnvironmentInventory(root);
  const names = new Set(inventory.shellVariables.map(item => item.key));
  const sites = inventory.shellVariables.reduce((total, item) => total + item.usages.length, 0);
  assert.ok(names.has('NEXORA_BOOTSTRAP_DRY_RUN'));
  assert.ok(names.has('OCHA_NODE_BIN'));
  assert.ok(names.has('OCHA_RUN_USER'));
  assert.equal(names.has('RUNTIME'), false, 'shell-local variables must not be presented as .env inputs');
  assert.equal(sites, 9);
});

test('dotenv load points are inventoried separately from process.env accesses', async () => {
  const inventory = await collectEnvironmentInventory(root);
  assert.equal(inventory.dotenvLoadSites.length, 7);
  assert.ok(
    inventory.dotenvLoadSites.some(item => item.file === 'src/index.js' && item.kind === 'dotenv/config import'),
  );
  assert.ok(
    inventory.dotenvLoadSites.some(
      item => item.file === 'src/core/auto-git-sync.js' && item.kind === 'dotenv.config() call',
    ),
  );
});

test('whole-project scan catches root entrypoints, optional chaining, global process aliases, constants and unknown dynamic reads', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-env-inventory-'));
  try {
    await fs.mkdir(path.join(temporaryRoot, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(temporaryRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(temporaryRoot, '.env.example'), '# fixture\n', 'utf8');
    await fs.writeFile(path.join(temporaryRoot, '.env'), 'SHOULD_NEVER_BE_READ=secret-value\n', 'utf8');
    await fs.writeFile(
      path.join(temporaryRoot, 'index.js'),
      `
      const { env: inherited } = process;
      inherited.ROOT_DESTRUCTURED;
      const proc = globalThis.process;
      proc.env.GLOBAL_PROCESS_ALIAS;
      const envAlias = process.env;
      envAlias.LOCAL_ENV_ALIAS;
      process?.env?.OPTIONAL_CHAIN_KEY;
      const KEY = 'STATIC_BRACKET_KEY';
      process['env'][KEY];
      process.env[KEY === 'STATIC_BRACKET_KEY' ? 'CONDITIONAL_A' : 'CONDITIONAL_B'];
      process.env[computeKey()];
      const passthrough = process.env;
    `,
      'utf8',
    );
    await fs.writeFile(
      path.join(temporaryRoot, 'scripts', 'setup.sh'),
      `#!/usr/bin/env bash
      echo "$EXTERNAL_ONE"
      echo "${'${EXTERNAL_TWO:-fallback}'}"
      RUNTIME="${'${1:-node}'}"
      echo "$RUNTIME"
    `,
      'utf8',
    );

    const inventory = await collectEnvironmentInventory(temporaryRoot);
    const names = new Set(inventory.entries.map(entry => entry.key));
    for (const key of [
      'ROOT_DESTRUCTURED',
      'GLOBAL_PROCESS_ALIAS',
      'LOCAL_ENV_ALIAS',
      'OPTIONAL_CHAIN_KEY',
      'STATIC_BRACKET_KEY',
      'CONDITIONAL_A',
      'CONDITIONAL_B',
    ])
      assert.ok(names.has(key), `${key} should be discovered`);
    assert.equal(inventory.dynamic.filter(item => item.scope === 'production').length, 1);
    assert.equal(inventory.dynamic[0].expression, 'process.env[computeKey()]');
    assert.deepEqual(inventory.shellVariables.map(item => item.key).sort(), ['EXTERNAL_ONE', 'EXTERNAL_TWO']);
    assert.equal(names.has('SHOULD_NEVER_BE_READ'), false, '.env content must not be scanned or imported');

    await assert.rejects(
      syncEnvironmentArtifacts(temporaryRoot, { strict: true }),
      /computed process\.env access production/,
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('.env.example and the environment inventory report stay synchronized', async () => {
  const result = await syncEnvironmentArtifacts(root, { check: true, strict: true });
  assert.equal(result.upToDate, true, `stale generated files: ${result.changes.join(', ')}`);

  const [example, report] = await Promise.all([
    fs.readFile(path.join(root, '.env.example'), 'utf8'),
    fs.readFile(path.join(root, 'docs/ENVIRONMENT_VARIABLES.md'), 'utf8'),
  ]);
  assert.match(example, /# OCHA_HOST_PREFLIGHT_COMPLETED=1/);
  assert.match(example, /GROQ_API_KEY=\s*$/m);
  assert.match(example, /Source coverage: 31 application\/secret names, 4 internal markers, 23 host\/OS names\./);
  const documentedKeys = new Set(
    example
      .split(/\r?\n/)
      .map(line => line.match(/^\s*#?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
      .filter(Boolean),
  );
  for (const entry of result.inventory.entries.filter(item =>
    ['application-config', 'secret'].includes(item.category),
  )) {
    assert.ok(documentedKeys.has(entry.key), `${entry.key} must be documented in .env.example`);
  }
  assert.equal(documentedKeys.has('QWEN_API_KEY'), false, 'test-only keys must not enter .env.example');
  assert.match(report, /Internal runtime marker/);
  assert.match(report, /src\/index\.js:69/);
  assert.match(report, /Application configuration \| 23/);
  assert.match(report, /Named JavaScript environment access sites: \*\*272\*\*/);
  assert.match(report, /Shell environment expansion sites: \*\*9\*\*/);
  assert.match(report, /Dotenv load\/reload sites: \*\*7\*\*/);
});
