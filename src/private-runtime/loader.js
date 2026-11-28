import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getRuntimeSettings } from '../core/runtime-settings.js';

const require = createRequire(import.meta.url);
const PACKAGE_NAME = '@razzaqventures/ocha-private-runtime';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUNDLED_PRIVATE_ROOT = path.join(PROJECT_ROOT, '.private', 'ocha-private-runtime');

let runtimePromise;
let runtimeState = {
  checked: false,
  available: false,
  packageName: PACKAGE_NAME,
  version: null,
  mode: 'public-compatibility',
  source: null,
  reason: 'not_checked',
  capabilities: []
};
let warningLogged = false;

export function isPrivateRuntimeRequired() {
  return getRuntimeSettings().privateRuntime.required;
}

async function resolveDirectoryEntry(directory, source) {
  const realDirectory = await fs.realpath(directory);
  const entry = await fs.realpath(path.join(realDirectory, 'index.js'));
  if (!entry.startsWith(`${realDirectory}${path.sep}`) || path.basename(entry) !== 'index.js') {
    throw new Error('Private runtime entry escaped its package directory.');
  }
  const stat = await fs.stat(entry);
  if (!stat.isFile()) throw new Error('Private runtime entry is not a regular file.');
  return { entry, source };
}

async function resolvePrivateEntry() {
  const configured = String(getRuntimeSettings().privateRuntime.path || '').trim();
  if (configured) {
    const target = path.resolve(configured);
    const stat = await fs.stat(target);
    if (stat.isDirectory()) return resolveDirectoryEntry(target, 'configured-path');
    const realEntry = await fs.realpath(target);
    if (path.basename(realEntry) !== 'index.js') {
      throw new Error('OCHA_PRIVATE_RUNTIME_PATH must point to the private package directory or its index.js.');
    }
    return { entry: realEntry, source: 'configured-path' };
  }

  try {
    return await resolveDirectoryEntry(BUNDLED_PRIVATE_ROOT, 'bundled-local');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  try {
    return { entry: require.resolve(PACKAGE_NAME), source: 'node_modules' };
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND' || error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return null;
    throw error;
  }
}

function noteUnavailable(reason, error) {
  runtimeState = {
    checked: true,
    available: false,
    packageName: PACKAGE_NAME,
    version: null,
    mode: 'public-compatibility',
    source: null,
    reason,
    capabilities: []
  };
  if (!warningLogged) {
    warningLogged = true;
    const detail = error?.code || error?.name || reason || 'unavailable';
    console.warn(`[Ocha Private Runtime] Optional private package unavailable (${detail}); public compatibility mode active.`);
  }
}

export function loadPrivateRuntime({ hostRoot = PROJECT_ROOT } = {}) {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    let resolved;
    try {
      resolved = await resolvePrivateEntry();
      if (!resolved) {
        noteUnavailable('package_not_installed');
        if (isPrivateRuntimeRequired()) {
          throw new Error(`Required private runtime package ${PACKAGE_NAME} is not installed.`);
        }
        return null;
      }
      const packageModule = await import(pathToFileURL(resolved.entry).href);
      if (typeof packageModule.createPrivateRuntime !== 'function' || typeof packageModule.getPrivateRuntimePackageInfo !== 'function') {
        throw new Error('Private runtime package exports are incomplete.');
      }
      const info = packageModule.getPrivateRuntimePackageInfo();
      if (info?.name !== PACKAGE_NAME || info?.private !== true || info?.api !== 1) {
        throw new Error('Private runtime package identity or adapter API version is incompatible.');
      }
      const runtime = await packageModule.createPrivateRuntime({ hostRoot: path.resolve(hostRoot) });
      if (!runtime?.available || runtime.apiVersion !== 1 || !runtime.serializer || !Array.isArray(runtime.plugins)) {
        throw new Error('Private runtime returned an invalid runtime contract.');
      }
      runtimeState = {
        checked: true,
        available: true,
        packageName: runtime.packageName || PACKAGE_NAME,
        version: runtime.version || null,
        mode: 'private-runtime',
        source: resolved.source,
        reason: null,
        capabilities: [...(runtime.capabilities || [])]
      };
      return runtime;
    } catch (error) {
      noteUnavailable(resolved ? 'package_initialization_failed' : 'package_resolution_failed', error);
      if (isPrivateRuntimeRequired()) throw error;
      return null;
    }
  })();
  return runtimePromise;
}

export function getPrivateRuntimeStatus() {
  return { ...runtimeState, capabilities: [...runtimeState.capabilities] };
}

export function resetPrivateRuntimeLoaderForTests() {
  runtimePromise = undefined;
  warningLogged = false;
  runtimeState = {
    checked: false,
    available: false,
    packageName: PACKAGE_NAME,
    version: null,
    mode: 'public-compatibility',
    source: null,
    reason: 'not_checked',
    capabilities: []
  };
}
