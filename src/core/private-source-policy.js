const PRIVATE_PLUGIN_SOURCE_PATHS = Object.freeze(['src/plugins/owner/message-lab.js']);

function normalizeSourcePath(value) {
  return String(value || '')
    .replaceAll('\\', '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/{2,}/g, '/');
}

/** Return true when a source path is owned exclusively by the private runtime package. */
export function isPrivatePluginSourcePath(relativePath) {
  return PRIVATE_PLUGIN_SOURCE_PATHS.includes(normalizeSourcePath(relativePath));
}

export function listPrivatePluginSourcePaths() {
  return [...PRIVATE_PLUGIN_SOURCE_PATHS];
}
