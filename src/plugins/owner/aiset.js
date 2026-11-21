import { updateConfig, getConfig } from '../../core/config.js';
import { providerNames } from '../../ai/providers.js';
export default {
  name: 'aiset', aliases: ['aiconfig'], category: 'owner', ownerOnly: true, usage: '<setting> [value]',
  description: 'Atur prioritas provider, model upstream, dan kecepatan',
  async execute({ m, args }) {
    const [action, ...rest] = args;
    if (action === 'on' || action === 'off') {
      await updateConfig(config => { config.ai.enabled = action === 'on'; }, { actor: m.sender, reason: `AI ${action}` });
      return m.reply(`AI ${action === 'on' ? 'diaktifkan' : 'dinonaktifkan'}.`);
    }
    if (action === 'order') {
      const requested = rest.join(' ').split(/[,;\s]+/).map(value => value.trim().toLowerCase()).filter(Boolean);
      const invalid = requested.filter(provider => !providerNames.includes(provider));
      const order = [...new Set(requested)];
      if (!order.length || invalid.length) return m.reply(`Format: .aiset order groq,gemini,deepseek,openai\nProvider tersedia: ${providerNames.join(', ')}`);
      await updateConfig(config => { config.ai.providerOrder = order; }, { actor: m.sender, reason: 'Set ordered AI provider fallback chain' });
      return m.reply(`Urutan provider AI disetel: ${order.join(' → ')}. 401/key-specific mencoba key berikutnya; 429, timeout, network, model error, atau billing langsung pindah provider.`);
    }
    if (action === 'free-only') {
      const value = String(rest[0] || '').toLowerCase();
      if (!['on', 'off'].includes(value)) return m.reply('Gunakan: .aiset free-only on/off\nON: hanya provider/model dengan akses gratis yang terdokumentasi. OFF: provider berbayar boleh dicoba; biaya penggunaan mengikuti akun provider.');
      await updateConfig(config => { config.ai.freeOnly = value === 'on'; }, { actor: m.sender, reason: `AI free-only mode ${value}` });
      return m.reply(value === 'on'
        ? 'Mode free-only ON. Routing hanya mengizinkan model yang tercatat memiliki akses gratis; DeepSeek/OpenAI berbayar dilewati.'
        : 'Mode free-only OFF. Provider berbayar dapat masuk fallback. Pastikan billing dan batas pengeluaran akun provider sudah diatur.');
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
          config.ai.timeoutMs = 3500; config.ai.totalBudgetMs = 14000; config.ai.historyMessages = 3; config.ai.maxOutputTokens = 180; config.ai.temperature = 0.5; config.ai.maxInputChars = 3500; config.ai.coalesceMs = 80;
        } else if (profile === 'fast') {
          config.ai.timeoutMs = 4500; config.ai.totalBudgetMs = 20000; config.ai.historyMessages = 4; config.ai.maxOutputTokens = 220; config.ai.temperature = 0.55; config.ai.maxInputChars = 4500; config.ai.coalesceMs = 120;
        } else {
          config.ai.timeoutMs = 12000; config.ai.totalBudgetMs = 90000; config.ai.historyMessages = 12; config.ai.maxOutputTokens = 850; config.ai.coalesceMs = 400;
        }
      }, { actor: m.sender, reason: `AI speed profile ${profile}` });
      return m.reply(`Profil AI ${profile} diterapkan.`);
    }
    const current = getConfig().ai;
    return m.reply([
      'Pengaturan AI:',
      '.aiset on/off',
      '.aiset speed boost/fast/balanced',
      '.aiset order groq,gemini,deepseek,openai  (urutan prioritas + fallback otomatis)',
      '.aiset free-only on/off  (default ON, cegah biaya provider berbayar)',
      '.aimodels status | refresh  (katalog model provider)',
      '.aiset model groq openai/gpt-oss-120b',
      '.aiset identity on/off',
      `.aiset saat ini: ${current.timeoutMs}ms/key · target budget ${current.totalBudgetMs}ms · output ${current.maxOutputTokens} token · coalesce ${current.coalesceMs}ms`
    ].join('\n'));
  }
};
