import { getAIStatus } from '../../ai/engine.js';
export default {
  name: 'aistatus', aliases: ['aihealth'], category: 'owner', ownerOnly: true,
  description: 'Status provider AI dan urutan fallback tanpa menampilkan API key',
  async execute({ m }) {
    const status = getAIStatus();
    const providers = status.providers.map(item => `${item.configured ? 'READY' : 'NO KEY'} · ${item.name} · ${item.model} · keys:${item.keys}${item.circuitOpen ? ' · CIRCUIT OPEN' : ''}`);
    await m.reply(`AI ${status.enabled ? 'ENABLED' : 'DISABLED'}\nFallback: ${status.providerOrder.join(' → ')}\nTimeout: ${status.timeoutMs}ms\nHistory: ${status.historyMessages} pesan\n\n${providers.join('\n')}`);
  }
};
