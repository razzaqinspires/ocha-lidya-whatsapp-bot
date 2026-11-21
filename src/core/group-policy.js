import { getGroupInteractionState } from './group-control.js';

/**
 * Response gate only. This function must never be used to gate Baileys events,
 * group metadata hydration, or verified contact indexing.
 */
export function shouldSuppressGroupInteraction(message, config) {
  if (!message?.isGroup) return false;
  return getGroupInteractionState(message.chat || message.key?.remoteJid, config).muted;
}
