import { startAutoGitSync } from './auto-git-sync.js';
import { startAcAutoGitSync } from './ac-auto-git-sync.js';
import { loadAutoPushConfig, saveAutoPushConfig, AUTO_PUSH_TARGETS } from './auto-push-config.js';

let runtime = null;

function normalizeTarget(target) {
  if (target === 'all') return [...AUTO_PUSH_TARGETS];
  if (AUTO_PUSH_TARGETS.includes(target)) return [target];
  throw new Error(`Target auto-push tidak dikenal: ${target}`);
}

export async function startAutoPushRuntime({ watch = true } = {}) {
  if (runtime) return runtime;
  const config = await loadAutoPushConfig();
  const services = {
    ocha: await startAutoGitSync({ enabled: config.targets.ocha.enabled, watch }),
    ac: await startAcAutoGitSync({ enabled: config.targets.ac.enabled, watch }),
  };

  runtime = {
    async getStatus(target = 'all') {
      const selected = normalizeTarget(target);
      const result = {};
      for (const name of selected) {
        const status = await services[name].getStatus();
        result[name] = { ...status, enabled: config.targets[name].enabled };
      }
      return result;
    },
    async setEnabled(target, enabled) {
      const selected = normalizeTarget(target);
      const next = await loadAutoPushConfig();
      for (const name of selected) next.targets[name].enabled = Boolean(enabled);
      const saved = await saveAutoPushConfig(next);
      for (const name of selected) await services[name].setEnabled(saved.targets[name].enabled);
      for (const name of selected) config.targets[name].enabled = saved.targets[name].enabled;
      return this.getStatus(target);
    },
    async pushNow(target = 'all') {
      const selected = normalizeTarget(target);
      const results = {};
      for (const name of selected) {
        if (!config.targets[name].enabled) {
          results[name] = { ok: false, reason: 'disabled_in_configuration' };
          continue;
        }
        results[name] = await services[name].pushNow();
      }
      return results;
    },
    async flush(reason = 'controlled update handoff') {
      const results = {};
      for (const name of AUTO_PUSH_TARGETS) {
        if (!config.targets[name].enabled) continue;
        results[name] = await services[name].flush(reason);
      }
      return results;
    },
    pause(reason) {
      for (const service of Object.values(services)) service.pause?.(reason);
    },
    resume(reason, options) {
      for (const service of Object.values(services)) service.resume?.(reason, options);
    },
    async close() {
      await Promise.allSettled(Object.values(services).map(service => service.close?.()));
      if (runtime === this) runtime = null;
    },
  };
  return runtime;
}

export function getAutoPushRuntime() {
  return runtime;
}
