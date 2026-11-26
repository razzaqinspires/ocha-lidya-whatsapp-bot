import path from 'node:path';

const PRIVATE_WATCH_PATHS = new Set(['src/plugins/owner/message-lab.js']);

const IGNORED_SEGMENTS = new Set([
  '.git',
  '.private',
  '.release',
  'node_modules',
  'sessions',
  'data',
  'logs',
  '.cache',
  '.next',
  '.turbo',
  '.vercel',
  '.parcel-cache',
  'coverage',
  'dist',
  'build',
  'tmp',
  'temp',
  'backups',
  'artifacts',
  'private-runtime-package',
  'private-packages',
]);

/** True for runtime/private directories that must never be recursively watched. */
export function isRuntimeWatchIgnored(relativePath) {
  const normalized = String(relativePath || '')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '');
  if (!normalized || normalized === '.') return false;
  if (normalized === 'private-runtime' || normalized.startsWith('private-runtime/')) return true;
  if (PRIVATE_WATCH_PATHS.has(normalized)) return true;
  const parts = normalized.split('/').filter(Boolean);
  return parts.some((part, index) => {
    if (IGNORED_SEGMENTS.has(part)) return true;
    if (index === 0 && /^sessions(?:\.|-|_)/i.test(part)) return true;
    if (/^\.env\.(?!example$)/i.test(part)) return true;
    if (/\.(?:log|tmp|swp|bak)$/i.test(part)) return true;
    return false;
  });
}

export function resolveRelativeWatchPath(root, candidate) {
  return path.relative(root, candidate);
}
