import { getAIStatus } from '../../ai/engine.js';
import { getKeyManagerStatus } from '../../ai/providers.js';
import { getRelationshipEngineStatus } from '../../ai/user-profiles.js';
import { getPublicIdentity } from '../../core/public-identity.js';
import { getModelCatalogStatus } from '../../ai/model-catalog.js';
export default {
  name: 'aistatus', aliases: ['aihealth'], category: 'owner', ownerOnly: true, usage: '',
  description: 'Status AI, kesehatan key, total hit, kuota, dan maintenance',
  async execute({ m }) {
    const status = getAIStatus();
    const manager = await getKeyManagerStatus();
    const relationships = getRelationshipEngineStatus();
    const identity = getPublicIdentity();
    const catalog = await getModelCatalogStatus();
    const providers = status.providers.map(item => {
      const keys = item.keyDetails.map(key => `  ${key.masked} [${key.fingerprint}] ${key.status} · hit ${key.hits} · ok ${key.successes} · fail ${key.failures}${key.retryAt ? ` · retry ${new Date(key.retryAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}` : ''}`).join('\n');
      return [
        `${item.name.toUpperCase()} · ${item.configured ? 'CONFIGURED' : 'NO KEY'} · usable/probe: ${item.usableKeys}/${item.keys}`,
        `  hit ${item.totalHits} · success ${item.totalSuccesses} · fail ${item.totalFailures} · tokens ${item.totalTokens} · avg ${item.averageLatencyMs ?? '-'}ms`,
        `  invalid ${item.invalidKeys} · daily limit ${item.dailyLimitedKeys} · circuit ${item.circuitOpen ? 'OPEN' : 'CLOSED'}`,
        keys || '  (tidak ada key terdaftar)'
      ].join('\n');
    });
    const text = [
      '*OCHA LIDYA — AI CONTROL CENTER*',
      `Public model: ${status.publicModel}`,
      `AI: ${status.enabled ? 'ENABLED' : 'DISABLED'}`,
      `Maintenance: ${manager.maintenance.active ? `ACTIVE sejak ${manager.maintenance.since}` : 'OFF'}`,
      `Creator identity: ${identity.creatorName} · ${identity.organization} · public ${identity.disclosureEnabled ? 'ON' : 'OFF'}`,
      `Relationship profiles: ${relationships.profiles} · XP ${relationships.xpPerInteraction}/interaksi · daily cap ${relationships.dailyXpCap}`,
      `Key rotation: seluruh key aktif dicoba berurutan (round-robin) sebelum fallback`,
      `Provider order: ${(status.providerOrder || []).join(' → ') || 'groq → gemini → deepseek → openai'}`,
      `Free-only routing: ${status.freeOnly === false ? 'OFF (paid providers allowed)' : 'ON (Groq/Gemini free model allowlist)'}`,
      `Model catalog scheduler: ${catalog.scheduler?.active ? 'ACTIVE' : 'INACTIVE'} (${catalog.scheduler?.mode || 'in-process'}) · next ${catalog.scheduler?.nextRunAt || catalog.nextCheckAt || 'pending'} · DB data/ai-model-catalog.json`,
      `Model catalog detached worker: ${catalog.scheduler?.workerActive ? `ACTIVE · PID ${catalog.scheduler.workerPid}` : 'INACTIVE'} · heartbeat ${catalog.scheduler?.workerHeartbeatAt || '-'}`,
      `Model catalog last check: ${catalog.checkedAt || 'belum tersedia'} · normal cadence 24h · transient outage retry ${catalog.scheduler?.retryMinutes || 60}m`,
      `Catalog provider state: ${Object.entries(catalog.providers || {}).map(([name, item]) => `${name}:${item.status || 'unknown'}${item.stale ? ':stale' : ''} free=${item.recommendedFreeModel || '-'}`).join(' | ') || 'belum ada'}`,
      'Audit model: .aimodels status · refresh manual: .aimodels refresh',
      `Fallback provider: ${(status.providerOrder || []).length > 1 ? 'ON · provider berikutnya dicoba setelah semua key provider saat ini gagal/tidak siap' : 'OFF · hanya satu provider dalam urutan'}`,
      `Timeout/key: ${status.timeoutMs}ms · total budget (advisory): ${status.totalBudgetMs}ms`,
      `History: ${status.historyMessages} · output: ${status.maxOutputTokens} tokens · coalesce: ${status.coalesceMs}ms`,
      '', ...providers,
      '', `Recent key events: ${manager.recentEvents.length}`,
      'Gunakan .apikey list <provider> atau .apikey get <provider> <fingerprint> untuk audit per-key.'
    ].join('\n');
    return m.reply(text);
  }
};
