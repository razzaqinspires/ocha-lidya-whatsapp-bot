import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_DIR = path.join(PROJECT_ROOT, '.private', 'automation');
const CONFIG_FILE = path.join(CONFIG_DIR, 'auto-push.json');
const TARGETS = Object.freeze(['ocha', 'ac']);

export function defaultAutoPushConfig() {
  return {
    schemaVersion: 1,
    updatedAt: null,
    targets: {
      ocha: { enabled: true, repository: 'razzaqinspires/ocha-lidya-whatsapp-bot', branch: 'main' },
      ac: { enabled: true, repository: 'razzaqinspires/artificial-consciousness-component', branch: 'main' },
    },
  };
}

function normalizeConfig(input) {
  const defaults = defaultAutoPushConfig();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return defaults;
  const result = { ...defaults, updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : null };
  for (const target of TARGETS) {
    const item = input.targets?.[target];
    result.targets[target] = {
      ...defaults.targets[target],
      enabled: typeof item?.enabled === 'boolean' ? item.enabled : defaults.targets[target].enabled,
      repository: defaults.targets[target].repository,
      branch: defaults.targets[target].branch,
    };
  }
  return result;
}

export async function loadAutoPushConfig({ root = PROJECT_ROOT, create = true } = {}) {
  const directory = path.join(path.resolve(root), '.private', 'automation');
  const file = path.join(directory, 'auto-push.json');
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      parsed.schemaVersion !== 1 ||
      !parsed.targets ||
      typeof parsed.targets !== 'object' ||
      TARGETS.some(target => typeof parsed.targets[target]?.enabled !== 'boolean')
    ) {
      throw new SyntaxError('struktur/schema konfigurasi tidak valid');
    }
    return normalizeConfig(parsed);
  } catch (error) {
    if (error.code === 'ENOENT') {
      const defaults = defaultAutoPushConfig();
      if (create) await saveAutoPushConfig(defaults, { root });
      return defaults;
    }
    if (!(error instanceof SyntaxError))
      throw new Error(`Konfigurasi auto-push tidak dapat dibaca (${file}): ${error.message}`);

    // Corrupt configuration must never interrupt Ocha startup or silently
    // re-enable publishing. Quarantine the malformed file and fail closed.
    const quarantine = `${file}.corrupt-${Date.now()}`;
    await fs.rename(file, quarantine).catch(renameError => {
      throw new Error(`Konfigurasi auto-push rusak dan tidak dapat diamankan (${file}): ${renameError.message}`);
    });
    const safe = defaultAutoPushConfig();
    safe.targets.ocha.enabled = false;
    safe.targets.ac.enabled = false;
    if (create) await saveAutoPushConfig(safe, { root });
    return safe;
  }
}

export async function saveAutoPushConfig(config, { root = PROJECT_ROOT } = {}) {
  const directory = path.join(path.resolve(root), '.private', 'automation');
  const file = path.join(directory, 'auto-push.json');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700).catch(() => {});
  const normalized = normalizeConfig({ ...config, updatedAt: new Date().toISOString() });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await fs.chmod(temporary, 0o600).catch(() => {});
  await fs.rename(temporary, file);
  return normalized;
}

export async function setAutoPushTargetEnabled(target, enabled, { root = PROJECT_ROOT } = {}) {
  if (!TARGETS.includes(target)) throw new Error(`Target auto-push tidak dikenal: ${target}`);
  if (typeof enabled !== 'boolean') throw new TypeError('enabled harus boolean');
  const current = await loadAutoPushConfig({ root });
  current.targets[target].enabled = enabled;
  return saveAutoPushConfig(current, { root });
}

export function normalizeAutoPushTarget(value) {
  const target = String(value || 'all')
    .trim()
    .toLowerCase();
  if (['ocha', 'bot', 'main'].includes(target)) return 'ocha';
  if (['ac', 'nadi', 'artificial-consciousness-component'].includes(target)) return 'ac';
  if (['all', 'dua', 'both', 'semua'].includes(target)) return 'all';
  return null;
}

export const AUTO_PUSH_TARGETS = TARGETS;
