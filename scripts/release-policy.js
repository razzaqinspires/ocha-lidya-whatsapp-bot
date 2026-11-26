const EXCLUDED_COMPONENTS = new Set(['.git', 'node_modules', 'sessions', 'coverage', 'dist', 'build', 'logs']);

const PRIVATE_ROOTS = new Set([
  '.private',
  '.private/ocha-private-runtime',
  '.private/contributions',
  '.private/contributions/rizkyrohan-text-canvas-v1',
  '.private/contributions/rizkyrohan-text-canvas-v1/original',
  '.private/project',
  '.private/policies',
]);

/**
 * Decide whether an Ocha source path belongs in the local operator ZIP.
 * Public documentation directories such as docs/releases are included; the
 * hidden local .release workspace is never walked and is added only through
 * the explicit generated manifest entry.
 */
export function shouldIncludeOchaFile(relative) {
  const normalized = String(relative || '').replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (parts.some(part => EXCLUDED_COMPONENTS.has(part))) return false;
  if (parts[0] === '.release' || parts[0] === 'release' || parts[0] === 'releases' || parts[0] === 'release-staging')
    return false;

  if (parts[0] === '.private') {
    return (
      PRIVATE_ROOTS.has(normalized) ||
      normalized.startsWith('.private/ocha-private-runtime/') ||
      normalized.startsWith('.private/contributions/rizkyrohan-text-canvas-v1/') ||
      normalized === '.private/project/AI_CONTEXT.md' ||
      normalized === '.private/project/AI_WORKFLOW.md' ||
      normalized === '.private/policies/PRIVATE_SOURCE_HANDLING.md'
    );
  }

  if (['contributions', 'adapters', 'generated-commands', 'runtime-workspaces', 'incoming'].includes(parts[0]))
    return false;
  if (parts[0] === 'data' && normalized !== 'data/.gitkeep') return false;
  if (/^\.env(?:\..*)?$/i.test(parts.at(-1)) && parts.at(-1) !== '.env.example') return false;
  if (/\.(?:log|tmp|zip)$/i.test(normalized)) return false;
  return true;
}
