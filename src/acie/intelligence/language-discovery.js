import path from 'node:path';

const EXTENSIONS = Object.freeze({
  '.js': 'javascript', '.cjs': 'javascript', '.mjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.py': 'python', '.go': 'go', '.php': 'php',
  '.java': 'java', '.rs': 'rust', '.sh': 'bash', '.bash': 'bash'
});

export function identifyLanguage(filePath, content = '') {
  const base = path.basename(filePath).toLowerCase();
  const ext = path.extname(base);
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'make';
  if (base === 'go.mod') return 'go-module';
  if (base === 'cargo.toml') return 'rust-manifest';
  if (base === 'composer.json') return 'php-manifest';
  if (base === 'requirements.txt' || base === 'pyproject.toml' || base === 'setup.py') return 'python-manifest';
  if (base === 'package.json') return 'node-manifest';
  if (base === 'pom.xml' || base === 'build.gradle' || base === 'build.gradle.kts') return 'java-manifest';
  if (base === 'gemfile') return 'ruby-manifest';
  if (EXTENSIONS[ext]) return EXTENSIONS[ext];
  const sample = String(content).slice(0, 4000);
  if (/^#!.*\bpython\b/m.test(sample)) return 'python';
  if (/^#!.*\b(?:ba)?sh\b/m.test(sample)) return 'bash';
  if (/^package\s+\w+/m.test(sample) && /\bfunc\s+\w+/m.test(sample)) return 'go';
  if (/^<\?php/m.test(sample)) return 'php';
  return 'unknown';
}

export function identifyRuntime(language, files = []) {
  const names = new Set(files.map(file => path.basename(file).toLowerCase()));
  const runtimes = {
    javascript: 'node', typescript: 'node+typescript-transpiler', python: 'python3', go: 'go-toolchain',
    php: 'php-cli', java: 'jvm', rust: 'rust-toolchain', bash: 'bash'
  };
  if (language === 'javascript' && names.has('package.json')) return 'node';
  return runtimes[language] || 'unknown';
}

export function detectModuleSystem(files, snippets = []) {
  const names = new Set(files.map(file => path.basename(file).toLowerCase()));
  const text = snippets.join('\n');
  if (names.has('package.json')) {
    try {
      const manifest = JSON.parse(snippets.find((_, index) => path.basename(files[index] || '') === 'package.json') || '{}');
      if (manifest.type === 'module') return 'esm';
    } catch {}
  }
  const esm = /\b(?:import\s+.+\s+from|export\s+(?:default|\{|const|function|class))\b/.test(text);
  const cjs = /\b(?:require\s*\(|module\.exports|exports\.)/.test(text);
  if (esm && cjs) return 'mixed';
  if (esm) return 'esm';
  if (cjs) return 'commonjs';
  return 'not-applicable-or-unknown';
}
