import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

let chokidarWatch = null;
let chokidarLoadError = null;

try {
  const imported = await import('chokidar');
  const chokidar = imported.default || imported;
  chokidarWatch = chokidar.watch.bind(chokidar);
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND' && error?.code !== 'MODULE_NOT_FOUND') throw error;
  chokidarLoadError = error;
}

let fallbackNoticeShown = false;

function isIgnored(ignored, candidate, stats) {
  if (typeof ignored !== 'function') return false;
  try { return Boolean(ignored(candidate, stats)); }
  catch { return true; }
}

class NativeFileWatcher extends EventEmitter {
  constructor(root, options = {}) {
    super();
    this.root = path.resolve(root);
    this.options = options;
    this.watchers = new Map();
    this.knownFiles = new Set();
    this.pending = new Map();
    this.closed = false;
    this.ready = false;
    this.persistent = options.persistent !== false;
    this.stabilityThreshold = Math.max(50, Number(options.awaitWriteFinish?.stabilityThreshold) || 120);
    this.debounceTimers = new Map();
    void this.initialize();
  }

  ignored(candidate, stats) {
    return isIgnored(this.options.ignored, candidate, stats);
  }

  async initialize() {
    try {
      await this.attachDirectory(this.root, true);
      if (this.closed) return;
      this.ready = true;
      this.emit('ready');
    } catch (error) {
      this.emit('error', error);
    }
  }

  async attachDirectory(directory, isRoot = false, emitInitialFiles = false) {
    if (this.closed || this.watchers.has(directory)) return;
    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT' && !isRoot) return;
      throw error;
    }

    if (!isRoot && this.ignored(directory)) return;

    const watcher = fs.watch(directory, { persistent: this.persistent }, (eventType, filename) => {
      if (!filename) {
        // A null filename cannot be mapped safely to one source file. A small
        // reconciliation pass handles it without generating broad false events.
        void this.reconcileDirectory(directory);
        return;
      }
      const absolute = path.resolve(directory, String(filename));
      this.queuePath(absolute, eventType);
    });
    watcher.on('error', error => this.emit('error', error));
    this.watchers.set(directory, watcher);

    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (this.ignored(absolute)) continue;
      if (entry.isDirectory()) {
        await this.attachDirectory(absolute, false, emitInitialFiles);
      } else if (entry.isFile()) {
        const existed = this.knownFiles.has(absolute);
        this.knownFiles.add(absolute);
        if (emitInitialFiles && !existed) this.emit('all', 'add', absolute);
      }
    }
  }

  queuePath(absolute, eventType) {
    if (this.closed || this.ignored(absolute)) return;
    const previous = this.debounceTimers.get(absolute);
    if (previous) clearTimeout(previous);
    const delay = eventType === 'change' ? this.stabilityThreshold : Math.min(120, this.stabilityThreshold);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(absolute);
      void this.reconcilePath(absolute, eventType);
    }, delay);
    timer.unref?.();
    this.debounceTimers.set(absolute, timer);
  }

  async reconcilePath(absolute, eventType) {
    if (this.closed || this.ignored(absolute)) return;
    let stats;
    try { stats = await fsp.stat(absolute); }
    catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
        this.emit('error', error);
        return;
      }
      if (this.knownFiles.delete(absolute)) this.emit('all', 'unlink', absolute);
      if (this.watchers.has(absolute)) await this.detachDirectory(absolute, true);
      return;
    }

    if (stats.isDirectory()) {
      if (!this.watchers.has(absolute)) {
        try {
          await this.attachDirectory(absolute, false, true);
          this.emit('all', 'addDir', absolute);
        } catch (error) { this.emit('error', error); }
      }
      return;
    }
    if (!stats.isFile()) return;

    const existed = this.knownFiles.has(absolute);
    this.knownFiles.add(absolute);
    this.emit('all', existed ? 'change' : 'add', absolute);
  }

  async reconcileDirectory(directory) {
    if (this.closed) return;
    let entries;
    try { entries = await fsp.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error?.code !== 'ENOENT') this.emit('error', error); return; }
    const visible = new Set();
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (this.ignored(absolute)) continue;
      visible.add(absolute);
      if (entry.isDirectory()) {
        if (!this.watchers.has(absolute)) {
          try { await this.attachDirectory(absolute, false, true); this.emit('all', 'addDir', absolute); }
          catch (error) { this.emit('error', error); }
        }
      } else if (entry.isFile()) {
        const existed = this.knownFiles.has(absolute);
        this.knownFiles.add(absolute);
        this.emit('all', existed ? 'change' : 'add', absolute);
      }
    }
    for (const file of [...this.knownFiles]) {
      if (path.dirname(file) === directory && !visible.has(file)) {
        this.knownFiles.delete(file);
        this.emit('all', 'unlink', file);
      }
    }
    for (const watchedDirectory of [...this.watchers.keys()]) {
      if (path.dirname(watchedDirectory) === directory && !visible.has(watchedDirectory)) {
        await this.detachDirectory(watchedDirectory, true);
      }
    }
  }

  async detachDirectory(directory, emitUnlinks = false) {
    const watcher = this.watchers.get(directory);
    if (watcher) {
      watcher.close();
      this.watchers.delete(directory);
    }
    for (const nested of [...this.watchers.keys()]) {
      if (nested.startsWith(`${directory}${path.sep}`)) {
        this.watchers.get(nested)?.close();
        this.watchers.delete(nested);
      }
    }
    for (const file of [...this.knownFiles]) {
      if (file.startsWith(`${directory}${path.sep}`)) {
        this.knownFiles.delete(file);
        if (emitUnlinks) this.emit('all', 'unlink', file);
      }
    }
    if (emitUnlinks) this.emit('all', 'unlinkDir', directory);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    this.knownFiles.clear();
  }
}

/**
 * Chokidar is the primary, cross-platform watcher. The native adapter is a
 * controlled fallback for offline installs and keeps source imports/tests
 * usable until npm can restore the declared chokidar dependency.
 */
export function watchFiles(root, options = {}) {
  if (chokidarWatch) return chokidarWatch(root, options);
  if (!fallbackNoticeShown) {
    fallbackNoticeShown = true;
    const detail = chokidarLoadError?.message ? ` (${chokidarLoadError.message})` : '';
    process.emitWarning(`chokidar is not installed; using the Node.js filesystem watcher fallback${detail}`, {
      code: 'OCHA_WATCHER_FALLBACK'
    });
  }
  return new NativeFileWatcher(root, options);
}

export function getWatcherBackend() {
  return chokidarWatch ? 'chokidar' : 'node:fs.watch';
}
