import { registerAICapability } from '../capability-manager.js';
import { getConfig } from '../../core/config.js';
import { createWebsiteSession, updateWebsiteSession } from '../../runtime/code-lab.js';

registerAICapability({
  name: 'website_builder',
  label: 'Nexora Website Builder',
  description: 'Generate a bounded multi-file static website project and publish it through the shared temporary preview gateway.',
  isEnabled: () => {
    const config = getConfig();
    const lab = config.codeLab || {};
    return Boolean(config.ai.enabled && lab.enabled && lab.websiteBuilderEnabled && lab.aiExecutionEnabled && lab.publicTunnelEnabled);
  },
  execute: async ({ title, summary, files, existingSessionId }, { message }) => {
    const input = { ownerId: message.sender, chatId: message.chat, title, summary, files };
    return existingSessionId
      ? updateWebsiteSession({ ...input, sessionId: existingSessionId })
      : createWebsiteSession(input);
  }
});
