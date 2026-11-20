import { getConfig } from './config.js';
import { isVerifiedOwnerMessage } from './identity.js';

export function authorize(message, command = {}) {
  const config = getConfig();
  const owner = isVerifiedOwnerMessage(message, config.bot.owner);
  if (command.ownerOnly && !owner) return { ok: false, reason: 'owner' };
  if (config.mode === 'self' && !owner) return { ok: false, reason: 'self' };
  if (command.groupOnly && !message.isGroup) return { ok: false, reason: 'group' };
  if (command.privateOnly && message.isGroup) return { ok: false, reason: 'private' };
  return { ok: true, owner };
}
