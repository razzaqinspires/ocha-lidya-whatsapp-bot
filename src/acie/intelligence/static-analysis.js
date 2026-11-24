import fs from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { identifyLanguage, identifyRuntime, detectModuleSystem } from './language-discovery.js';
import { discoverFunctionSignatures, discoverImports, discoverOutputAndErrorHints, discoverRuntimeRequirements } from './interface-discovery.js';

const CODE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx', '.py', '.go', '.php', '.java', '.rs', '.sh', '.bash']);
const TEXT_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS,
  '.json', '.jsonc', '.json5', '.env', '.ini', '.conf', '.cfg', '.toml', '.yaml', '.yml', '.xml',
  '.txt', '.md', '.properties', '.pem', '.key', '.crt', '.cer', '.pub', '.lock', '.mod', '.sum',
  '.gradle', '.kts', '.sql', '.graphql', '.gql', '.csv'
]);
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ANALYSIS_BYTES = 64 * 1024 * 1024;
const MAX_ANALYZED_FILES = 5000;
const MAX_RETAINED_SNIPPET_BYTES = 8 * 1024 * 1024;
const MAX_CANDIDATES = 10_000;
const MAX_SECURITY_FINDINGS = 2_000;
const PLACEHOLDER_VALUES = new Set(['changeme', 'change-me', 'your-key', 'your_api_key', 'your-api-key', 'replace-me', 'example', 'placeholder', 'none', 'null', 'undefined', 'todo']);

const RISK_PATTERNS = [
  { id: 'dynamic-code-evaluation', severity: 'high', pattern: /\beval\s*\(|new\s+Function\s*\(/g },
  { id: 'shell-execution', severity: 'high', pattern: /\b(?:exec|execSync|spawn|spawnSync|shell_exec|system|passthru)\s*\(/g },
  { id: 'dynamic-import', severity: 'medium', pattern: /\bimport\s*\(/g },
  { id: 'filesystem-access', severity: 'medium', pattern: /\b(?:readFile|writeFile|unlink|rm|rmdir|createWriteStream|open)\s*\(/g },
  { id: 'environment-access', severity: 'low', pattern: /\bprocess\.env\b|\bos\.environ\b/g },
  { id: 'network-access', severity: 'medium', pattern: /\b(?:fetch\s*\(|https?\.request\s*\(|axios\.|requests\.|http\.Get\s*\()/g }
];

const CREDENTIAL_PATTERNS = [
  { id: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: 'possible-embedded-credential', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/gi },
  { id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { id: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { id: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { id: 'stripe-secret', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { id: 'jwt-like-token', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { id: 'private-key-marker', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { id: 'credential-assignment', pattern: /^\s*(?:export\s+)?(?:[A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|CLIENT[_-]?SECRET|SECRET[_-]?KEY|PASSWORD|PASSWD|PRIVATE[_-]?KEY|AUTHORIZATION)[A-Z0-9_]*)\s*[:=]\s*["']?([^\s"'`;,#]{8,})/gim, capture: 1 }
];

async function walk(root, current = root, files = []) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link is not allowed in original vault: ${path.relative(root, full)}`);
    if (entry.isDirectory()) await walk(root, full, files);
    else if (entry.isFile()) files.push(full);
    else throw new Error(`Unsupported filesystem entry in original vault: ${path.relative(root, full)}`);
  }
  return files;
}

function lineNumber(text, index) { return text.slice(0, index).split('\n').length; }
function isPlaceholder(value) {
  const clean = String(value || '').trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  return PLACEHOLDER_VALUES.has(clean) || /^(?:x{4,}|\*{4,}|<[^>]+>|\$\{[^}]+\}|your[-_ ]?.*(?:key|token|secret)|insert[-_ ]?.*)$/i.test(clean);
}
function pushBounded(target, value, limit = MAX_CANDIDATES) {
  if (target.length < limit) target.push(value);
}
function discoverFunctions(language, text) {
  const patterns = {
    javascript: [/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g, /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g],
    typescript: [/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g, /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g],
    python: [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm],
    go: [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/gm],
    php: [/\bfunction\s+&?\s*([A-Za-z_]\w*)\s*\(/g],
    java: /(?:public|protected|private|static|final|synchronized|abstract|native|\s)+[\w<>?,.\[\]]+\s+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:throws\s+[\w, ]+)?\s*\{/g,
    rust: [/\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*[<(]/g],
    bash: [/^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\s*\)\s*\{/gm]
  };
  const found = new Set();
  const selected = Array.isArray(patterns[language]) ? patterns[language] : patterns[language] ? [patterns[language]] : [];
  for (const regex of selected) for (const match of text.matchAll(regex)) if (match[1]) found.add(match[1]);
  return [...found].sort();
}

function parseDependencies(filePath, text) {
  const base = path.basename(filePath).toLowerCase();
  try {
    if (base === 'package.json') {
      const parsed = JSON.parse(text);
      return Object.entries({ ...parsed.dependencies, ...parsed.optionalDependencies, ...parsed.devDependencies }).map(([name, version]) => ({ name, version: String(version), manager: 'npm' }));
    }
    if (base === 'requirements.txt') return text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => ({ name: line.split(/[<>=~!]/)[0].trim(), version: line, manager: 'pip' }));
    if (base === 'go.mod') return [...text.matchAll(/^\s*([\w./-]+)\s+(v[\w.+-]+)/gm)].map(match => ({ name: match[1], version: match[2], manager: 'go' }));
    if (base === 'composer.json') return Object.entries(JSON.parse(text).require || {}).map(([name, version]) => ({ name, version: String(version), manager: 'composer' }));
    if (base === 'cargo.toml') return [...text.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=\s*["']([^"']+)["']/gm)].map(match => ({ name: match[1], version: match[2], manager: 'cargo' }));
    if (base === 'pom.xml') return [...text.matchAll(/<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<version>([^<]+)<\/version>[\s\S]*?<\/dependency>/g)].map(match => ({ name: `${match[1]}:${match[2]}`, version: match[3], manager: 'maven' }));
    if (base === 'pyproject.toml') return [...text.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=\s*["']([^"']+)["']/gm)].filter(match => /[<>=~!]/.test(match[2])).map(match => ({ name: match[1], version: match[2], manager: 'pip/pyproject' }));
  } catch { return []; }
  return [];
}

function isTextCandidate(filePath, size) {
  const base = path.basename(filePath).toLowerCase();
  const ext = path.extname(base).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext) || CODE_EXTENSIONS.has(ext)) return true;
  if (['dockerfile', 'makefile', 'gemfile', 'procfile', '.npmrc', '.pypirc', '.gitconfig'].includes(base)) return true;
  return !ext && size <= 256 * 1024;
}

async function readUtf8Text(file) {
  const buffer = await fs.readFile(file);
  if (buffer.includes(0)) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return null; }
}

function detectCredentialFindings(text, file, risks) {
  for (const item of CREDENTIAL_PATTERNS) {
    item.pattern.lastIndex = 0;
    for (const match of text.matchAll(item.pattern)) {
      const candidate = item.capture ? match[item.capture] : match[0];
      if (item.capture && isPlaceholder(candidate)) continue;
      pushBounded(risks, {
        id: item.id === 'credential-assignment' ? 'possible-embedded-credential' : item.id,
        severity: 'critical', file, line: lineNumber(text, match.index), valueRedacted: true
      }, MAX_SECURITY_FINDINGS);
    }
  }
}

function discoverExports(language, text, file) {
  const names = new Set();
  for (const match of text.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of text.matchAll(/\bexport\s*\{([^}]+)\}/g)) for (const part of match[1].split(',')) {
    const name = part.trim().split(/\s+as\s+/)[0]; if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
  }
  for (const match of text.matchAll(/\b(?:module\.exports|exports)\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(match[1]);
  for (const match of text.matchAll(/\bmodule\.exports\s*=\s*\{([^}]+)\}/g)) for (const part of match[1].split(',')) {
    const name = part.trim().split(/\s*:/)[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
  }
  if (language === 'go') for (const match of text.matchAll(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Z][A-Za-z0-9_]*)\s*\(/gm)) names.add(match[1]);
  if (language === 'java') for (const match of text.matchAll(/\bpublic\s+(?:static\s+)?[\w<>?,.\[\]]+\s+([A-Za-z_]\w*)\s*\(/g)) names.add(match[1]);
  return [...names].slice(0, 500).map(name => ({ file, name, status: 'static-candidate' }));
}

export async function analyzeContribution(originalDirectory, limits = {}) {
  const files = await walk(originalDirectory);
  const boundedLimit = (key, fallback) => {
    const requested = Number(limits[key] ?? fallback);
    return Number.isFinite(requested) && requested >= 1 ? Math.min(fallback, Math.floor(requested)) : fallback;
  };
  const maxTextFileBytes = boundedLimit('maxTextFileBytes', MAX_TEXT_FILE_BYTES);
  const maxAnalysisBytes = boundedLimit('maxAnalysisBytes', MAX_ANALYSIS_BYTES);
  const maxAnalyzedFiles = boundedLimit('maxAnalyzedFiles', MAX_ANALYZED_FILES);
  const maxRetainedSnippetBytes = boundedLimit('maxRetainedSnippetBytes', MAX_RETAINED_SNIPPET_BYTES);
  const inventory = [];
  const languages = new Map();
  const functions = [];
  const functionDetails = [];
  const imports = [];
  const returnShapeCandidates = [];
  const exportCandidates = [];
  const errorHandling = [];
  const dependencies = [];
  const risks = [];
  const environmentVariables = new Set();
  const externalServices = new Set();
  const platformIdentifiers = new Set();
  const snippets = [];
  const analysisCoverage = { scannedFiles: 0, skippedFiles: 0, scannedBytes: 0, skipped: { oversized: 0, budget: 0, notText: 0, invalidUtf8OrBinary: 0 }, complete: true };
  let moduleSystem = 'not-applicable-or-unknown';
  let retainedSnippetBytes = 0;

  for (const full of files) {
    const relative = path.relative(originalDirectory, full).split(path.sep).join('/');
    const stat = await fs.stat(full);
    const ext = path.extname(full).toLowerCase();
    const candidate = isTextCandidate(full, stat.size);
    let text = '';
    if (!candidate) analysisCoverage.skipped.notText += 1;
    else if (stat.size > maxTextFileBytes) analysisCoverage.skipped.oversized += 1;
    else if (analysisCoverage.scannedFiles >= maxAnalyzedFiles || analysisCoverage.scannedBytes + stat.size > maxAnalysisBytes) analysisCoverage.skipped.budget += 1;
    else {
      const decoded = await readUtf8Text(full);
      if (decoded === null) analysisCoverage.skipped.invalidUtf8OrBinary += 1;
      else {
        text = decoded;
        analysisCoverage.scannedFiles += 1;
        analysisCoverage.scannedBytes += stat.size;
      }
    }
    if (candidate && !text) { analysisCoverage.skippedFiles += 1; analysisCoverage.complete = false; }
    const language = identifyLanguage(full, text);
    if (language !== 'unknown' && !language.endsWith('-manifest')) languages.set(language, (languages.get(language) || 0) + 1);
    if (text) {
      if (retainedSnippetBytes < maxRetainedSnippetBytes) {
        const snippet = text.slice(0, Math.min(250_000, maxRetainedSnippetBytes - retainedSnippetBytes));
        snippets.push({ file: relative, text: snippet });
        retainedSnippetBytes += Buffer.byteLength(snippet, 'utf8');
      }
      const isCodeFile = CODE_EXTENSIONS.has(ext) || (['javascript', 'typescript', 'python', 'go', 'php', 'java', 'rust', 'bash'].includes(language) && !['.env', '.md', '.txt'].includes(ext));
      if (isCodeFile || ['dockerfile', 'makefile', 'procfile'].includes(path.basename(full).toLowerCase())) {
        for (const name of discoverFunctions(language, text)) pushBounded(functions, { file: relative, language, name });
        for (const item of discoverFunctionSignatures(language, text, relative)) pushBounded(functionDetails, item);
        for (const item of discoverImports(language, text, relative)) pushBounded(imports, item);
        for (const item of discoverExports(language, text, relative)) pushBounded(exportCandidates, item);
        const interfaceHints = discoverOutputAndErrorHints(text, relative);
        for (const item of interfaceHints.returnShapeCandidates) pushBounded(returnShapeCandidates, item);
        if (interfaceHints.errorHandling) pushBounded(errorHandling, interfaceHints.errorHandling);
      }
      for (const item of parseDependencies(full, text)) pushBounded(dependencies, item);
      for (const match of text.matchAll(/\b(?:process\.env\.([A-Z][A-Z0-9_]*)|os\.getenv\s*\(\s*['"]([A-Z][A-Z0-9_]*)|getenv\s*\(\s*['"]([A-Z][A-Z0-9_]*))/g)) {
        const name = match[1] || match[2] || match[3]; if (name) environmentVariables.add(name);
      }
      for (const platform of ['pinterest', 'tiktok', 'instagram', 'youtube', 'facebook', 'twitter', 'reddit', 'telegram', 'spotify', 'soundcloud']) {
        if (new RegExp(`\\b${platform}\\b`, 'i').test(text)) platformIdentifiers.add(platform);
      }
      for (const match of text.matchAll(/\b(?:api\.telegram\.org|graph\.facebook\.com|api\.tiktok\.com|youtube\.com|pinterest\.[a-z.]+|instagram\.com|discord\.com\/api)\b/gi)) externalServices.add(match[0].toLowerCase());
      if (isCodeFile) for (const pattern of RISK_PATTERNS) {
        pattern.pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern.pattern)) pushBounded(risks, { id: pattern.id, severity: pattern.severity, file: relative, line: lineNumber(text, match.index) }, MAX_SECURITY_FINDINGS);
      }
      detectCredentialFindings(text, relative, risks);
    }
    inventory.push({ path: relative, bytes: stat.size, language, extension: ext || null });
  }

  const languageNames = [...languages.keys()].sort();
  const runtime = languageNames.length === 1 ? identifyRuntime(languageNames[0], inventory.map(item => item.path)) : 'multi-runtime-or-unknown';
  const scriptFiles = snippets.filter(item => ['javascript', 'typescript'].includes(identifyLanguage(item.file, item.text)));
  const packageSnippet = snippets.find(item => path.basename(item.file).toLowerCase() === 'package.json');
  let packageType = null;
  try { packageType = packageSnippet ? JSON.parse(packageSnippet.text).type : null; } catch {}
  moduleSystem = packageType === 'module' ? 'esm' : packageType === 'commonjs' ? 'commonjs' : detectModuleSystem(scriptFiles.map(item => item.file), scriptFiles.map(item => item.text));
  const uniqueDependencies = [...new Map(dependencies.map(item => [`${item.manager}:${item.name}`, item])).values()];
  const riskRank = { critical: 4, high: 3, medium: 2, low: 1 };
  risks.sort((a, b) => riskRank[b.severity] - riskRank[a.severity] || a.file.localeCompare(b.file) || a.line - b.line);
  analysisCoverage.skippedFiles += analysisCoverage.skipped.notText;

  return {
    analyzedAt: new Date().toISOString(), analysisMode: 'static-only', executedSource: false,
    analysisCoverage, fileCount: files.length, totalBytes: inventory.reduce((sum, item) => sum + item.bytes, 0),
    inventory, languages: languageNames.map(name => ({ name, files: languages.get(name) })),
    primaryLanguage: languageNames.length === 1 ? languageNames[0] : languageNames.length ? 'mixed' : 'unknown',
    runtime, moduleSystem,
    entryPointCandidates: inventory.filter(item => /^(?:index|main|app|server|bot|cli)\.(?:js|cjs|mjs|ts|py|go|php|java|rs|sh)$/i.test(path.basename(item.path))).map(item => item.path),
    functions: functions.slice(0, MAX_CANDIDATES), functionDetails: functionDetails.slice(0, MAX_CANDIDATES),
    imports: imports.slice(0, MAX_CANDIDATES), runtimeRequirements: discoverRuntimeRequirements(snippets),
    returnShapeCandidates: returnShapeCandidates.slice(0, 300), errorHandling: errorHandling.slice(0, 1000),
    exportCandidates: exportCandidates.slice(0, 300), dependencies: uniqueDependencies,
    environmentVariables: [...environmentVariables].sort(), externalServices: [...externalServices].sort(),
    platformIdentifiers: [...platformIdentifiers].sort(),
    security: {
      findings: risks, critical: risks.filter(item => item.severity === 'critical').length,
      high: risks.filter(item => item.severity === 'high').length, medium: risks.filter(item => item.severity === 'medium').length,
      low: risks.filter(item => item.severity === 'low').length, executionAllowed: false
    }
  };
}
