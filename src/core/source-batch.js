import path from 'node:path';
import fs from 'node:fs/promises';

const PROJECT_ROOT = path.resolve('.');
const SOURCE_ROOT = path.join(PROJECT_ROOT, 'src');
const PLUGIN_ROOT = path.join(SOURCE_ROOT, 'plugins');
const SCRIPT_ROOT = path.join(PROJECT_ROOT, 'scripts');
export const DEPENDENCY_MANIFESTS = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json']);

const isWithin = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);

export function classifySourceBatch(changes = []) {
  const files = changes.map(change => typeof change === 'string' ? change : change.file).filter(Boolean);
  const requiresInstall = files.some(file => DEPENDENCY_MANIFESTS.has(path.relative(PROJECT_ROOT, path.resolve(file)).replaceAll(path.sep, '/')));
  const coreFiles = files.filter(file => {
    const absolute = path.resolve(file);
    if (DEPENDENCY_MANIFESTS.has(path.relative(PROJECT_ROOT, absolute).replaceAll(path.sep, '/'))) return true;
    if (isWithin(SCRIPT_ROOT, absolute)) return true;
    if (!isWithin(SOURCE_ROOT, absolute)) return false;
    // Only JavaScript plugin modules are safe for a live registry swap.
    // Plugin assets/manifests can be consumed by imported modules and thus
    // require a process restart just like other core source files.
    return !(isWithin(PLUGIN_ROOT, absolute) && path.extname(absolute).toLowerCase() === '.js');
  });
  return { files: [...new Set(files)], requiresInstall, requiresRestart: coreFiles.length > 0, coreFiles };
}

export function canCommitSourceBatch({ capturedRevision, currentRevision, firstSnapshot, secondSnapshot, elapsedMs = 0, maxWindowMs = 0 }) {
  if (Number(capturedRevision) !== Number(currentRevision)) return false;
  return firstSnapshot === secondSnapshot || Number(elapsedMs) >= Number(maxWindowMs);
}


export async function validateJsonFile(file) {
  try {
    JSON.parse(await fs.readFile(file, 'utf8'));
    return { valid: true };
  } catch (error) {
    return { valid: false, detail: `JSON parse error: ${String(error.message || error).slice(0, 1200)}` };
  }
}
