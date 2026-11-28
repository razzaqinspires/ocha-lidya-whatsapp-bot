import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const AC_REPOSITORY = 'razzaqinspires/artificial-consciousness-component';
export const AC_REMOTE = `https://github.com/${AC_REPOSITORY}.git`;
export const AC_BRANCH = 'main';
export const AC_ROOT = path.join(PROJECT_ROOT, '.private', 'artificial-consciousness-component');

export function normalizeAcRemote(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
}

/**
 * A Git query inside the AC folder can resolve to the parent Ocha checkout
 * before the nested .git repository exists. That means "not initialized yet",
 * not a conflicting nested repository. Other roots fail closed.
 */
export function isExpectedNestedAcGitRoot(foundRoot, { expectedRoot = AC_ROOT, parentRoot = PROJECT_ROOT } = {}) {
  const found = path.resolve(String(foundRoot || ''));
  if (found === path.resolve(expectedRoot)) return true;
  if (found === path.resolve(parentRoot)) return false;
  throw new Error(`Nested Git root tidak cocok: ${found}`);
}

export function isAcRuntimeIgnored(relativePath) {
  const normalized = String(relativePath || '')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '');
  if (!normalized || normalized === '.') return false;
  const parts = normalized
    .split('/')
    .filter(Boolean)
    .map(part => part.toLowerCase());
  const ignoredSegments = new Set([
    '.git',
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache',
    '.ruff_cache',
    '.coverage',
    'htmlcov',
    '.venv',
    'venv',
    'env',
    'node_modules',
    'dist',
    'build',
    'nadi_state',
    'data',
    'logs',
    'backups',
    'tmp',
    'temp',
    '.cache',
    '.ssh',
    '.aws',
    '.gnupg',
    'secrets',
    'credentials',
    'certificates',
    'private-keys',
  ]);
  if (parts.some(part => ignoredSegments.has(part) || part.endsWith('.egg-info'))) return true;
  const basename = parts.at(-1) || '';
  if (/^\.env(?:\..*)?$/i.test(basename) && basename !== '.env.example') return true;
  if (
    [
      'ac_config.json',
      'config.local.json',
      'credentials.json',
      'service-account.json',
      'token.json',
      'secrets.json',
    ].includes(basename)
  )
    return true;
  if (/^(?:id_rsa|id_ed25519|known_hosts|authorized_keys|service-account(?:[-_].*)?\.json)$/i.test(basename))
    return true;
  if (/^(?:\.scope-salt|\.nadi-runtime\.lock|kernel_state\.json|eternal_chain\.jsonl)$/i.test(basename)) return true;
  if (/\.(?:sqlite3?|db|log|py[co]|swp|swo|tmp|bak|zip|pem|key|p12|pfx|jks|keystore|crt)$/i.test(basename)) return true;
  return false;
}
