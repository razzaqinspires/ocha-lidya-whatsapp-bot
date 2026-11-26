import { loadPrivateRuntime, getPrivateRuntimeStatus } from './loader.js';
import { createPublicSerializer } from './public-serializer.js';

let adapterPromise;
export function loadSerializerAdapter() {
  if (!adapterPromise) {
    adapterPromise = (async () => {
      const runtime = await loadPrivateRuntime();
      return runtime?.serializer || createPublicSerializer();
    })();
  }
  return adapterPromise;
}

export async function loadHelperAdapter() {
  const runtime = await loadPrivateRuntime();
  if (runtime?.helpers) return runtime.helpers;
  class PublicFallbackBuilder {
    constructor(sock) { this.sock = sock; this.lines = []; }
    setTitle(value) { this.lines.push(String(value)); return this; }
    setBody(value) { this.lines.push(String(value)); return this; }
    setFooter(value) { this.lines.push(String(value)); return this; }
    addText(value) { this.lines.push(String(value)); return this; }
    async send(jid, options = {}) { return this.sock.sendMessage(jid, { text: this.lines.join('\n') }, options); }
  }
  class AIRich extends PublicFallbackBuilder {}
  const tokenizeCode = value => String(value || '').split('\n').map(codeContent => ({ highlightType: 0, codeContent }));
  const tokenizeCodeV2 = value => {
    const codeBlock = tokenizeCode(value);
    return { codeBlock, unified_codeBlock: codeBlock.map(item => ({ text: item.codeContent, type: 'DEFAULT' })) };
  };
  return {
    AIRich,
    Rich: AIRich,
    ButtonBuilder: PublicFallbackBuilder,
    Button: PublicFallbackBuilder,
    ButtonV2: PublicFallbackBuilder,
    Carousel: PublicFallbackBuilder,
    tokenizeCode,
    tokenizeCodeV2,
    compatibilityMode: true
  };
}

export async function loadFakeReplyAdapter() {
  const runtime = await loadPrivateRuntime();
  if (runtime?.freply) return runtime.freply;
  const createFakeReply = (type = 'text', options = {}) => {
    const text = String(options.text || options.caption || type || 'Quoted message');
    const remoteJid = String(options.remoteJid || options.chat || 'status@broadcast');
    return { key: { remoteJid, id: `PUBLIC-FALLBACK-${Date.now()}`, fromMe: false }, message: { conversation: text }, text, type };
  };
  return { createFakeReply, createFakeContextInfo: () => ({}), getAvailableTypes: () => [{ type: 'text', aliases: [] }], compatibilityMode: true };
}

export { getPrivateRuntimeStatus };
