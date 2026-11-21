import { getGroupInteractionState } from './group-control.js';
import { parseCommand } from './prefix.js';

/**
 * Response gate only. This function must never be used to gate Baileys events,
 * group metadata hydration, or verified contact indexing.
 */
export function shouldSuppressGroupInteraction(message, config) {
  if (!message?.isGroup) return false;
  return getGroupInteractionState(message.chat || message.key?.remoteJid, config).muted;
}

/** Only a verified owner may pass the muted-group gate to execute mute control. */
export function isOwnerMuteControlMessage(message, ownerVerified) {
  if (!ownerVerified || !message?.isGroup) return false;
  const parsed = parseCommand(message.body || '');
  return Boolean(parsed && ['mute', 'groupmute'].includes(parsed.command));
}
