import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'runtime.json');

const DEFAULTS = Object.freeze({
  schemaVersion: 1,
  nadi: {
    repositoryUrl: 'https://github.com/razzaqinspires/artificial-consciousness-component',
    ref: '16c2fa6e1b500745f260bcf091284a6e18726883',
    home: '',
    sourceDir: '',
    sha256: '',
    update: false,
    baseUrl: '',
    port: 18765,
    dataDir: '',
    heartbeatMs: 1000,
    pythonBin: '',
  },
  paths: {
    kernelDashboardDir: 'data/kernel',
    kernelTelemetryFile: 'data/kernel/telemetry.json',
    projectLibraryRoot: '',
    rooRoot: 'data/roo',
  },
  privateRuntime: { required: false, path: '' },
  rentalApi: { host: '127.0.0.1', port: 8788, tunnel: false, cloudflaredBin: 'cloudflared' },
  tooling: { prettierBin: 'npx', bootstrapDryRun: false },
  chatnivo: {
    baseUrl: 'https://app.chatnivo.com',
    exportDirectory: 'data/private/chatnivo-exports',
    modelId: '',
    fallbackEnabled: true,
  },
  llama: {
    enabled: true,
    autoInstallRuntime: true,
    binary: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'llama3.2:3b',
    contextTokens: 8192,
    timeoutMs: 120000,
    pullTimeoutMs: 1800000,
    startupTimeoutMs: 90000,
    installTimeoutMs: 1200000,
    keepAlive: '5m',
    notifyOwner: true,
    fallbackEnabled: true,
  },
});

function merge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return structuredClone(base);
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = merge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function readFileConfig() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(DEFAULTS);
    throw new Error(`Runtime config tidak valid (${path.relative(PROJECT_ROOT, CONFIG_PATH)}): ${error.message}`, {
      cause: error,
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('config/runtime.json harus berupa JSON object.');
  }
  return merge(DEFAULTS, parsed);
}

function readLegacyEnvironmentOverrides() {
  // Explicit keys keep static environment auditing complete. These are compatibility
  // overrides only; normal deployments should edit config/runtime.json instead.
  return {
    OCHA_NADI_REPO_URL: process.env.OCHA_NADI_REPO_URL,
    OCHA_NADI_REF: process.env.OCHA_NADI_REF,
    OCHA_NADI_HOME: process.env.OCHA_NADI_HOME,
    OCHA_NADI_SOURCE_DIR: process.env.OCHA_NADI_SOURCE_DIR,
    OCHA_NADI_SHA256: process.env.OCHA_NADI_SHA256,
    OCHA_NADI_UPDATE: process.env.OCHA_NADI_UPDATE,
    OCHA_NADI_BASE_URL: process.env.OCHA_NADI_BASE_URL,
    OCHA_NADI_PORT: process.env.OCHA_NADI_PORT,
    OCHA_NADI_DATA_DIR: process.env.OCHA_NADI_DATA_DIR,
    OCHA_AC_HEARTBEAT_MS: process.env.OCHA_AC_HEARTBEAT_MS,
    OCHA_PYTHON_BIN: process.env.OCHA_PYTHON_BIN,
    OCHA_KERNEL_DASHBOARD_DIR: process.env.OCHA_KERNEL_DASHBOARD_DIR,
    OCHA_KERNEL_TELEMETRY_FILE: process.env.OCHA_KERNEL_TELEMETRY_FILE,
    OCHA_PROJECT_LIBRARY_ROOT: process.env.OCHA_PROJECT_LIBRARY_ROOT,
    OCHA_ROO_ROOT: process.env.OCHA_ROO_ROOT,
    OCHA_PRIVATE_RUNTIME_REQUIRED: process.env.OCHA_PRIVATE_RUNTIME_REQUIRED,
    OCHA_PRIVATE_RUNTIME_PATH: process.env.OCHA_PRIVATE_RUNTIME_PATH,
    OCHA_RENTAL_API_HOST: process.env.OCHA_RENTAL_API_HOST,
    OCHA_RENTAL_API_PORT: process.env.OCHA_RENTAL_API_PORT,
    OCHA_RENTAL_API_TUNNEL: process.env.OCHA_RENTAL_API_TUNNEL,
    CLOUDFLARED_BIN: process.env.CLOUDFLARED_BIN,
    OCHA_PRETTIER_BIN: process.env.OCHA_PRETTIER_BIN,
    NEXORA_BOOTSTRAP_DRY_RUN: process.env.NEXORA_BOOTSTRAP_DRY_RUN,
    CHATNIVO_URL: process.env.CHATNIVO_URL,
    CHATNIVO_EXPORT_DIR: process.env.CHATNIVO_EXPORT_DIR,
  };
}

function envString(environment, name, fallback) {
  const value = environment[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function envNumber(environment, name, fallback) {
  const value = environment[name];
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBoolean(environment, name, fallback) {
  const value = environment[name];
  if (typeof value !== 'string' || !value.trim()) return Boolean(fallback);
  return /^(?:1|true|yes|on)$/i.test(value.trim());
}

/**
 * Non-secret runtime settings live in config/runtime.json.
 * Legacy OCHA_* process-environment overrides remain supported for tests and
 * container orchestration, but are no longer part of the .env template.
 */
export function getRuntimeSettings() {
  const file = readFileConfig();
  const environment = readLegacyEnvironmentOverrides();
  return {
    nadi: {
      repositoryUrl: envString(environment, 'OCHA_NADI_REPO_URL', file.nadi.repositoryUrl),
      ref: envString(environment, 'OCHA_NADI_REF', file.nadi.ref),
      home: envString(environment, 'OCHA_NADI_HOME', file.nadi.home),
      sourceDir: envString(environment, 'OCHA_NADI_SOURCE_DIR', file.nadi.sourceDir),
      sha256: envString(environment, 'OCHA_NADI_SHA256', file.nadi.sha256),
      update: envBoolean(environment, 'OCHA_NADI_UPDATE', file.nadi.update),
      baseUrl: envString(environment, 'OCHA_NADI_BASE_URL', file.nadi.baseUrl),
      port: envNumber(environment, 'OCHA_NADI_PORT', file.nadi.port),
      dataDir: envString(environment, 'OCHA_NADI_DATA_DIR', file.nadi.dataDir),
      heartbeatMs: envNumber(environment, 'OCHA_AC_HEARTBEAT_MS', file.nadi.heartbeatMs),
      pythonBin: envString(environment, 'OCHA_PYTHON_BIN', file.nadi.pythonBin),
    },
    paths: {
      kernelDashboardDir: envString(environment, 'OCHA_KERNEL_DASHBOARD_DIR', file.paths.kernelDashboardDir),
      kernelTelemetryFile: envString(environment, 'OCHA_KERNEL_TELEMETRY_FILE', file.paths.kernelTelemetryFile),
      projectLibraryRoot: envString(environment, 'OCHA_PROJECT_LIBRARY_ROOT', file.paths.projectLibraryRoot),
      rooRoot: envString(environment, 'OCHA_ROO_ROOT', file.paths.rooRoot),
    },
    privateRuntime: {
      required: envBoolean(environment, 'OCHA_PRIVATE_RUNTIME_REQUIRED', file.privateRuntime.required),
      path: envString(environment, 'OCHA_PRIVATE_RUNTIME_PATH', file.privateRuntime.path),
    },
    rentalApi: {
      host: envString(environment, 'OCHA_RENTAL_API_HOST', file.rentalApi.host),
      port: envNumber(environment, 'OCHA_RENTAL_API_PORT', file.rentalApi.port),
      tunnel: envBoolean(environment, 'OCHA_RENTAL_API_TUNNEL', file.rentalApi.tunnel),
      cloudflaredBin: envString(environment, 'CLOUDFLARED_BIN', file.rentalApi.cloudflaredBin),
    },
    tooling: {
      prettierBin: envString(environment, 'OCHA_PRETTIER_BIN', file.tooling.prettierBin),
      bootstrapDryRun: envBoolean(environment, 'NEXORA_BOOTSTRAP_DRY_RUN', file.tooling.bootstrapDryRun),
    },
    chatnivo: {
      baseUrl: envString(environment, 'CHATNIVO_URL', file.chatnivo.baseUrl),
      exportDirectory: envString(environment, 'CHATNIVO_EXPORT_DIR', file.chatnivo.exportDirectory),
      modelId: String(file.chatnivo.modelId || ''),
      fallbackEnabled: file.chatnivo.fallbackEnabled !== false,
    },
    llama: { ...file.llama },
  };
}

export function getRuntimeConfigPath() {
  return CONFIG_PATH;
}
