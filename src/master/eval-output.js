export const EVAL_TEXT_FILE_THRESHOLD = 30_000;

export function shouldSendEvalAsTextFile(value, threshold = EVAL_TEXT_FILE_THRESHOLD) {
  return String(value ?? '').length > threshold;
}

export function renderEvalConsoleOutput(value, showTemplate = true) {
  const output = String(value ?? '') || 'undefined';
  if (!showTemplate) return output;
  return ['╭─ OCHA MASTER CONSOLE · JAVASCRIPT ───────', output, '╰──────────────────────────────────────────'].join(
    '\n',
  );
}

export async function deliverEvalOutput({ sock, message, text }) {
  const output = String(text ?? 'undefined');
  if (!shouldSendEvalAsTextFile(output)) {
    await message.reply(output);
    return { mode: 'inline', characters: output.length };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `ocha-eval-output-${stamp}.txt`;
  await sock.sendMessage(
    message.chat,
    {
      document: Buffer.from(output, 'utf8'),
      mimetype: 'text/plain',
      fileName,
      caption: `Hasil JavaScript eval melebihi 30.000 karakter (${output.length.toLocaleString('id-ID')} karakter). Seluruh output disimpan tanpa pemotongan dalam file TXT.`,
    },
    { quoted: message.raw || message },
  );
  return { mode: 'text-file', characters: output.length, fileName };
}
