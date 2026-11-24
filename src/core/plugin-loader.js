import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import { pathToFileURL } from 'node:url';
import { watchFiles } from './file-watcher.js';
import { logger } from './logger.js';
import { isRuntimeWatchIgnored } from './watch-policy.js';
import { canCommitSourceBatch, classifySourceBatch, DEPENDENCY_MANIFESTS, validateJsonFile } from './source-batch.js';
import { loadGeneratedCommandPlugins } from '../acie/command-engine/runtime-commands.js';

const registry = new Map();
const PROJECT_ROOT = path.resolve('.');
const SOURCE_ROOT = path.join(PROJECT_ROOT, 'src');
const PLUGIN_ROOT = path.join(SOURCE_ROOT, 'plugins');
const SCRIPT_ROOT = path.join(PROJECT_ROOT, 'scripts');
const QUIET_WINDOW_MS = 4200;
const MAX_BATCH_WINDOW_MS = 5 * 60_000;
const keyOf = (plugin, file) => plugin.name || path.relative(PLUGIN_ROOT, file).replaceAll(path.sep, '/');
const isWithin = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function importPlugin(file) {
  const url = `${pathToFileURL(file).href}?hot=${Date.now()}-${process.hrtime.bigint()}`;
  const mod = await import(url);
  const plugin = mod.default || mod.plugin;
  if (!plugin || typeof plugin.execute !== 'function' || !plugin.name) {
    throw new Error(`Plugin invalid: ${file}; required exports: default/plugin with name and execute()`);
  }
  return plugin;
}

async function walkJavaScript(directory, files = []) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return files; throw error; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walkJavaScript(full, files);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
  }
  return files.sort();
}

async function mergeGeneratedCommands(target) {
  const existingPlugins = [...target.values()].map(entry => entry.plugin);
  const generated = await loadGeneratedCommandPlugins({ root: PROJECT_ROOT, existingPlugins });
  for (const plugin of generated.plugins) {
    const key = keyOf(plugin, path.join(PLUGIN_ROOT, '__generated__', `${plugin.name}.js`));
    if (target.has(key)) continue;
    target.set(key, { plugin, file: null, generated: true });
  }
  if (generated.skipped.length) logger.warn({ skipped: generated.skipped.slice(0, 30) }, 'Some ACIE commands were not loaded because provider gate or runtime collision checks failed');
  return generated;
}

export async function refreshGeneratedCommandPlugins() {
  const next = new Map([...registry.entries()].filter(([, entry]) => !entry.generated));
  const result = await mergeGeneratedCommands(next);
  registry.clear();
  for (const [key, entry] of next) registry.set(key, entry);
  logger.info({ loaded: result.loaded, skipped: result.skipped.length }, 'ACIE generated command registry synchronized');
  return { loaded: result.loaded, skipped: result.skipped.length, reasons: result.skipped };
}

export async function loadPlugins() {
  const files = await walkJavaScript(PLUGIN_ROOT);
  const previousByFile = new Map([...registry.values()].map(entry => [entry.file, entry]));
  const next = new Map();
  const failures = [];

  for (const file of files) {
    try {
      const plugin = await importPlugin(file);
      const key = keyOf(plugin, file);
      if (next.has(key)) {
        throw new Error(`Duplicate plugin command name: ${plugin.name}`);
      }
      next.set(key, { plugin, file });
    } catch (error) {
      failures.push({ file, message: error.message });
      // A failed replacement must not make a previously working command disappear.
      const previous = previousByFile.get(file);
      if (previous) next.set(keyOf(previous.plugin, file), previous);
      logger.error({ err: error, file }, 'Plugin gagal dimuat; versi valid sebelumnya dipertahankan bila tersedia');
    }
  }

  try { await mergeGeneratedCommands(next); }
  catch (error) { logger.error({ code: error.code || error.name }, 'ACIE generated command registry could not be loaded; static plugins remain available'); }

  // Commit one complete registry snapshot. Deleted plugin files are removed,
  // added plugins and eligible ACIE commands become visible in the same registry.
  registry.clear();
  for (const [key, entry] of next) registry.set(key, entry);
  const plugins = listPlugins();
  logger.info({ count: plugins.length, failed: failures.length, root: PLUGIN_ROOT }, 'Plugin registry atomically refreshed');
  return plugins;
}

export function listPlugins() {
  return [...registry.values()].map(entry => entry.plugin);
}

export function listPluginEntries() {
  return [...registry.values()].map(({ plugin, file }) => ({ plugin, file: file || `generated:acie/${plugin.name}` }));
}

export function getPlugin(name) {
  const normalized = String(name || '').toLowerCase();
  return [...registry.values()].find(({ plugin }) =>
    plugin.name.toLowerCase() === normalized ||
    (plugin.aliases || []).some(alias => String(alias).toLowerCase() === normalized)
  )?.plugin;
}

async function validateSourceBatch(changes) {
  const files = changes
    .filter(change => change.event !== 'unlink' && ['.js', '.sh', '.json'].includes(path.extname(change.file).toLowerCase()))
    .map(change => change.file);
  for (const file of files) {
    try { await fs.access(file); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const extension = path.extname(file).toLowerCase();
    if (extension === '.json') {
      const result = await validateJsonFile(file);
      if (!result.valid) return { valid: false, file, detail: result.detail };
      continue;
    }
    const command = extension === '.sh' ? 'bash' : process.execPath;
    const args = extension === '.sh' ? ['-n', file] : ['--check', file];
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10_000 });
    if (result.error || result.status !== 0) {
      const detail = String(result.stderr || result.stdout || result.error?.message || 'unknown syntax error').trim().slice(-1600);
      return { valid: false, file, detail };
    }
  }
  return { valid: true };
}

async function reloadPluginTree(changes) {
  const files = await walkJavaScript(PLUGIN_ROOT);
  const currentByFile = new Map([...registry.values()].map(entry => [entry.file, entry]));
  const next = new Map();
  const failures = [];

  for (const file of files) {
    try {
      const plugin = await importPlugin(file);
      const key = keyOf(plugin, file);
      if (next.has(key)) throw new Error(`Duplicate plugin command name: ${plugin.name}`);
      next.set(key, { plugin, file });
    } catch (error) {
      failures.push({ file: path.relative(PLUGIN_ROOT, file), message: error.message });
      const previous = currentByFile.get(file);
      if (previous) next.set(keyOf(previous.plugin, file), previous);
    }
  }

  try { await mergeGeneratedCommands(next); }
  catch (error) { logger.error({ code: error.code || error.name }, 'ACIE generated command reload failed; static source snapshot is retained'); }

  // Replace the registry in one synchronous turn, never expose a half-applied folder copy.
  registry.clear();
  for (const [key, entry] of next) registry.set(key, entry);
  const changed = changes.map(change => path.relative(PLUGIN_ROOT, change.file).replaceAll(path.sep, '/'));
  logger.info({ count: registry.size, changed, failed: failures.length }, 'Plugin batch hot-reload committed atomically');
  for (const failure of failures) logger.error(failure, 'Plugin update rejected; previous valid plugin retained when available');
}

function fileSnapshot(changes) {
  return changes.map(change => {
    try {
      const stat = requireStatSync(change.file);
      return `${change.file}:${stat.size}:${stat.mtimeMs}:${stat.ino}`;
    } catch { return `${change.file}:missing`; }
  }).sort().join('|');
}

function requireStatSync(file) {
  // statSync is used only for a bounded set of recently changed files.
  return fsSync.statSync(file);
}

export function watchSourceFiles({ onRestartRequired = () => {}, onBatchStart = () => {}, onBatchSettled = () => {} } = {}) {
  const watcher = watchFiles(PROJECT_ROOT, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 650, pollInterval: 120 },
    ignored: candidate => {
      const relative = path.relative(PROJECT_ROOT, candidate).replaceAll(path.sep, '/');
      if (isRuntimeWatchIgnored(relative)) return true;
      if (!relative || relative === '.' || relative === 'src' || relative.startsWith('src/') || relative === 'scripts' || relative.startsWith('scripts/')) return false;
      return !DEPENDENCY_MANIFESTS.has(relative);
    },
    ignorePermissionErrors: true
  });

  const pending = new Map();
  let settleTimer = null;
  let firstChangeAt = 0;
  let stopped = false;
  let flushing = false;
  let watcherFailureHandled = false;
  let batchRevision = 0;

  const scheduleFlush = () => {
    clearTimeout(settleTimer);
    const wait = QUIET_WINDOW_MS;
    settleTimer = setTimeout(() => { void flushChanges(); }, wait);
    settleTimer.unref?.();
  };

  const flushChanges = async () => {
    if (stopped || flushing || !pending.size) return;
    flushing = true;
    clearTimeout(settleTimer);
    const revision = batchRevision;
    const changes = [...pending.values()];
    let accepted = false;
    try {
      const firstSnapshot = fileSnapshot(changes);
      await sleep(700);
      const secondSnapshot = fileSnapshot(changes);
      // A new filesystem event means the copy/replace transaction is still
      // changing. Never clear it or restart from a partial folder snapshot.
      if (!canCommitSourceBatch({
        capturedRevision: revision,
        currentRevision: batchRevision,
        firstSnapshot,
        secondSnapshot,
        elapsedMs: Date.now() - firstChangeAt,
        maxWindowMs: MAX_BATCH_WINDOW_MS
      })) return;

      const classification = classifySourceBatch(changes);
      if (!classification.files.length) {
        accepted = true;
        return;
      }
      const validation = await validateSourceBatch(changes);
      if (revision !== batchRevision) return;
      if (!validation.valid) {
        for (const change of changes) {
          if (pending.get(change.file) === change) pending.delete(change.file);
        }
        firstChangeAt = pending.size ? firstChangeAt : 0;
        logger.error({ file: validation.file, detail: validation.detail, files: classification.files }, 'Source update batch rejected; running runtime retained because updated JavaScript is invalid');
        return;
      }

      // Consume only the exact file events that were validated. Events arriving
      // after this point remain queued as the next independent batch.
      for (const change of changes) {
        if (pending.get(change.file) === change) pending.delete(change.file);
      }
      firstChangeAt = pending.size ? firstChangeAt : 0;
      accepted = true;

      if (classification.requiresRestart) {
        logger.warn({ files: classification.files, requiresInstall: classification.requiresInstall }, 'Core source update batch settled; requesting one controlled restart');
        await onRestartRequired({ ...classification, events: changes.map(({ file, event }) => ({ file, event })) });
      } else {
        await reloadPluginTree(changes);
      }
    } catch (error) {
      logger.error({ err: error }, 'Source update batch failed; current runtime remains active');
    } finally {
      flushing = false;
      if (pending.size) scheduleFlush();
      else {
        try { await onBatchSettled({ files: changes.map(change => change.file), accepted }); }
        catch (error) { logger.warn({ message: error.message }, 'Source batch settle callback failed'); }
      }
    }
  };

  watcher.on('all', (event, absolutePath) => {
    if (!['add', 'change', 'unlink'].includes(event)) return;
    const file = path.resolve(absolutePath);
    const relative = path.relative(PROJECT_ROOT, file).replaceAll(path.sep, '/');
    const isSource = isWithin(SOURCE_ROOT, file);
    const isScript = isWithin(SCRIPT_ROOT, file);
    const isManifest = DEPENDENCY_MANIFESTS.has(relative);
    if (!isSource && !isScript && !isManifest) return;
    if (!firstChangeAt) {
      firstChangeAt = Date.now();
      try { onBatchStart({ file, event }); }
      catch (error) { logger.warn({ message: error.message }, 'Source batch start callback failed'); }
    }
    pending.set(file, { file, event, at: Date.now() });
    batchRevision += 1;
    scheduleFlush();
  });

  watcher.on('error', error => {
    if (watcherFailureHandled) return;
    watcherFailureHandled = true;
    clearTimeout(settleTimer);
    if (error?.code === 'ENOSPC') {
      try { onBatchSettled({ files: [...pending.keys()], accepted: false }); } catch {}
      pending.clear();
      logger.error({ code: error.code, syscall: error.syscall, path: error.path }, 'Source watcher kehabisan kuota; hot reload dihentikan agar runtime tetap stabil');
      void watcher.close().catch(() => {});
      return;
    }
    logger.error({ code: error?.code, message: error?.message }, 'Source watcher gagal');
  });
  watcher.on('ready', () => logger.info({ root: SOURCE_ROOT, quietWindowMs: QUIET_WINDOW_MS }, 'Transactional source watcher active'));

  return {
    watcher,
    async close() {
      stopped = true;
      clearTimeout(settleTimer);
      pending.clear();
      await watcher.close();
    }
  };
}

// Backward-compatible name.
export function watchPlugins(options) {
  return watchSourceFiles(options);
}
