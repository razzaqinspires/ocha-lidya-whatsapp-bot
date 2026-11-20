import { extractCodeBlockCandidate, isCodeExecutionIntent } from '../runtime/code-lab.js';
import { invokeAICapability } from './capability-manager.js';

function findPreviousAssistantCode(turns) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role !== 'assistant') continue;
    const block = extractCodeBlockCandidate(turn.content);
    if (block) return block;
  }
  return null;
}

export async function handleCodeExecutionIntent({ message, userText, history, completeCode }) {
  if (!isCodeExecutionIntent(userText)) return { handled: false };
  // The quoted WhatsApp message is authoritative. A user may reply directly to
  // an AI code answer even when its persisted reply-chain anchor is unavailable.
  const quotedText = String(message.quoted?.text || '');
  let block = extractCodeBlockCandidate(quotedText)
    || extractCodeBlockCandidate(userText)
    || findPreviousAssistantCode(history);
  if (!block) {
    await message.reply('Saya membaca pesan reply kamu, tetapi tidak menemukan blok kode di dalamnya. Balas pesan yang berisi kode lengkap atau kirim blok kodenya langsung.');
    return { handled: true, reason: 'code-not-found' };
  }

  try {
    if (!block.complete) {
      if (typeof completeCode !== 'function') {
        await message.reply('Kode dalam pesan yang kamu reply terpotong. Saya belum akan menjalankannya karena belum lengkap. Minta Ocha melengkapi kode terlebih dahulu.');
        return { handled: true, reason: 'quoted-code-incomplete' };
      }
      const completed = await completeCode({ language: block.language, source: block.source, quotedText });
      block = extractCodeBlockCandidate(completed);
      if (!block?.complete) throw new Error('AI belum berhasil melengkapi blok kode secara utuh. Silakan minta ulang pembuatan kode.');
    }
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
      'Kode diambil dari pesan reply atau riwayat AI dan dijalankan dalam worker terisolasi.'
    ].join('\n');
    await message.reply(response);
    return { handled: true, session };
  } catch (error) {
    await message.reply(`OCHA CODE LAB\n${error.message}\n\nPastikan Docker/Podman, image runtime, dan cloudflared sudah disiapkan pada VPS.`);
    return { handled: true, error };
  }
}
