import { extractCodeBlock, isCodeExecutionIntent } from '../runtime/code-lab.js';
import { invokeAICapability } from './capability-manager.js';

function findPreviousAssistantCode(turns) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role !== 'assistant') continue;
    const block = extractCodeBlock(turn.content);
    if (block) return block;
  }
  return null;
}

export async function handleCodeExecutionIntent({ message, userText, history }) {
  if (!isCodeExecutionIntent(userText)) return { handled: false };
  const block = extractCodeBlock(userText) || findPreviousAssistantCode(history);
  if (!block) {
    await message.reply('Saya belum menemukan blok kode yang dapat dijalankan pada percakapan ini. Kirim kode dalam blok ```python```, ```javascript```, atau ```html```, lalu minta Ocha menjalankannya.');
    return { handled: true, reason: 'code-not-found' };
  }

  try {
    const session = await invokeAICapability('code_execution', {
      language: block.language,
      source: block.source
    }, { message });
    const language = session.language.toUpperCase();
    const expires = new Date(session.expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const response = [
      '*OCHA CODE LAB · PREVIEW SIAP*',
      `Runtime: ${language}`,
      `Status awal: ${session.status.toUpperCase()}`,
      `Sesi: ${session.id.slice(0, 8)}`,
      '',
      session.previewUrl,
      '',
      `URL publik kedaluwarsa: ${expires} WIB (maksimal 1 jam).`,
      'Program berjalan terisolasi. Input interaktif dapat dikirim dari halaman preview.'
    ].join('\n');
    await message.reply(response);
    return { handled: true, session };
  } catch (error) {
    await message.reply(`OCHA CODE LAB\n${error.message}\n\nPastikan Docker/Podman, image runtime, dan cloudflared sudah disiapkan pada VPS.`);
    return { handled: true, error };
  }
}
