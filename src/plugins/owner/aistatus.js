import { getAIStatus } from '../../ai/engine.js';
import { getKeyManagerStatus } from '../../ai/providers.js';
export default {
  name: 'aistatus', aliases: ['aihealth'], category: 'owner', ownerOnly: true,
  description: 'Status AI, kesehatan key, total hit, kuota, dan maintenance',
  async execute({ m }) {
    const status = getAIStatus();
    const manager = await getKeyManagerStatus();
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
      `Route: ${status.providerOrder.join(' → ')}`,
      `Timeout/key: ${status.timeoutMs}ms · total budget (advisory): ${status.totalBudgetMs}ms`,
      `History: ${status.historyMessages} · output: ${status.maxOutputTokens} tokens · coalesce: ${status.coalesceMs}ms`,
      '', ...providers,
      '', `Recent key events: ${manager.recentEvents.length}`,
      'Gunakan .apikey list <provider> atau .apikey get <provider> <fingerprint> untuk audit per-key.'
    ].join('\n');
    return m.reply(text);
  }
};
