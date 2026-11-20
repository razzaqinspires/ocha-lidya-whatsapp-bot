import path from 'node:path';

const IGNORED_SEGMENTS = new Set([
  '.git', 'node_modules', 'sessions', 'data', 'logs', '.cache', '.next', '.turbo',
  '.vercel', '.parcel-cache', 'coverage', 'dist', 'build', 'tmp', 'temp', 'backups',
  'artifacts'
]);

/** True for runtime/private directories that must never be recursively watched. */
export function isRuntimeWatchIgnored(relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized === '.') return false;
  const parts = normalized.split('/').filter(Boolean);
  return parts.some((part, index) => {
    if (IGNORED_SEGMENTS.has(part)) return true;
    // Quarantined auth-session backups sit beside the active sessions folder.
    if (index === 0 && /^sessions(?:\.|-|_)/i.test(part)) return true;
    if (/^\.env\.(?!example$)/i.test(part)) return true;
    if (/\.(?:log|tmp|swp|bak)$/i.test(part)) return true;
    return false;
  });
}

export function resolveRelativeWatchPath(root, candidate) {
  return path.relative(root, candidate);
}
