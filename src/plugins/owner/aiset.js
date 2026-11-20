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
    if (action === 'identity') {
      const value = String(rest[0] || '').toLowerCase();
      if (!['on', 'off'].includes(value)) return m.reply('Gunakan: .aiset identity on/off · mengatur apakah nama pembuat dan organisasi boleh diumumkan.');
      await updateConfig(config => { config.bot.publicCreatorDisclosure = value === 'on'; }, { actor: m.sender, reason: `Public creator disclosure ${value}` });
      return m.reply(`Informasi pembuat publik: ${value.toUpperCase()}.`);
    }
    if (action === 'speed') {
      const [level] = rest;
      const profile = String(level || '').toLowerCase();
      if (!['boost', 'fast', 'balanced'].includes(profile)) return m.reply('Gunakan: .aiset speed boost | fast | balanced');
      await updateConfig(config => {
        if (profile === 'boost') {
          config.ai.providerOrder = ['groq', 'gemini', 'deepseek', 'openai'];
          config.ai.timeoutMs = 3500; config.ai.totalBudgetMs = 14000; config.ai.historyMessages = 3; config.ai.maxOutputTokens = 180; config.ai.temperature = 0.5; config.ai.maxInputChars = 3500; config.ai.coalesceMs = 80; config.ai.maxKeyAttempts = 3;
        } else if (profile === 'fast') {
          config.ai.providerOrder = ['groq', 'gemini', 'deepseek', 'openai'];
          config.ai.timeoutMs = 4500; config.ai.totalBudgetMs = 20000; config.ai.historyMessages = 4; config.ai.maxOutputTokens = 220; config.ai.temperature = 0.55; config.ai.maxInputChars = 4500; config.ai.coalesceMs = 120; config.ai.maxKeyAttempts = 2;
        } else {
          config.ai.providerOrder = ['gemini', 'groq', 'deepseek', 'openai'];
          config.ai.timeoutMs = 12000; config.ai.totalBudgetMs = 90000; config.ai.historyMessages = 12; config.ai.maxOutputTokens = 850; config.ai.coalesceMs = 400; config.ai.maxKeyAttempts = 4;
        }
      }, { actor: m.sender, reason: `AI speed profile ${profile}` });
      return m.reply(`Profil AI ${profile} diterapkan.`);
    }
    const current = getConfig().ai;
    return m.reply([
      'Pengaturan AI:',
      '.aiset on/off',
      '.aiset speed boost/fast/balanced',
      '.aiset order groq,gemini,deepseek,openai',
      '.aiset model groq openai/gpt-oss-20b',
      '.aiset identity on/off',
      `.aiset saat ini: ${current.timeoutMs}ms/key · target budget ${current.totalBudgetMs}ms · output ${current.maxOutputTokens} token · coalesce ${current.coalesceMs}ms`
    ].join('\n'));
  }
};
