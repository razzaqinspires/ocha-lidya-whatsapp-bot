import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';

const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const SHELL_EXTENSIONS = new Set(['.sh']);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'data',
  '.release',
  'coverage',
  'dist',
  'build',
  'tmp',
  'logs',
  'sessions',
]);
const AMBIENT_ENV = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'SYSTEMROOT',
  'WINDIR',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'VIRTUAL_ENV',
  'PYTHONHOME',
  'PYTHONPATH',
  'LD_LIBRARY_PATH',
  'DYLD_LIBRARY_PATH',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'TERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'npm_execpath',
]);
const INTERNAL_ENV = new Set([
  'OCHA_HOST_PREFLIGHT_COMPLETED',
  'OCHA_HANDOFF_FROM_PID',
  'OCHA_BOOTSTRAP_HANDOFF_CONSUMED',
  'OCHA_HOST_BOOTSTRAP_FORCE',
]);
const RUNTIME_CONFIG_OVERRIDES = new Set([
  'OCHA_NADI_REPO_URL',
  'OCHA_NADI_REF',
  'OCHA_NADI_HOME',
  'OCHA_NADI_SOURCE_DIR',
  'OCHA_NADI_SHA256',
  'OCHA_NADI_UPDATE',
  'OCHA_NADI_BASE_URL',
  'OCHA_NADI_PORT',
  'OCHA_NADI_DATA_DIR',
  'OCHA_AC_HEARTBEAT_MS',
  'OCHA_PYTHON_BIN',
  'OCHA_KERNEL_DASHBOARD_DIR',
  'OCHA_KERNEL_TELEMETRY_FILE',
  'OCHA_PROJECT_LIBRARY_ROOT',
  'OCHA_ROO_ROOT',
  'OCHA_PRIVATE_RUNTIME_REQUIRED',
  'OCHA_PRIVATE_RUNTIME_PATH',
  'OCHA_RENTAL_API_HOST',
  'OCHA_RENTAL_API_PORT',
  'OCHA_RENTAL_API_TUNNEL',
  'CLOUDFLARED_BIN',
  'OCHA_PRETTIER_BIN',
  'NEXORA_BOOTSTRAP_DRY_RUN',
  'CHATNIVO_URL',
  'CHATNIVO_EXPORT_DIR',
]);
const SECRET_ENV = new Set([
  'GITHUB_PAT',
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'OCHA_ROO_MASTER_KEY',
  'OCHA_NADI_API_TOKEN',
  'CHATNIVO_PASSWORD',
  'CHATNIVO_EMAIL',
]);
const SHELL_BUILTINS = new Set([
  'BASH',
  'BASHOPTS',
  'BASHPID',
  'BASH_ARGC',
  'BASH_ARGV',
  'BASH_ARGV0',
  'BASH_COMMAND',
  'BASH_LINENO',
  'BASH_SOURCE',
  'BASH_SUBSHELL',
  'BASH_VERSINFO',
  'DIRSTACK',
  'EUID',
  'FUNCNAME',
  'GROUPS',
  'HOSTNAME',
  'HOSTTYPE',
  'IFS',
  'LINENO',
  'MACHTYPE',
  'OLDPWD',
  'OPTARG',
  'OPTIND',
  'OSTYPE',
  'PIPESTATUS',
  'PPID',
  'PWD',
  'RANDOM',
  'SECONDS',
  'SHELLOPTS',
  'SHLVL',
  'UID',
  '_',
]);
const GENERATED_START = '# BEGIN OCHA AUTO-DISCOVERED ENVIRONMENT VARIABLES';
const GENERATED_END = '# END OCHA AUTO-DISCOVERED ENVIRONMENT VARIABLES';

function propertyName(node) {
  if (!node) return null;
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name;
  if (node.computed && node.property?.type === 'Literal' && typeof node.property.value === 'string')
    return node.property.value;
  return null;
}

function isProcessObject(node, processAliases = new Set()) {
  if (node?.type === 'Identifier') return node.name === 'process' || processAliases.has(node.name);
  return (
    node?.type === 'MemberExpression' &&
    ['global', 'globalThis'].includes(node.object?.name) &&
    propertyName(node) === 'process'
  );
}

function isProcessEnv(node, declarations = {}) {
  const processAliases = declarations.processAliases || new Set();
  return (
    node?.type === 'MemberExpression' && isProcessObject(node.object, processAliases) && propertyName(node) === 'env'
  );
}

function staticString(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value?.cooked ?? null;
  return null;
}

function identifierName(node) {
  return node?.type === 'Identifier' ? node.name : null;
}

function objectPropertyName(node) {
  if (node?.type !== 'Property') return null;
  if (!node.computed && node.key?.type === 'Identifier') return node.key.name;
  if (node.key?.type === 'Literal' && typeof node.key.value === 'string') return node.key.value;
  return null;
}

function unwrapArrayInitializer(node) {
  if (node?.type === 'ArrayExpression') return node;
  if (
    node?.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    node.callee.object?.type === 'Identifier' &&
    node.callee.object.name === 'Object' &&
    propertyName(node.callee) === 'freeze' &&
    node.arguments[0]?.type === 'ArrayExpression'
  ) {
    return node.arguments[0];
  }
  return null;
}

function walk(node, visitor, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visitor(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child.type === 'string') walk(child, visitor, node);
    } else if (value && typeof value.type === 'string') {
      walk(value, visitor, node);
    }
  }
}

function sourceKind(relativePath) {
  if (relativePath.startsWith('test/')) return 'test';
  if (relativePath.startsWith('.private/contributions/')) return 'preserved-source';
  if (
    relativePath.startsWith('src/') ||
    relativePath.startsWith('scripts/') ||
    relativePath.startsWith('.private/') ||
    relativePath.startsWith('apps/') ||
    !relativePath.includes('/')
  )
    return 'production';
  return 'other';
}

function addUsage(entries, key, usage) {
  if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
  if (!entries.has(key)) entries.set(key, []);
  const usages = entries.get(key);
  const signature = `${usage.file}:${usage.line}:${usage.access}:${usage.expression}`;
  if (!usages.some(item => `${item.file}:${item.line}:${item.access}:${item.expression}` === signature))
    usages.push(usage);
}

function buildStaticDeclarations(ast) {
  const arrays = new Map();
  const providerMaps = new Map();
  const constants = new Map();
  const processAliases = new Set();
  const envAliases = new Set();

  // Two passes allow simple aliases to be used regardless of declaration order.
  walk(ast, node => {
    if (node.type !== 'VariableDeclarator' || !node.init) return;
    if (node.id?.type === 'Identifier' && isProcessObject(node.init, processAliases)) processAliases.add(node.id.name);
  });

  walk(ast, node => {
    if (node.type !== 'VariableDeclarator' || !node.init) return;
    if (node.id?.type === 'Identifier') {
      const key = staticString(node.init);
      if (key !== null) constants.set(node.id.name, key);
      if (isProcessEnv(node.init, { processAliases })) envAliases.add(node.id.name);
      const arrayInitializer = unwrapArrayInitializer(node.init);
      if (arrayInitializer) {
        const values = arrayInitializer.elements.map(staticString).filter(value => typeof value === 'string');
        if (values.length) arrays.set(node.id.name, values);
      }
      if (node.init.type === 'ObjectExpression') {
        const envNames = [];
        walk(node.init, child => {
          if (child.type !== 'Property' || objectPropertyName(child) !== 'env') return;
          const value = staticString(child.value);
          if (value && /^[A-Z][A-Z0-9_]*$/.test(value)) envNames.push(value);
        });
        if (envNames.length) providerMaps.set(node.id.name, [...new Set(envNames)]);
      }
    }

    // `const { env: runtimeEnv } = process; runtimeEnv.KEY`.
    if (node.id?.type === 'ObjectPattern' && isProcessObject(node.init, processAliases)) {
      for (const property of node.id.properties) {
        if (property.type !== 'Property' || objectPropertyName(property) !== 'env') continue;
        const alias = property.value?.type === 'Identifier' ? property.value.name : null;
        if (alias) envAliases.add(alias);
      }
    }
  });

  return { arrays, providerMaps, constants, processAliases, envAliases };
}

function resolveDynamicNames(expression, declarations, contextualArrays = new Map()) {
  if (!expression) return [];
  const direct = staticString(expression);
  if (direct) return [direct];

  if (expression.type === 'Identifier') {
    if (declarations.constants.has(expression.name)) return [declarations.constants.get(expression.name)];
    const values = contextualArrays.get(expression.name) || declarations.arrays.get(expression.name) || [];
    return values.filter(value => /^[A-Z][A-Z0-9_]*$/.test(value));
  }

  if (expression.type === 'ConditionalExpression' || expression.type === 'LogicalExpression') {
    return [
      ...new Set([
        ...resolveDynamicNames(expression.consequent || expression.left, declarations, contextualArrays),
        ...resolveDynamicNames(expression.alternate || expression.right, declarations, contextualArrays),
      ]),
    ];
  }

  // Example: process.env[PROVIDERS[provider].env]
  if (expression.type === 'MemberExpression' && propertyName(expression) === 'env') {
    let object = expression.object;
    while (object?.type === 'MemberExpression') object = object.object;
    const name = identifierName(object);
    return declarations.providerMaps.get(name) || [];
  }
  return [];
}

function addDynamicUsage(entries, dynamic, names, usage) {
  if (names.length) {
    for (const name of names) addUsage(entries, name, { ...usage, resolution: 'static-dynamic-map' });
  } else {
    dynamic.push(usage);
  }
}

function scanJavaScript(source, relativePath, entries, dynamic, passthrough, dotenvLoadSites) {
  const ast = parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowHashBang: true,
    locations: true,
  });
  const declarations = buildStaticDeclarations(ast);
  const seen = new Set();

  function usage(node, accessKind) {
    return {
      file: relativePath,
      line: node.loc?.start.line || 1,
      access: accessKind,
      expression: source.slice(node.start, node.end).replace(/\s+/g, ' ').slice(0, 180),
      scope: sourceKind(relativePath),
    };
  }

  function isEnvironmentBase(node) {
    return isProcessEnv(node, declarations) || (node?.type === 'Identifier' && declarations.envAliases.has(node.name));
  }

  function visit(node, parent = null, contextualArrays = new Map()) {
    if (!node || typeof node !== 'object') return;

    if (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'ObjectPattern' &&
      (isProcessEnv(node.init, declarations) ||
        (node.init?.type === 'Identifier' && declarations.envAliases.has(node.init.name)))
    ) {
      for (const element of node.id.properties) {
        if (element.type !== 'Property') continue;
        const key = element.computed ? staticString(element.key) : element.key?.name || element.key?.value;
        if (typeof key === 'string') addUsage(entries, key, usage(element, 'destructure'));
        else if (element.computed)
          addDynamicUsage(
            entries,
            dynamic,
            resolveDynamicNames(element.key, declarations, contextualArrays),
            usage(element, 'computed-destructure'),
          );
      }
    }

    if (node.type === 'MemberExpression' && isEnvironmentBase(node.object)) {
      const key = propertyName(node);
      if (key) addUsage(entries, key, usage(node, node.computed ? 'bracket' : 'dot'));
      else
        addDynamicUsage(
          entries,
          dynamic,
          resolveDynamicNames(node.property, declarations, contextualArrays),
          usage(node, 'computed-dynamic'),
        );
    }

    if (isProcessEnv(node, declarations)) {
      const parentIsMemberBase = parent?.type === 'MemberExpression' && parent.object === node;
      const parentIsAliasInit = parent?.type === 'VariableDeclarator' && parent.init === node;
      const parentIsDestructureInit =
        parent?.type === 'VariableDeclarator' && parent.init === node && parent.id?.type === 'ObjectPattern';
      if (!parentIsMemberBase && !parentIsAliasInit && !parentIsDestructureInit) {
        const record = usage(node, 'environment-object-pass-through');
        const signature = `${record.file}:${record.line}:${record.expression}`;
        if (!seen.has(signature)) {
          passthrough.push(record);
          seen.add(signature);
        }
      }
    }

    // dotenv load sites: side-effect imports plus explicit dotenv.config() calls.
    if (node.type === 'ImportDeclaration' && node.source?.value === 'dotenv/config') {
      dotenvLoadSites.push({ file: relativePath, line: node.loc?.start.line || 1, kind: 'dotenv/config import' });
    }
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      const dotenvConfig =
        callee?.type === 'MemberExpression' &&
        propertyName(callee) === 'config' &&
        ((callee.object?.type === 'Identifier' && callee.object.name === 'dotenv') ||
          (callee.object?.type === 'CallExpression' &&
            callee.object.callee?.name === 'require' &&
            staticString(callee.object.arguments?.[0]) === 'dotenv'));
      if (dotenvConfig)
        dotenvLoadSites.push({ file: relativePath, line: node.loc?.start.line || 1, kind: 'dotenv.config() call' });
    }

    let childContext = contextualArrays;
    if (
      node.type === 'ForOfStatement' &&
      node.left?.type === 'VariableDeclaration' &&
      node.right?.type === 'Identifier'
    ) {
      const declaration = node.left.declarations?.[0];
      if (declaration?.id?.type === 'Identifier') {
        const names = declarations.arrays.get(node.right.name);
        if (names) childContext = new Map(contextualArrays).set(declaration.id.name, names);
      }
    }
    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'MemberExpression' &&
      ['map', 'forEach'].includes(propertyName(node.callee))
    ) {
      const sourceArray =
        node.callee.object?.type === 'Identifier'
          ? declarations.arrays.get(node.callee.object.name)
          : node.callee.object?.type === 'ArrayExpression'
            ? node.callee.object.elements.map(staticString).filter(value => typeof value === 'string')
            : null;
      const callback = node.arguments[0];
      const parameter = callback?.params?.[0];
      if (sourceArray && parameter?.type === 'Identifier')
        childContext = new Map(contextualArrays).set(parameter.name, sourceArray);
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child.type === 'string') visit(child, node, childContext);
      } else if (value && typeof value.type === 'string') {
        visit(value, node, childContext);
      }
    }
  }

  visit(ast);
}

async function listFiles(root, extensions) {
  const output = [];
  async function walkDirectory(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walkDirectory(path.join(directory, entry.name));
      } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        output.push(path.join(directory, entry.name));
      }
    }
  }
  await walkDirectory(root);
  return output.sort();
}

function scanShellEnvironment(source, relativePath, shellVariables) {
  // Shell variables assigned inside the script are implementation locals, not .env inputs.
  const assigned = new Set();
  const assignmentPattern =
    /(?:^|[\s;])(?:export\s+|local\s+|readonly\s+|declare\s+[a-zA-Z-]*\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/gm;
  for (const match of source.matchAll(assignmentPattern)) {
    const lineStart = source.lastIndexOf('\n', match.index) + 1;
    const prefix = source.slice(lineStart, match.index).trim();
    const lineEnd = source.indexOf('\n', match.index);
    const lineText = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
    // `env NAME=value ...` supplies a child-process environment; it is not a
    // shell-local declaration and later reads of NAME may still be host inputs.
    if (/\benv\s+/.test(lineText)) continue;
    assigned.add(match[1]);
  }
  const loopVariablePattern = /\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/g;
  for (const match of source.matchAll(loopVariablePattern)) assigned.add(match[1]);

  // Capture `$NAME`, `${NAME}`, and `${NAME:-default}` / `:=` / `:+` / `:?` forms.
  const matches = [
    ...source.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g),
    ...source.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g),
  ].sort((a, b) => a.index - b.index);
  for (const match of matches) {
    const key = match[1];
    if (SHELL_BUILTINS.has(key) || assigned.has(key)) continue;
    if (!shellVariables.has(key)) shellVariables.set(key, []);
    const line = source.slice(0, match.index).split('\n').length;
    const usages = shellVariables.get(key);
    if (!usages.some(item => item.file === relativePath && item.line === line)) {
      usages.push({ file: relativePath, line, access: 'shell-environment-expansion', scope: 'shell-tooling' });
    }
  }
}

function classifyEnvironmentKey(key, scopes) {
  if (INTERNAL_ENV.has(key)) return 'internal-runtime';
  if (AMBIENT_ENV.has(key)) return 'host-environment';
  if (RUNTIME_CONFIG_OVERRIDES.has(key)) return 'runtime-config-override';
  if (!scopes.has('production') && scopes.has('test')) return 'test-only';
  if (
    SECRET_ENV.has(key) ||
    /(?:^|_)(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|TOKEN|PASSWORD|PASSWD|SECRET|PRIVATE_KEY|CLIENT_SECRET|PAT|CREDENTIALS?)(?:_|$)/i.test(
      key,
    )
  )
    return 'secret';
  if (scopes.has('production')) return 'application-config';
  return 'preserved-source';
}

export async function collectEnvironmentInventory(root) {
  const entries = new Map();
  const dynamic = [];
  const passthrough = [];
  const shellVariables = new Map();
  const dotenvLoadSites = [];
  const parseErrors = [];

  // Scan the whole project root, not only today's known source folders. Ignored runtime/vendor
  // directories are excluded above; all first-party JS files, including future root entrypoints,
  // apps, scripts, tests and private runtime source, are included.
  const codeFiles = await listFiles(root, CODE_EXTENSIONS);
  for (const file of codeFiles) {
    const relativePath = path.relative(root, file).split(path.sep).join('/');
    const source = await fs.readFile(file, 'utf8');
    try {
      scanJavaScript(source, relativePath, entries, dynamic, passthrough, dotenvLoadSites);
    } catch (error) {
      parseErrors.push({ file: relativePath, message: error.message });
    }
  }

  const shellFiles = await listFiles(root, SHELL_EXTENSIONS);
  for (const file of shellFiles) {
    const relativePath = path.relative(root, file).split(path.sep).join('/');
    scanShellEnvironment(await fs.readFile(file, 'utf8'), relativePath, shellVariables);
  }

  const resolved = new Map();
  for (const [key, usages] of entries) {
    const scopes = new Set(usages.map(item => item.scope));
    resolved.set(key, {
      key,
      usages: usages.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
      production: scopes.has('production'),
      test: scopes.has('test'),
      preserved: scopes.has('preserved-source'),
      other: scopes.has('other'),
      category: classifyEnvironmentKey(key, scopes),
    });
  }

  return {
    root,
    codeFilesScanned: codeFiles.length,
    shellFilesScanned: shellFiles.length,
    entries: [...resolved.values()].sort((a, b) => a.key.localeCompare(b.key)),
    dynamic: dynamic.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    passthrough: passthrough.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    shellVariables: [...shellVariables.entries()]
      .map(([key, usages]) => ({ key, usages }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    dotenvLoadSites: dotenvLoadSites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    parseErrors,
  };
}

function parseExistingKeys(text) {
  const result = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*#?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) result.add(match[1]);
  }
  return result;
}

function replaceGeneratedBlock(text, block) {
  const start = text.indexOf(GENERATED_START);
  const end = text.indexOf(GENERATED_END);
  if (start === -1 && end === -1) return `${text.trimEnd()}\n\n${block}\n`;
  if (start === -1 || end === -1 || end < start)
    throw new Error('Penanda generated block .env.example tidak lengkap atau urutannya salah.');
  const endAfter = end + GENERATED_END.length;
  return `${text.slice(0, start).trimEnd()}\n\n${block}\n${text.slice(endAfter).trimStart()}`.trimEnd() + '\n';
}

function renderGeneratedExampleBlock(inventory, existingText) {
  const curated = parseExistingKeys(existingText.split(GENERATED_START)[0]);
  const projectEntries = inventory.entries.filter(
    entry => entry.production && ['application-config', 'secret'].includes(entry.category),
  );
  const internalEntries = inventory.entries.filter(entry => entry.production && entry.category === 'internal-runtime');
  const hostEntries = inventory.entries.filter(entry => entry.production && entry.category === 'host-environment');
  const newlyDiscovered = inventory.entries
    .filter(
      entry =>
        entry.production &&
        ['application-config', 'secret', 'internal-runtime'].includes(entry.category) &&
        !curated.has(entry.key),
    )
    .map(entry => ({
      key: entry.key,
      category: entry.category,
      source: entry.usages.find(item => item.scope === 'production')?.file || 'unknown',
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const lines = [
    GENERATED_START,
    '# Generated automatically by scripts/sync-env-example.js during npm start, npm run dev, and npm test.',
    '# Do not place real credentials here. The scanner reads source code only; it never reads .env values.',
    `# Source coverage: ${projectEntries.length} application/secret names, ${internalEntries.length} internal markers, ${hostEntries.length} host/OS names.`,
    `# Host/OS names (inherited, not project .env settings): ${hostEntries.map(entry => entry.key).join(', ') || 'none'}.`,
    `# Ocha-managed markers (do not set manually): ${internalEntries.map(entry => entry.key).join(', ') || 'none'}.`,
  ];
  if (!newlyDiscovered.length) lines.push('# No newly discovered production keys require review.');
  for (const item of newlyDiscovered) {
    if (item.category === 'internal-runtime') {
      lines.push(`# INTERNAL MARKER: discovered in ${item.source}; Ocha-managed, do not set manually.`);
      lines.push(`# ${item.key}=`);
    } else {
      lines.push(`# REVIEW: discovered in ${item.source}; confirm purpose and safe default before enabling.`);
      lines.push(`# ${item.key}=`);
    }
  }
  lines.push(GENERATED_END);
  return lines.join('\n');
}

function renderInventoryMarkdown(inventory) {
  const rows = inventory.entries.map(entry => {
    const locations = entry.usages.map(item => `\`${item.file}:${item.line}\``).join(', ');
    const classification =
      entry.category === 'internal-runtime'
        ? 'Internal runtime marker'
        : entry.category === 'host-environment'
          ? 'Host / OS environment'
          : entry.category === 'secret'
            ? 'Secret / credential'
            : entry.category === 'runtime-config-override'
              ? 'Legacy config-file override (do not add to .env)'
              : entry.category === 'test-only'
                ? 'Test only'
                : entry.category === 'preserved-source'
                  ? 'Preserved source only'
                  : 'Application configuration';
    return `| \`${entry.key}\` | ${classification} | ${entry.production ? 'Yes' : 'No'} | ${entry.test ? 'Yes' : 'No'} | ${locations} |`;
  });

  const dynamicRows = inventory.dynamic.map(
    item =>
      `| ${item.scope} | \`${item.file}:${item.line}\` | \`${item.expression.replace(/\|/g, '\\|')}\` | Not statically resolved |`,
  );
  const shellRows = inventory.shellVariables.flatMap(item =>
    item.usages.map(
      usage =>
        `| \`${item.key}\` | \`${usage.file}:${usage.line}\` | Shell installer / host tooling; not loaded from dotenv automatically |`,
    ),
  );
  const passRows = inventory.passthrough.map(item => `- \`${item.file}:${item.line}\` — ${item.expression}`);
  const dotenvRows = inventory.dotenvLoadSites.map(item => `| \`${item.file}:${item.line}\` | ${item.kind} |`);
  const errorRows = inventory.parseErrors.map(item => `- \`${item.file}\`: ${item.message}`);
  const categoryLabels = [
    ['application-config', 'Application configuration', 'Yes'],
    ['secret', 'Secret / credential', 'Yes, empty placeholder'],
    ['runtime-config-override', 'Legacy config-file override', 'No; use config/runtime.json'],
    ['host-environment', 'Host / OS environment', 'No'],
    ['internal-runtime', 'Internal runtime marker', 'No; commented for reference'],
    ['test-only', 'Test only', 'No'],
    ['preserved-source', 'Preserved source only', 'No'],
  ];
  const categoryCounts = new Map();
  for (const entry of inventory.entries)
    categoryCounts.set(entry.category, (categoryCounts.get(entry.category) || 0) + 1);
  const summaryRows = categoryLabels.map(
    ([category, label, dotenv]) => `| ${label} | ${categoryCounts.get(category) || 0} | ${dotenv} |`,
  );
  const unresolvedProduction = inventory.dynamic.filter(item => item.scope === 'production').length;
  const unresolvedTests = inventory.dynamic.filter(item => item.scope === 'test').length;
  const staticAccessSites = inventory.entries.reduce((total, entry) => total + entry.usages.length, 0);
  const staticProductionSites = inventory.entries.reduce(
    (total, entry) => total + entry.usages.filter(item => item.scope === 'production').length,
    0,
  );
  const staticTestSites = inventory.entries.reduce(
    (total, entry) => total + entry.usages.filter(item => item.scope === 'test').length,
    0,
  );
  const shellExpansionSites = inventory.shellVariables.reduce((total, entry) => total + entry.usages.length, 0);

  return [
    '# Environment Variable Inventory',
    '',
    `Generated from the entire first-party Ocha tree using Acorn AST analysis. JavaScript files scanned: **${inventory.codeFilesScanned}**; shell files scanned: **${inventory.shellFilesScanned}**; distinct statically identified names: **${inventory.entries.length}**.`,
    '',
    '> This is a source inventory, not a statement that every variable must be placed in `.env`. Internal markers and host-provided variables are identified separately. Secret values are never read by this scanner.',
    '',
    '## Summary',
    '',
    '| Classification | Names | Add to `.env.example`? |',
    '|---|---:|---|',
    ...summaryRows,
    '',
    `- Named JavaScript environment access sites: **${staticAccessSites + inventory.dynamic.length}** total (${staticAccessSites} statically resolved; ${inventory.dynamic.length} computed/unresolved). Static locations: ${staticProductionSites} production and ${staticTestSites} test.`,
    `- Unresolved computed accesses: **${inventory.dynamic.length}** total (${unresolvedProduction} production, ${unresolvedTests} test).`,
    `- Shell environment expansion sites: **${shellExpansionSites}**.`,
    `- Whole-environment pass-through call sites: **${inventory.passthrough.length}**. These inherit host variables and do not represent individually named Ocha settings.`,
    `- Dotenv load/reload sites: **${inventory.dotenvLoadSites.length}**. The main bot entrypoint loads \`.env\` once through \`dotenv/config\`; the auto-Git watcher can reload it after a file change.`,
    '',
    '## Dotenv load and reload locations',
    '',
    '| Source location | Mechanism |',
    '|---|---|',
    ...(dotenvRows.length ? dotenvRows : ['| — | No dotenv loader found |']),
    '',
    '`.env.example` is not loaded automatically; it is a safe template for creating `.env`. The application reads `.env` through `dotenv` imports/calls above.',
    '',
    '## Static environment reads',
    '',
    '| Name | Classification | Production source | Test source | Source locations |',
    '|---|---|---:|---:|---|',
    ...(rows.length ? rows : ['| — | — | — | — | — |']),
    '',
    '## Dynamic environment access',
    '',
    'These expressions use a computed property name. Entries resolvable from a local literal, constant, literal array, or provider registry are included in the static table; unresolved expressions remain listed here for manual review.',
    '',
    '| Scope | Location | Expression | Resolution |',
    '|---|---|---|---|',
    ...(dynamicRows.length ? dynamicRows : ['| — | — | — | No unresolved dynamic access |']),
    '',
    '## Shell installer environment overrides',
    '',
    'These are shell-time overrides, not Node.js `dotenv` configuration. The scanner records direct `$NAME`, `${NAME}`, and default/assignment/alternate/error parameter-expansion forms.',
    '',
    '| Name | Location | Usage |',
    '|---|---|---|',
    ...(shellRows.length ? shellRows : ['| — | — | — |']),
    '',
    '## Whole-environment pass-through',
    '',
    'The following code paths pass the inherited `process.env` object to another process or API. This scanner does not infer every key present on the host; review these call sites when changing child-process boundaries.',
    '',
    ...(passRows.length ? passRows : ['- No whole-environment pass-through detected.']),
    '',
    '## Scanner integrity',
    '',
    ...(errorRows.length ? errorRows : ['- All scanned JavaScript files parsed successfully.']),
    '',
    '## Rules',
    '',
    '- `Internal runtime marker`: assigned or consumed by Ocha during startup/handoff; do not set manually in `.env`.',
    '- `Host / OS environment`: inherited from the host operating system or Node/npm; do not copy into `.env` unless deliberately overriding a host default.',
    '- `Secret / credential`: keep the value only in ignored `.env` or the deployment secret manager. `.env.example` must contain empty placeholders only.',
    '- `Legacy config-file override`: compatibility input for deployments that still inject old non-secret OCHA_* values; normal configuration belongs in `config/runtime.json`, not `.env`.',
    '- `Test only`: referenced by tests but not by the production runtime; it is not added to `.env.example`.',
    '- `Preserved source only`: found only in preserved contribution material; not considered an active runtime setting.',
    '- New production keys not already curated in `.env.example` are added to its generated block as commented review items.',
    '- `npm test` uses strict mode and fails when a production computed environment read cannot be resolved to a known key.',
    '',
  ].join('\n');
}

export async function syncEnvironmentArtifacts(root, { check = false, strict = false } = {}) {
  const inventory = await collectEnvironmentInventory(root);
  if (inventory.parseErrors.length) {
    const details = inventory.parseErrors.map(item => `${item.file}: ${item.message}`).join('\n');
    throw new Error(`Environment scan tidak lengkap karena source gagal diparse:\n${details}`);
  }

  const envExamplePath = path.join(root, '.env.example');
  const reportPath = path.join(root, 'docs', 'ENVIRONMENT_VARIABLES.md');
  const currentEnvExample = await fs.readFile(envExamplePath, 'utf8');
  const generatedBlock = renderGeneratedExampleBlock(inventory, currentEnvExample);
  const nextEnvExample = replaceGeneratedBlock(currentEnvExample, generatedBlock);
  const nextReport = renderInventoryMarkdown(inventory);

  const changes = [];
  if (nextEnvExample !== currentEnvExample) changes.push('.env.example');
  let currentReport = '';
  try {
    currentReport = await fs.readFile(reportPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (nextReport !== currentReport) changes.push('docs/ENVIRONMENT_VARIABLES.md');

  if (!check) {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    if (nextEnvExample !== currentEnvExample) await fs.writeFile(envExamplePath, nextEnvExample, 'utf8');
    if (nextReport !== currentReport) await fs.writeFile(reportPath, nextReport, 'utf8');
  }

  const unresolvedProduction = inventory.dynamic.filter(item => item.scope === 'production');
  if (strict && unresolvedProduction.length) {
    const details = unresolvedProduction.map(item => `${item.file}:${item.line} ${item.expression}`).join('\n');
    throw new Error(
      `Ada ${unresolvedProduction.length} computed process.env access production yang belum dapat dipetakan. Selesaikan atau dokumentasikan sebelum test/release:\n${details}`,
    );
  }

  return { inventory, changes, upToDate: changes.length === 0 };
}

export const environmentInventoryConstants = Object.freeze({
  ambient: [...AMBIENT_ENV],
  internal: [...INTERNAL_ENV],
  secret: [...SECRET_ENV],
  runtimeConfigOverrides: [...RUNTIME_CONFIG_OVERRIDES],
  shellBuiltins: [...SHELL_BUILTINS],
});
