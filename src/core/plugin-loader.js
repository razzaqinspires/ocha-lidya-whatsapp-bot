import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import chokidar from 'chokidar';
import { logger } from './logger.js';

const registry = new Map();
const SOURCE_ROOT = path.resolve('src');
const PLUGIN_ROOT = path.join(SOURCE_ROOT, 'plugins');
const keyOf = (plugin, file) => plugin.name || path.relative(PLUGIN_ROOT, file).replaceAll(path.sep, '/');
const isWithin = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);

async function importPlugin(file) {
  const url = `${pathToFileURL(file).href}?hot=${Date.now()}-${Math.random()}`;
  const mod = await import(url);
  const plugin = mod.default || mod.plugin;
  if (!plugin || typeof plugin.execute !== 'function' || !plugin.name) {
    throw new Error(`Plugin invalid: ${file}; required exports: default/plugin with name and execute()`);
  }
  return plugin;
}

async function walkJavaScript(directory, files = []) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walkJavaScript(full, files);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

export async function loadPlugins() {
  const files = await walkJavaScript(PLUGIN_ROOT);
  for (const file of files) {
    try {
      const plugin = await importPlugin(file);
      registry.set(keyOf(plugin, file), { plugin, file });
    } catch (error) {
      logger.error({ err: error, file }, 'Plugin gagal dimuat');
    }
  }
  logger.info({ count: registry.size, root: PLUGIN_ROOT }, 'Plugin loaded');
}

export function listPlugins() {
  return [...registry.values()].map(entry => entry.plugin);
}

export function getPlugin(name) {
  const normalized = String(name || '').toLowerCase();
  return [...registry.values()].find(({ plugin }) =>
    plugin.name.toLowerCase() === normalized ||
    (plugin.aliases || []).some(alias => String(alias).toLowerCase() === normalized)
  )?.plugin;
}

async function updatePluginFile(event, file) {
  const existing = [...registry.entries()].find(([, value]) => value.file === file);
  const relative = path.relative(PLUGIN_ROOT, file).replaceAll(path.sep, '/');

  if (event === 'unlink') {
    if (existing) registry.delete(existing[0]);
    logger.info({ file: relative }, 'Plugin removed from registry');
    return;
  }

  try {
    const plugin = await importPlugin(file);
    const nextKey = keyOf(plugin, file);
    if (existing && existing[0] !== nextKey) registry.delete(existing[0]);
    registry.set(nextKey, { plugin, file });
    logger.info({ file: relative, name: plugin.name }, 'Plugin hot-reloaded');
  } catch (error) {
    logger.error({ err: error, file: relative }, 'Hot reload failed; previous plugin retained');
  }
}

/**
 * Observe every JavaScript source file below src/.
 * Plugin modules are replaced in-place. Core/lib/master modules trigger a
 * controlled process restart because ESM dependency graphs cannot be safely
 * invalidated in-place after import.
 */
export function watchSourceFiles({ onRestartRequired = () => {} } = {}) {
  const watcher = chokidar.watch(SOURCE_ROOT, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    ignored: candidate => {
      const relative = path.relative(SOURCE_ROOT, candidate);
      return relative.split(path.sep).some(part => part === 'node_modules' || part === '.git');
    }
  });

  const pendingRestarts = new Map();
  watcher.on('all', (event, absolutePath) => {
    if (!absolutePath.endsWith('.js')) return;
    const file = path.resolve(absolutePath);
    if (isWithin(PLUGIN_ROOT, file)) {
      void updatePluginFile(event, file);
      return;
    }

    if (!['add', 'change', 'unlink'].includes(event)) return;
    const relative = path.relative(SOURCE_ROOT, file).replaceAll(path.sep, '/');
    const existingTimer = pendingRestarts.get(file);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      pendingRestarts.delete(file);
      onRestartRequired({ file: relative, event });
    }, 600);
    pendingRestarts.set(file, timer);
  });

  watcher.on('error', error => logger.error({ err: error }, 'Source watcher error'));
  watcher.on('ready', () => logger.info({ root: SOURCE_ROOT }, 'Hot reload seluruh source JavaScript aktif'));
  return watcher;
}

// Backward-compatible name; now watches the whole src tree, not only plugins.
export function watchPlugins(options) {
  return watchSourceFiles(options);
}
