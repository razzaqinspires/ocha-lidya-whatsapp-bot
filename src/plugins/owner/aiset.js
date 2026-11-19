import { updateConfig, getConfig } from '../../core/config.js';
import { providerNames } from '../../ai/providers.js';
export default {
  name: 'aiset', aliases: ['aiconfig'], category: 'owner', ownerOnly: true,
  description: 'Atur prioritas provider, model upstream, dan kecepatan',
  async execute({ m, args }) {
    const [action, ...rest] = args;
    if (action === 'on' || action === 'off') {
      await updateConfig(config => { config.ai.enabled = action === 'on'; }, { actor: m.sender, reason: `AI ${action}` });
      return m.reply(`AI ${action === 'on' ? 'diaktifkan' : 'dinonaktifkan'}.`);
    }
    if (action === 'order') {
      const order = rest.join('').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
      if (!order.length || order.some(name => !providerNames.includes(name)) || new Set(order).size !== order.length) {
        return m.reply(`Format: .aiset order groq,gemini,deepseek,openai\nProvider: ${providerNames.join(', ')}`);
      }
      await updateConfig(config => { config.ai.providerOrder = order; }, { actor: m.sender, reason: 'AI provider order' });
      return m.reply(`Prioritas provider disimpan: ${order.join(' → ')}. Provider lain tetap dicoba setelah prioritas ini jika memiliki key.`);
    }
    if (action === 'model') {
      const [provider, ...modelParts] = rest;
      const model = modelParts.join(' ').trim();
      if (!providerNames.includes(String(provider).toLowerCase()) || !model || model.length > 120) return m.reply('Format: .aiset model groq openai/gpt-oss-20b');
      await updateConfig(config => { config.ai.models[provider.toLowerCase()] = model; }, { actor: m.sender, reason: `AI model ${provider}` });
      return m.reply(`Model ${provider} diubah menjadi ${model}. Pastikan ID model tersedia pada API provider.`);
    }
    if (action === 'speed') {
      const [level] = rest;
      if (!['fast', 'balanced'].includes(String(level).toLowerCase())) return m.reply('Gunakan: .aiset speed fast | balanced');
      await updateConfig(config => {
        if (level === 'fast') {
          config.ai.providerOrder = ['groq', 'gemini', 'deepseek', 'openai'];
          config.ai.timeoutMs = 7000; config.ai.totalBudgetMs = 45000; config.ai.historyMessages = 6; config.ai.maxOutputTokens = 320; config.ai.coalesceMs = 350;
        } else {
          config.ai.providerOrder = ['gemini', 'groq', 'deepseek', 'openai'];
          config.ai.timeoutMs = 12000; config.ai.totalBudgetMs = 90000; config.ai.historyMessages = 12; config.ai.maxOutputTokens = 850; config.ai.coalesceMs = 400;
        }
      }, { actor: m.sender, reason: `AI speed profile ${level}` });
      return m.reply(`Profil AI ${level} diterapkan.`);
    }
    const current = getConfig().ai;
    return m.reply([
      'Pengaturan AI:',
      '.aiset on/off',
      '.aiset speed fast/balanced',
      '.aiset order groq,gemini,deepseek,openai',
      '.aiset model groq openai/gpt-oss-20b',
      `.aiset saat ini: ${current.timeoutMs}ms/key · target budget ${current.totalBudgetMs}ms`
    ].join('\n'));
  }
};
