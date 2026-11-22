import { maintainRentals } from './service.js';
import { logger } from '../core/logger.js';
let timer = null;
let running = false;
let task = Promise.resolve();
let latest = { active: false, startedAt: null, lastRunAt: null, lastError: null };

export function startRentalScheduler(getSocket, { intervalMs = 60_000, runImmediately = true } = {}) {
  if (timer) return { ...latest, active: true, reused: true };
  latest = { active: true, startedAt: new Date().toISOString(), lastRunAt: null, lastError: null };
  const run = () => {
    if (running) return task;
    running = true;
    task = maintainRentals(getSocket).then(result => {
      latest.lastRunAt = result.checkedAt;
      latest.lastError = null;
      logger.info(result, 'Autonomous rental lifecycle maintenance completed');
    }).catch(error => {
      latest.lastError = error.message;
      logger.error({ err: error }, 'Autonomous rental lifecycle maintenance failed; next cycle will retry');
    }).finally(() => { running = false; });
    return task;
  };
  if (runImmediately) void run();
  timer = setInterval(run, Math.max(15_000, intervalMs));
  timer.unref?.();
  return { ...latest, active: true };
}
export function stopRentalScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  latest.active = false;
  return { ...latest };
}
export function getRentalSchedulerStatus() { return { ...latest, active: Boolean(timer), running }; }
