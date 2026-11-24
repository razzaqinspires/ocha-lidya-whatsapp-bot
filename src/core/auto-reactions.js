import { parseCommand } from './prefix.js';
import { isAITrigger } from '../ai/engine.js';
import { getConfig } from './config.js';
import { logger } from './logger.js';

/** Classify only messages that will enter a real command or AI dispatch lane. */
export function classifyReactionTarget(sock, message) {
  const body = String(message?.body || '').trim();
  if (!body || !message?.key?.id) return null;

  const parsed = parseCommand(body);
  if (parsed) return 'command';
  if (isAITrigger(sock, message, { prefixed: false, hasKnownCommand: false })) return 'ai';
  return null;
}

async function sendReaction(sock, message, emoji, phase) {
  if (!emoji || !message?.key?.id || !message?.chat) return false;
  try {
    await sock.sendMessage(message.chat, {
      react: { text: emoji, key: message.key }
    });
    return true;
  } catch (error) {
    logger.debug({ err: error, messageId: message.id || message.key?.id, phase }, 'Automatic message reaction could not be sent');
    return false;
  }
}

/**
 * Wrap one dispatch with a pending reaction and a final success/failure mark.
 * This wrapper never changes the dispatcher result and never blocks bot startup.
 */
export async function dispatchWithAutoReaction(sock, message, dispatch, mode = 'command', configOverride = null) {
  const config = configOverride || getConfig();
  const policy = config.ui?.autoReactions || {};
  if (!policy.enabled || !['command', 'ai'].includes(mode)) return dispatch();

  const pendingEmoji = mode === 'ai'
    ? (policy.thinkingEmoji || '💭')
    : (policy.commandEmoji || '⏳');
  await sendReaction(sock, message, pendingEmoji, 'pending');

  try {
    const result = await dispatch();
    const denied = result === undefined || result === null
      || result?.allowed === false
      || result?.reason === 'plugin_error'
      || result?.success === false
      || result?.result?.success === false
      || Boolean(result?.error);
    await sendReaction(sock, message, denied ? (policy.failureEmoji || '❌') : (policy.successEmoji || '✅'), denied ? 'failure' : 'success');
    return result;
  } catch (error) {
    await sendReaction(sock, message, policy.failureEmoji || '❌', 'failure');
    throw error;
  }
}
