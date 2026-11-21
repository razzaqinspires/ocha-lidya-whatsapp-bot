import { createCodeSession, extractCodeBlock, normalizeCodeLanguage } from '../../runtime/code-lab.js';

export default {
  name: 'run', aliases: ['execute', 'previewcode'], category: 'developer', usage: '<python|node|html> <code>',
  description: 'Jalankan Python/Node.js atau tampilkan HTML pada preview sementara',
  async execute({ m, text, args }) {
    const body = String(m.body || '').trim();
    const raw = body.match(/^\S+\s+([\s\S]+)$/)?.[1]?.trim() || String(text || '').trim();
    const block = extractCodeBlock(raw);
    const firstToken = raw.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    const token = String(firstToken?.[1] || '').toLowerCase();
    const languageTokens = new Set(['py', 'python', 'python3', 'js', 'javascript', 'node', 'nodejs', 'mjs', 'html', 'htm', 'web']);
    const explicitLanguage = languageTokens.has(token) ? token : (languageTokens.has(String(args?.[0] || '').toLowerCase()) ? args[0] : '');
    const languageHint = block?.language || explicitLanguage;
    const source = block?.source || (explicitLanguage ? firstToken?.[2] || '' : raw);
    if (!source.trim()) {
      return m.reply('Format: .run python ```python\nprint("Hello")\n```\nBahasa tersedia: Python, Node.js, HTML.');
    }
    try {
      const language = normalizeCodeLanguage(languageHint, source);
      const session = await createCodeSession({ ownerId: m.sender, chatId: m.chat, language, source });
      return m.reply([
        '*OCHA CODE LAB · PREVIEW SIAP*',
        `Runtime: ${session.language.toUpperCase()}`,
        `Status awal: ${session.status.toUpperCase()}`,
        '', session.previewUrl, '',
        'Sesi otomatis dihapus maksimal 1 jam setelah dibuat.'
      ].join('\n'));
    } catch (error) {
      return m.reply(`Code Lab: ${error.message}`);
    }
  }
};
