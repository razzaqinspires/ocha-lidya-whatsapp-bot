import { registerAICapability } from '../capability-manager.js';
import { getConfig } from '../../core/config.js';
import { createCodeSession } from '../../runtime/code-lab.js';

registerAICapability({
  name: 'code_execution',
  label: 'Isolated Code Runner',
  description: 'Run Python/Node code in a resource-limited container and publish a temporary preview.',
  isEnabled: () => {
    const config = getConfig().codeLab || {};
    return Boolean(getConfig().ai.enabled && config.enabled && config.aiExecutionEnabled && config.publicTunnelEnabled);
  },
  execute: async ({ language, source }, { message }) => createCodeSession({
    ownerId: message.sender,
    chatId: message.chat,
    language,
    source
  })
});
