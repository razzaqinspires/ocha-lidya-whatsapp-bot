import crypto from 'node:crypto';

const WORKER_ROLES = Object.freeze([
  'contribution-observer', 'integrity-guardian', 'language-intelligence', 'capability-discovery',
  'adapter-intelligence', 'compatibility', 'dependency-intelligence', 'execution', 'provider-health',
  'autonomous-routing', 'fallback-orchestrator', 'response-intelligence', 'command-generation',
  'command-registry', 'audit', 'governance'
]);
const state = new Map(WORKER_ROLES.map(role => [role, { role, status: 'idle', jobs: 0, failures: 0, lastRunAt: null, lastError: null }]));
let queue = Promise.resolve();

function safeErrorSummary(error) {
  const name = String(error?.name || 'Error').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60) || 'Error';
  const code = String(error?.code || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60);
  return code ? `${name} (${code})` : name;
}

export function listWorkers() { return [...state.values()].map(item => ({ ...item })); }
export async function runWorker(role, job, fn) {
  if (!state.has(role)) throw new Error(`Unknown ACIE worker: ${role}`);
  if (typeof fn !== 'function') throw new TypeError('worker function required');
  const current = state.get(role);
  const traceId = crypto.randomUUID();
  const execute = async () => {
    current.status = 'running'; current.jobs += 1; current.lastRunAt = new Date().toISOString();
    try { const result = await fn({ traceId, job, permissions: { originalVaultReadOnly: true, originalVaultWrite: false, executeContribution: false } }); current.status = 'idle'; current.lastError = null; return { traceId, result }; }
    catch (error) { current.status = 'failed'; current.failures += 1; current.lastError = safeErrorSummary(error); throw error; }
  };
  const run = queue.then(execute);
  queue = run.catch(() => {});
  return run;
}
