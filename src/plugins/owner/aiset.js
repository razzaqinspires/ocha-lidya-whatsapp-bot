import { updateConfig } from '../../config.js';
import { providerNames } from '../../ai/providers.js';
export default {
  name: 'aiset', aliases: ['aiconfig'], category: 'owner', ownerOnly: true,
  description: 'Atur AI on/off, urutan provider, dan model provider',
  async execute({ m, args }) {
    const [action, ...rest] = args;
    if (action === 'on' || action === 'off') {
      await updateConfig(c => { c.ai.enabled = action === 'on'; }, { actor: m.sender, reason: `AI ${action}` });
      return m.reply(`AI ${action === 'on' ? 'diaktifkan' : 'dinonaktifkan'}.`);
    }
    if (action === 'order') {
      const order = rest.join('').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
      if (!order.length || order.some(name => !providerNames.includes(name)) || new Set(order).size !== order.length) {
        return m.reply(`Format: .aiset order gemini,groq,qwen,deepseek,openai\nProvider: ${providerNames.join(', ')}`);
      }
      await updateConfig(c => { c.ai.providerOrder = order; }, { actor: m.sender, reason: 'AI provider order' });
      return m.reply(`Urutan fallback AI: ${order.join(' → ')}`);
    }
    if (action === 'model') {
      const [provider, ...modelParts] = rest;
      const model = modelParts.join(' ').trim();
      if (!providerNames.includes(String(provider).toLowerCase()) || !model || model.length > 120) return m.reply('Format: .aiset model groq openai/gpt-oss-120b');
      await updateConfig(c => { c.ai.models[provider.toLowerCase()] = model; }, { actor: m.sender, reason: `AI model ${provider}` });
      return m.reply(`Model ${provider} diubah menjadi ${model}. Pastikan ID model tersedia pada API provider tersebut.`);
    }
    return m.reply('Pengaturan AI:\n.aiset on\n.aiset off\n.aiset order gemini,groq,qwen,deepseek,openai\n.aiset model groq openai/gpt-oss-120b\n.aistatus');
  }
};
