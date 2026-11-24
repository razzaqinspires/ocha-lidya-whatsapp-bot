import path from 'node:path';

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

export function discoverFunctionSignatures(language, text, file) {
  const patternMap = {
    javascript: [/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g, /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g],
    typescript: [/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g, /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g],
    python: [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm],
    go: [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)/gm],
    php: [/\bfunction\s+&?\s*([A-Za-z_]\w*)\s*\(([^)]*)\)/g],
    java: [/(?:public|protected|private|static|final|synchronized|abstract|native|\s)+[\w<>?,.\[\]]+\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:throws\s+[\w, ]+)?\s*\{/g],
    rust: [/\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g],
    bash: [/^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\s*\)\s*\{/gm]
  };
  const patterns = patternMap[language] || [];
  const results = [];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) {
    const rawParams = String(match[2] || '').trim();
    const parameters = rawParams ? rawParams.split(',').map(part => {
      let value = part.trim().replace(/^\.\.\./, '').replace(/^\*{1,2}/, '').split('=')[0].trim();
      if (!value) return null;
      if (language === 'go') value = value.split(/\s+/)[0];
      if (language === 'java') value = value.split(/\s+/).at(-1).replace(/\.\.\.$/, '');
      if (language === 'rust') value = value.split(':')[0].trim();
      if (['javascript', 'typescript', 'python'].includes(language)) value = value.split(/\s*:\s*/)[0];
      return value;
    }).filter(Boolean) : [];
    results.push({ file, language, name: match[1], parameters, status: 'static-candidate', line: lineAt(text, match.index) });
  }
  return results;
}

export function discoverImports(language, text, file) {
  const patternMap = {
    javascript: [/\bimport\s+(?:.+?\s+from\s+)?['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g],
    typescript: [/\bimport\s+(?:.+?\s+from\s+)?['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g],
    python: [/^\s*import\s+([A-Za-z0-9_.]+)/gm, /^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+/gm],
    go: [/\bimport\s+(?:\w+\s+)?"([^"]+)"/g],
    php: [/\b(?:require|require_once|include|include_once)\s*\(?\s*['"]([^'"]+)['"]/g],
    java: [/^\s*import\s+(?:static\s+)?([A-Za-z0-9_.*]+)\s*;/gm],
    rust: [/^\s*use\s+([A-Za-z0-9_:]+)[;:{]/gm],
    bash: [/^\s*(?:source|\.)\s+['"]?([^\s'"]+)/gm]
  };
  const imports = new Set();
  for (const pattern of patternMap[language] || []) for (const match of text.matchAll(pattern)) imports.add(match[1]);
  return [...imports].map(module => ({ file, language, module, kind: module.startsWith('.') || module.startsWith('/') ? 'relative-candidate' : 'external-or-standard-library-candidate' }));
}

export function discoverOutputAndErrorHints(text, file) {
  const patterns = [
    ['object', /\breturn\s*\{/g], ['array', /\breturn\s*\[/g],
    ['buffer-or-media', /\breturn\s+(?:Buffer\.|new\s+Blob|new\s+File)/g],
    ['json-response', /\breturn\s+(?:res|response)\.json\s*\(/g],
    ['string-or-primitive', /\breturn\s+(?:['"`]|[0-9]|true\b|false\b)/g]
  ];
  const output = [];
  for (const [shape, pattern] of patterns) for (const match of text.matchAll(pattern)) output.push({ file, shape, line: lineAt(text, match.index), status: 'heuristic-candidate' });
  const errorHandling = {
    file,
    tryCount: (text.match(/\btry\b/g) || []).length,
    catchCount: (text.match(/\bcatch\b|\bexcept\b/g) || []).length,
    throwCount: (text.match(/\bthrow\b|\braise\b/g) || []).length
  };
  return { returnShapeCandidates: output.slice(0, 150), errorHandling: errorHandling.tryCount || errorHandling.catchCount || errorHandling.throwCount ? errorHandling : null };
}

export function discoverRuntimeRequirements(snippets) {
  const output = [];
  for (const item of snippets) {
    const base = path.basename(item.file).toLowerCase();
    try {
      if (base === 'package.json') {
        const data = JSON.parse(item.text); if (data.engines?.node) output.push({ runtime: 'node', requirement: String(data.engines.node), source: item.file });
      } else if (base === 'go.mod') {
        const match = item.text.match(/^go\s+([\d.]+)/m); if (match) output.push({ runtime: 'go', requirement: `>=${match[1]}`, source: item.file });
      } else if (base === 'composer.json') {
        const data = JSON.parse(item.text); if (data.require?.php) output.push({ runtime: 'php', requirement: String(data.require.php), source: item.file });
      } else if (base === 'pyproject.toml') {
        const match = item.text.match(/requires-python\s*=\s*["']([^"']+)["']/); if (match) output.push({ runtime: 'python', requirement: match[1], source: item.file });
      } else if (base === 'cargo.toml') {
        const match = item.text.match(/edition\s*=\s*["']([^"']+)["']/); if (match) output.push({ runtime: 'rust-edition', requirement: match[1], source: item.file });
      }
    } catch {}
  }
  return output;
}
