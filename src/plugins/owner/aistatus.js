import { getAIStatus } from '../../ai/engine.js';
export default {
  name: 'aistatus', aliases: ['aihealth'], category: 'owner', ownerOnly: true,
  description: 'Status provider AI tanpa menampilkan API key',
  async execute({ m }) {
    const status = getAIStatus();
    const providers = status.providers.map(item => {
      const latency = item.averageLatencyMs == null ? 'avg: n/a' : `avg: ${item.averageLatencyMs}ms`;
      return `${item.configured ? 'READY' : 'NO KEY'} · ${item.name} · ${item.model} · keys:${item.keys} · ${latency} · ok:${item.successes} fail:${item.failures}${item.circuitOpen ? ' · CIRCUIT OPEN' : ''}`;
    });
    const text = [
      `AI: ${status.enabled ? 'ENABLED' : 'DISABLED'}`,
      `Route: ${status.providerOrder.join(' → ')}`,
      `Per-provider timeout: ${status.timeoutMs}ms`,
      `Total response budget: ${status.totalBudgetMs}ms`,
      `Keys per attempt: ${status.maxKeyAttempts} · berikutnya bergilir otomatis`,
      `Message coalescing: ${status.coalesceMs}ms`,
      `History: ${status.historyMessages} pesan`,
      `Output limit: ${status.maxOutputTokens} tokens`,
      '', ...providers
    ].join('\n');
    return m.reply(text);
  }
};
