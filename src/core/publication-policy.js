import path from 'node:path';
import { createHash } from 'node:crypto';

// Fingerprints only: these identify owner-designated private source bytes without
// embedding or reconstructing any private implementation in the public repository.
export const PRIVATE_SOURCE_SHA256 = Object.freeze([
  'f653ff54a4936fb3615b0df29a6001ed651270d737c15300aebb860888224c40',
  '6874b5655c3f194dc7ceea1d6512ae2b5a32bf14af5481ce63647f8ffbe733a2',
  'dea18b22b6cfe635e222750b4742f4c43f1e483e36a018045d4142f1ede98ef8',
  'c47883b8cf6d6c3de18085d4e43a82c543768edd0df6782f52a97770fdd068c6',
]);

export function isPrivateSourceDigest(digest) {
  return PRIVATE_SOURCE_SHA256.includes(String(digest || '').toLowerCase());
}

export function hasPrivateSourceFingerprint(bytes) {
  const digest = createHash('sha256').update(bytes).digest('hex');
  return isPrivateSourceDigest(digest);
}

const PRIVATE_EXACT_PATHS = new Set([
  'src/plugins/owner/message-lab.js',
  'private-runtime/package.json',
  'private-runtime/index.js',
  'PRIVATE_SOURCE_HANDLING.md',
]);

const PRIVATE_SEGMENTS = new Set([
  '.private',
  '.release',
  'private',
  'private-core',
  'private-vault',
  'private-runtime-package',
  'private-packages',
  'secret-vault',
  'credentials',
  'secrets',
  'incoming',
  'quarantine',
  'runtime-workspaces',
  'contributions',
  'adapters',
  'generated-commands',
]);

const PRIVATE_BASENAMES = new Set([
  'additional_instructions.md',
  'additional_instructions.txt',
  'ai_context.private.md',
  'ai_workflow.private.md',
  'project_intelligence_protocol.md',
  'private_core_key.txt',
  'ocha-lidya-private-core-key.txt',
  'secrets.json',
  'credentials.json',
]);

const SECRET_PATTERNS = [
  { id: 'github-pat', regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gi },
  { id: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { id: 'openai-key', regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: 'google-api-key', regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { id: 'aws-access-key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'private-key-block', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  {
    id: 'generic-assignment',
    regex: /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\b\s*[:=]\s*['"]([^'"\s]{12,})['"]/gi,
    capture: 1,
  },
];

export function normalizePublicationPath(value) {
  return String(value || '')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

export function isPrivatePublicationPath(value) {
  const normalized = normalizePublicationPath(value);
  if (!normalized) return true;
  const parts = normalized.split('/').filter(Boolean);
  if (PRIVATE_EXACT_PATHS.has(normalized)) return true;
  if (normalized === 'private-runtime' || normalized.startsWith('private-runtime/')) return true;
  if (parts.some(part => PRIVATE_SEGMENTS.has(part.toLowerCase()))) return true;
  if (parts.some(part => PRIVATE_BASENAMES.has(part.toLowerCase()))) return true;
  if (/(^|\/)(?:\.env(?:\..*)?|id_rsa|id_ed25519|known_hosts|authorized_keys)$/i.test(normalized)) {
    return !/(^|\/)(?:\.env\.example)$/i.test(normalized);
  }
  if (/\.(?:pem|p12|pfx|key|keystore|jks|sqlite|db)$/i.test(normalized)) return true;
  return false;
}

export function scanSecrets(content) {
  const source = String(content ?? '');
  const findings = [];
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(source))) {
      const before = source.slice(0, match.index);
      const line = before.split('\n').length;
      const value = pattern.capture ? match[pattern.capture] : match[0];
      if (/^(?:YOUR_|REPLACE_|CHANGE_ME|EXAMPLE|<|\$\{|\*{3,})/i.test(value)) continue;
      findings.push({ rule: pattern.id, line });
      if (!pattern.regex.global) break;
    }
  }
  return findings;
}

export function auditPublicationPaths(paths) {
  const privatePaths = [];
  const eligiblePaths = [];
  for (const value of paths || []) {
    const normalized = normalizePublicationPath(value);
    (isPrivatePublicationPath(normalized) ? privatePaths : eligiblePaths).push(normalized);
  }
  return { privatePaths, eligiblePaths };
}

export function privatePublicationPaths() {
  return [...PRIVATE_EXACT_PATHS].sort();
}

export function toSafeRelativePath(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  return normalizePublicationPath(relative);
}
