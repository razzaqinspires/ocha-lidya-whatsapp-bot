/**
 * Adaptive command UI is scoped to one plugin execution. It never modifies
 * the serializer globally and restores the original reply function afterward.
 */
export { withCommandButtons, buildAdaptiveButtonPlan, planButtonInventory, getHardButtonExemptions } from './adaptive-buttons.js';

export async function sendCommandList(_sock, message, { title, body }) {
  const heading = title ? `*${title}*\n\n` : '';
  return message.reply(`${heading}${body || ''}`.trim(), message, { linkPreview: false });
}
