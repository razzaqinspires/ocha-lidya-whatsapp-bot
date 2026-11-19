/**
 * Stable command-response transport. Text is the primary transport because
 * it is searchable/copyable and supported by every WhatsApp client. Interactive
 * messages are deliberately not injected into message.reply globally.
 */
export function withCommandButtons(_sock, message) {
  // Keep serializer's original m.reply implementation untouched.
  return message;
}

export async function sendCommandList(_sock, message, { title, body }) {
  const heading = title ? `*${title}*\n\n` : '';
  return message.reply(`${heading}${body || ''}`.trim(), message, { linkPreview: false });
}
