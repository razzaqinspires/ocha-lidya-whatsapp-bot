import { parseCommand } from './prefix.js';
import { getPlugin } from './plugin-loader.js';
import { authorize } from './permissions.js';
import { runMasterCommand, isMasterSyntax } from '../master/dispatcher.js';
import { getConfig } from './config.js';
import { logger } from './logger.js';
import { getPrefixes } from './prefix.js';
import { answerMessage, isAITrigger } from '../ai/engine.js';

export async function dispatch(sock, message) {
  const config = getConfig();
  if (message.fromMe && !message.isOwner) return;
  const body = String(message.body || '').trim();
  if (!body) return;
  if (isMasterSyntax(body)) {
    if (!message.isOwner) return;
    if (message.isGroup && !config.security.allowMasterInGroups) return message.reply('Master console dinonaktifkan di grup.');
    return runMasterCommand(sock, message, body);
  }
  const prefixes = getPrefixes();
  const hasPrefix = prefixes.some(prefix => body.startsWith(prefix));
  const parsed = parseCommand(body);
  const plugin = parsed ? getPlugin(parsed.command) : null;

  if (plugin) {
    const auth = authorize(message, plugin);
    if (!auth.ok) return;
    try {
      await plugin.execute({ sock, m:message, args:parsed.args, text:parsed.text, command:parsed.command, config, isOwner:auth.owner });
    } catch (error) {
      logger.error({err:error,plugin:plugin.name,chat:message.chat}, 'Plugin execution error');
      await message.reply(`Terjadi kesalahan saat menjalankan ${plugin.name}.\n${error.message || error}`);
    }
    return;
  }

  // A prefixed message is always command intent. Unknown commands must never fall through to AI.
  if (hasPrefix) return;
  // In prefix mode "none", parseCommand treats all text as a command; unknown natural language falls through to AI.
  if (isAITrigger(sock, message, { prefixed: false, hasKnownCommand: false })) {
    await answerMessage(sock, message);
  }
}
