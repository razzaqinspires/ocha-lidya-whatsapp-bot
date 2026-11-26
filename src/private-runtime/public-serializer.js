import { extractMessageText, parseNativeFlowResponse } from '../lib/message-text.js';
import { registerReplySession } from '../core/reply-sessions.js';
import { buildContactMessage } from '../lib/contact-card.js';

const messageStore = new Map();
const sentMessageIds = new Set();
const jidPairs = new Map();
const MAX_MESSAGE_STORE = 5000;
let outgoingMessageObserver = null;

const normalizeJid = value => {
  if (typeof value !== 'string' || !value) return '';
  const clean = value.replace(/:\d+(?=@)/g, '');
  if (clean.includes('@')) return clean;
  if (/^\d{5,20}$/.test(clean)) return `${clean}@s.whatsapp.net`;
  return clean;
};

function resolveJid(value, key = {}, kind = 'chat') {
  const clean = normalizeJid(value);
  if (clean.endsWith('@lid')) {
    const candidates = kind === 'participant'
      ? [key.participantPn, key.senderPn, key.participantAlt, key.remoteJidPn, key.remoteJidAlt]
      : [key.remoteJidPn, key.remoteJidAlt];
    const candidate = candidates.map(normalizeJid).find(item => item.endsWith('@s.whatsapp.net'));
    if (candidate) jidPairs.set(clean, candidate);
  }
  return jidPairs.get(clean) || clean;
}

function contentType(message) {
  if (!message || typeof message !== 'object') return '';
  return Object.keys(message).find(key => !['messageContextInfo', 'senderKeyDistributionMessage', 'protocolMessage'].includes(key)) || '';
}

export function unwrapMessage(message) {
  let current = message;
  let type = contentType(current);
  let depth = 0;
  while (current && depth < 10) {
    depth += 1;
    const next = current?.[type]?.message;
    if (['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'futureProofMessage', 'documentWithCaptionMessage', 'deviceSentMessage', 'editedMessage'].includes(type) && next) {
      current = next;
      type = contentType(current);
      continue;
    }
    if (type === 'protocolMessage' && current.protocolMessage?.editedMessage) {
      current = current.protocolMessage.editedMessage;
      type = contentType(current);
      continue;
    }
    break;
  }
  return { message: current || null, type: type || '' };
}

function findContextInfo(root) {
  if (!root || typeof root !== 'object') return null;
  const queue = [{ value: root, depth: 0 }];
  const seen = new WeakSet();
  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 7) continue;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (key === 'contextInfo' && child && typeof child === 'object' && (child.quotedMessage || child.stanzaId || child.mentionedJid?.length)) return child;
      if (key !== 'quotedMessage' && child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 });
    }
  }
  return null;
}

function rememberMessage(message) {
  const id = message?.key?.id;
  if (!id) return;
  messageStore.set(id, message);
  if (message.key.remoteJid) messageStore.set(`${message.key.remoteJid}:${id}`, message);
  while (messageStore.size > MAX_MESSAGE_STORE * 2) messageStore.delete(messageStore.keys().next().value);
}

function getStoredMessage(id, chat) {
  return messageStore.get(`${chat || ''}:${id}`) || messageStore.get(id) || null;
}

function markSent(id) {
  if (!id) return;
  sentMessageIds.add(String(id));
  const timer = setTimeout(() => sentMessageIds.delete(String(id)), 120_000);
  timer.unref?.();
}

function mediaTypeFor(target) {
  const type = String(target?.type || '').replace(/Message$/, '').toLowerCase();
  if (type === 'ptv') return 'video';
  return type || 'image';
}

async function downloadMedia(target, sock, options = {}) {
  const payload = target?.msg || target?.message?.[target?.type] || target?.message || target;
  if (!payload || typeof payload !== 'object') throw new Error('No media payload found in message.');
  const { downloadContentFromMessage } = await import('@whiskeysockets/baileys');
  const stream = await downloadContentFromMessage(payload, mediaTypeFor(target), options);
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function summarizeInteractive(options = {}) {
  const lines = [options.title, options.subtitle, options.body].filter(value => typeof value === 'string' && value.trim());
  for (const button of Array.isArray(options.buttons) ? options.buttons : []) {
    const name = String(button?.name || '').toLowerCase();
    let params = {};
    try { params = typeof button.buttonParamsJson === 'string' ? JSON.parse(button.buttonParamsJson) : (button.buttonParamsJson || {}); } catch {}
    if (name === 'single_select') {
      for (const section of params.sections || []) {
        if (section.title) lines.push(`\n${section.title}`);
        for (const row of section.rows || []) {
          lines.push(`• ${row.title || row.id || 'Pilihan'}${row.description ? ` — ${row.description}` : ''}`);
          if (row.id) lines.push(`  Jalankan: ${row.id}`);
        }
      }
    } else if (name === 'quick_reply') {
      if (params.display_text) lines.push(`• ${params.display_text}${params.id ? ` — ${params.id}` : ''}`);
    } else if (name === 'cta_url') {
      if (params.display_text && params.url) lines.push(`• ${params.display_text}: ${params.url}`);
    } else if (params.display_text) {
      lines.push(`• ${params.display_text}`);
    }
  }
  if (options.footer) lines.push(`\n${options.footer}`);
  lines.push('\n[Mode publik: tombol interaktif tidak tersedia tanpa private runtime.]');
  return lines.join('\n');
}

class TextButtonBuilder {
  constructor(sock, kind = 'button') {
    this.sock = sock;
    this.kind = kind;
    this.data = { buttons: [], cards: [] };
  }
  setTitle(value) { this.data.title = value; return this; }
  setSubtitle(value) { this.data.subtitle = value; return this; }
  setBody(value) { this.data.body = value; return this; }
  setFooter(value) { this.data.footer = value; return this; }
  setImage(value) { this.data.image = value; return this; }
  addSelection(title = 'Pilih') { this.data.selectionTitle = title; return this; }
  makeSection(title = 'Pilihan') { this.data.section = title; return this; }
  makeRow(header, title, description, id) {
    this.data.buttons.push({ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: title, id, description, header }) });
    return this;
  }
  addReply(displayText, id) {
    this.data.buttons.push({ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: displayText, id }) });
    return this;
  }
  addCard(card) { this.data.cards.push(card); return this; }
  async send(jid, options = {}) {
    let text = this.kind === 'carousel' ? 'CAROUSEL (mode kompatibilitas publik)\n' : '';
    text += summarizeInteractive({ ...this.data, body: this.data.body || this.data.cards.map(card => {
      const first = Array.isArray(card) ? card[0] : card;
      return [first?.header?.title, first?.body?.text, first?.footer?.text].filter(Boolean).join('\n');
    }).filter(Boolean).join('\n\n') });
    return this.sock.sendMessage(jid, { text }, options);
  }
}

function unavailable(feature) {
  return async () => { throw new Error(`${feature} memerlukan @razzaqventures/ocha-private-runtime; pasang paket privat untuk mengaktifkannya.`); };
}

function createFakeReplyFallback(type = 'text', options = {}) {
  const text = String(options.text || options.caption || type || 'Quoted message');
  const remoteJid = normalizeJid(options.remoteJid || options.chat || 'status@broadcast');
  return {
    key: { remoteJid, fromMe: false, id: `PUBLIC-FALLBACK-${Date.now()}`, participant: options.participant },
    message: { conversation: text },
    sender: normalizeJid(options.sender || remoteJid),
    text,
    type: String(type || 'text')
  };
}

const fakeReplyApi = {
  createFakeReply: createFakeReplyFallback,
  createFakeContextInfo: (_type, options = {}) => ({ stanzaId: options.id || '', participant: options.participant || '' }),
  getAvailableTypes: () => [{ type: 'text', aliases: [] }]
};

function attachMessageMethods(sock, message) {
  const m = message;
  m.reply = async (text, quoted = m, options = {}) => {
    const quote = typeof quoted === 'string' ? createFakeReplyFallback('text', { text: quoted, remoteJid: m.chat }) : quoted;
    try {
      return await sock.sendMessage(m.chat, { text: String(text ?? ''), ...options }, { quoted: quote?.key ? quote : undefined });
    } catch (error) {
      if (/connection closed|websocket.*closed/i.test(String(error?.message || ''))) throw error;
      return sock.sendMessage(m.chat, { text: String(text ?? ''), ...options });
    }
  };
  m.replyWithSession = async (text, session = {}, quoted = m, options = {}) => {
    const sent = await m.reply(text, quoted, options);
    const messageId = sent?.key?.id || sent?.messageId;
    if (!messageId) throw new Error('WhatsApp did not return a message ID; reply session cannot be registered.');
    registerReplySession({ chat: m.chat, sender: m.sender, messageId, ...session });
    return sent;
  };
  m.sendContact = async ({ number, displayName, organization = '' } = {}, options = {}) => {
    if (!m.chat || m.chat.endsWith('@lid')) throw new Error('Chat JID is unresolved; contact delivery was cancelled.');
    return sock.sendMessage(m.chat, buildContactMessage({ number, displayName, organization }), options);
  };
  m.react = emoji => sock.sendMessage(m.chat, { react: { text: String(emoji || ''), key: m.key } });
  m.delete = (key = m.key) => sock.sendMessage(m.chat, { delete: key });
  m.sendInteractive = data => sock.sendInteractive(m.chat, data, m);
  m.sendRichMessage = (items, options = {}) => sock.sendRichMessage(m.chat, items, m, options);
  m.sendLink = (text, links, options = {}) => sock.sendLink(m.chat, text, links, m, options);
  m.sendLinkV2 = m.sendLink;
  m.sendTable = (title, headers, rows, options = {}) => sock.sendTable(m.chat, title, headers, rows, m, options);
  m.sendTableV2 = (table, options = {}) => sock.sendTableV2(m.chat, table, m, options);
  m.sendCodeBlock = (code, options = {}) => sock.sendCodeBlock(m.chat, code, m, options);
  m.sendCodeBlockV2 = m.sendCodeBlock;
  m.sendList = (title, items, options = {}) => sock.sendList(m.chat, title, items, m, options);
  m.freply = async (text, type = 'text', options = {}) => m.reply(text, createFakeReplyFallback(type, { ...options, text, remoteJid: m.chat }), options);
  m.replyFake = m.freply;
  m.getFake = (type, options = {}) => createFakeReplyFallback(type, { ...options, remoteJid: m.chat });
  m.createFake = m.getFake;
  m.fake = fakeReplyApi;
  m.download = unavailable('Media download');
  if (m.type && /^(?:image|video|audio|document|sticker|ptv)Message$/i.test(m.type)) {
    m.download = options => downloadMedia(m, sock, options);
  }
  m.call = unavailable('WhatsApp call control');
  m.makeCall = m.call;
  m.callMusic = unavailable('Call music');
  m.answerCall = unavailable('Call music');
  m.skipCall = unavailable('Call music');
  m.getCallQueue = () => ({ active: null, queued: [], total: 0 });
  m.stopCall = async () => false;
  m.rejectCall = unavailable('WhatsApp call control');
  m.acceptCall = unavailable('WhatsApp call control');
  m.terminateCall = unavailable('WhatsApp call control');
  m.createCallLink = unavailable('WhatsApp call control');
  m.sendCallLog = async title => m.reply(String(title || 'Call log is unavailable in public compatibility mode.'));
  m.airich = unavailable('AIRich builder');
  m.rich = m.airich;
  return m;
}

export function serializePublicMessage(sock, rawMessage) {
  if (!rawMessage?.key) return rawMessage;
  rememberMessage(rawMessage);
  const m = rawMessage;
  const key = m.key;
  const rawChat = normalizeJid(key.remoteJid || '');
  const chatPn = [key.remoteJidPn, key.remoteJidAlt].map(normalizeJid).find(value => value.endsWith('@s.whatsapp.net'));
  if (rawChat.endsWith('@lid') && chatPn) jidPairs.set(rawChat, chatPn);
  const participant = normalizeJid(key.participant || rawChat);
  const participantPn = [key.participantPn, key.participantAlt, key.senderPn].map(normalizeJid).find(value => value.endsWith('@s.whatsapp.net'));
  if (participant.endsWith('@lid') && participantPn) jidPairs.set(participant, participantPn);

  const botJid = normalizeJid(sock.user?.id || sock.authState?.creds?.me?.id || '');
  m.id = key.id || '';
  m.fromMe = Boolean(key.fromMe) || Boolean(botJid && resolveJid(participant, key, 'participant') === resolveJid(botJid));
  m.isBaileys = sentMessageIds.has(m.id);
  m.chat = resolveJid(rawChat, key, 'chat');
  m.isGroup = m.chat.endsWith('@g.us');
  m.sender = m.fromMe ? botJid || resolveJid(participant, key, 'participant') : resolveJid(participant, key, 'participant');
  m.pushName = m.pushName || 'Users';
  m.remoteJid = key.remoteJid || '';
  m.remoteJidAlt = key.remoteJidAlt || '';
  m.remoteJidPn = key.remoteJidPn || '';
  m.participant = key.participant || '';
  m.participantAlt = key.participantAlt || '';
  m.participantPn = key.participantPn || '';
  m.senderPn = key.senderPn || '';
  m.addressingMode = key.addressingMode || '';
  m.identity = {
    chat: { jid: m.remoteJid, jidAlt: m.remoteJidAlt, jidPn: m.remoteJidPn || chatPn || '', normalizedJid: m.chat, addressingMode: m.addressingMode, isGroup: m.isGroup, isBroadcast: m.remoteJid.endsWith('@broadcast') },
    sender: { jid: m.participant || m.remoteJid, jidAlt: m.isGroup ? m.participantAlt : m.remoteJidAlt, jidPn: m.isGroup ? (m.participantPn || m.senderPn) : (m.senderPn || chatPn || ''), normalizedJid: m.sender, pushName: m.pushName, isFromMe: m.fromMe, isGroupParticipant: m.isGroup && Boolean(m.participant) },
    bot: { jid: botJid, normalizedJid: botJid, lid: sock.user?.lid || sock.authState?.creds?.me?.lid || '' },
    message: { id: m.id, timestamp: m.messageTimestamp || null, type: '', fromMe: m.fromMe, isGroup: m.isGroup, addressingMode: m.addressingMode }
  };

  const unwrapped = unwrapMessage(m.message);
  m.message = unwrapped.message;
  m.type = unwrapped.type;
  m.msg = m.type ? (m.message?.[m.type] || m.message) : null;
  m.body = m.message ? extractMessageText(m.message, m.type) : '';
  m.interactiveResponse = m.type === 'interactiveResponseMessage' ? parseNativeFlowResponse(m.message) : null;
  m.nativeFlowResponse = m.interactiveResponse;
  if (m.interactiveResponse) {
    m.buttonName = m.interactiveResponse.name || '';
    m.buttonId = m.interactiveResponse.selectedId || m.body;
    m.selectedRowId = m.interactiveResponse.selectedRowId || '';
    m.selectedButtonId = m.buttonId;
    if (m.buttonId) m.body = m.buttonId;
  } else if (['templateButtonReplyMessage', 'buttonsResponseMessage', 'listResponseMessage'].includes(m.type)) {
    m.buttonId = m.body;
    m.selectedButtonId = m.body;
    m.selectedRowId = m.type === 'listResponseMessage' ? (m.msg?.singleSelectReply?.selectedRowId || '') : '';
  }
  m.identity.message.type = m.type;
  m.mentionedJid = [];
  const contextInfo = findContextInfo(m.message) || findContextInfo(rawMessage.message);
  if (contextInfo) m.mentionedJid = Array.isArray(contextInfo.mentionedJid) ? contextInfo.mentionedJid : [];
  m.quoted = null;
  if (contextInfo?.quotedMessage) {
    const quoted = unwrapMessage(contextInfo.quotedMessage);
    const quotedPayload = quoted.message?.[quoted.type] || quoted.message;
    if (quotedPayload) {
      const quotedKey = { remoteJid: m.chat, id: contextInfo.stanzaId || '', participant: contextInfo.participant || undefined, fromMe: false };
      const stored = getStoredMessage(quotedKey.id, m.chat);
      if (stored) quotedKey.fromMe = Boolean(stored.key?.fromMe);
      m.quoted = {
        id: quotedKey.id,
        key: quotedKey,
        message: quoted.message,
        type: quoted.type,
        msg: quotedPayload,
        mimetype: quotedPayload?.mimetype || '',
        sender: normalizeJid(contextInfo.participant || m.chat),
        text: extractMessageText(quoted.message, quoted.type) || quotedPayload?.caption || quotedPayload?.text || '',
        delete: () => sock.sendMessage(m.chat, { delete: quotedKey }),
        download: options => downloadMedia({ key: quotedKey, type: quoted.type, msg: quotedPayload }, sock, options)
      };
    }
  }
  return attachMessageMethods(sock, m);
}

export function createPublicSerializer() {
  function extendSocket(sock) {
    if (!sock || sock.__ochaPublicCompatibilityExtended) return sock;
    Object.defineProperty(sock, '__ochaPublicCompatibilityExtended', { value: true, configurable: true });
    if (typeof sock.decodeJid !== 'function') sock.decodeJid = normalizeJid;
    const originalSendMessage = typeof sock.sendMessage === 'function' ? sock.sendMessage.bind(sock) : null;
    if (originalSendMessage) {
      sock.sendMessage = async (jid, content, options = {}) => {
        if (options?.messageId) markSent(options.messageId);
        const result = await originalSendMessage(jid, content, options);
        if (result?.key?.id) {
          markSent(result.key.id);
          try { outgoingMessageObserver?.(result.key, options?.quoted?.key || null); } catch {}
        }
        return result;
      };
    }
    const originalRelay = typeof sock.relayMessage === 'function' ? sock.relayMessage.bind(sock) : null;
    if (originalRelay) {
      sock.relayMessage = async (jid, message, options = {}) => {
        const sourceKey = options?.sourceKey || options?.quoted?.key || null;
        const cleanOptions = { ...options };
        delete cleanOptions.sourceKey;
        delete cleanOptions.quoted;
        const result = await originalRelay(jid, message, cleanOptions);
        if (typeof result === 'string') {
          markSent(result);
          try { outgoingMessageObserver?.({ remoteJid: jid, id: result, fromMe: true }, sourceKey); } catch {}
        } else if (result?.key?.id) {
          markSent(result.key.id);
          try { outgoingMessageObserver?.(result.key, sourceKey); } catch {}
        }
        return result;
      };
    }

    sock.sendInteractive = async (jid, options = {}, quoted = null) => sock.sendMessage(resolveJid(jid), { text: summarizeInteractive(options) }, { quoted: quoted?.key ? quoted : undefined });
    sock.sendNativeFlow = (jid, options = {}, quoted = null) => sock.sendInteractive(jid, options, quoted);
    sock.getNativeFlowCapabilities = async () => [];
    sock.buttonBuilder = () => new TextButtonBuilder(sock, 'button');
    sock.ButtonBuilder = sock.buttonBuilder;
    sock.buttonV2Builder = sock.buttonBuilder;
    sock.carouselBuilder = () => new TextButtonBuilder(sock, 'carousel');
    sock.captureUnifiedResponse = value => ({ text: String(value || '') });
    sock.richMessage = sock.airich = sock.Rich = () => ({ send: async (jid, text, options) => sock.sendMessage(jid, { text: String(text || '') }, options) });
    sock.sendRichMessage = async (jid, items, quoted = null) => {
      const lines = (Array.isArray(items) ? items : [items]).map(item => item?.messageText || item?.text || '').filter(Boolean);
      return sock.sendMessage(jid, { text: lines.join('\n') || 'Rich message tidak tersedia dalam mode publik.' }, { quoted: quoted?.key ? quoted : undefined });
    };
    sock.sendTable = async (jid, title, headers, rows, quoted = null) => sock.sendMessage(jid, { text: [title, headers?.join(' | '), ...(rows || []).map(row => Array.isArray(row) ? row.join(' | ') : String(row))].filter(Boolean).join('\n') }, { quoted: quoted?.key ? quoted : undefined });
    sock.sendTableV2 = async (jid, table, quoted = null) => sock.sendMessage(jid, { text: JSON.stringify(table, null, 2).slice(0, 6000) }, { quoted: quoted?.key ? quoted : undefined });
    sock.sendList = async (jid, title, items, quoted = null) => sock.sendMessage(jid, { text: [title, ...(items || []).map(item => typeof item === 'string' ? item : `• ${item?.title || item?.text || JSON.stringify(item)}`)].join('\n') }, { quoted: quoted?.key ? quoted : undefined });
    sock.sendCodeBlock = sock.sendCodeBlockV2 = async (jid, code, quoted = null) => sock.sendMessage(jid, { text: `\`\`\`\n${String(code || '').slice(0, 6000)}\n\`\`\`` }, { quoted: quoted?.key ? quoted : undefined });
    sock.sendLink = sock.sendLinkV2 = async (jid, text, links, quoted = null) => sock.sendMessage(jid, { text: `${text || ''}\n${(links || []).map(item => typeof item === 'string' ? item : item?.url || '').filter(Boolean).join('\n')}`.trim() }, { quoted: quoted?.key ? quoted : undefined });
    sock.sendLatex = async jid => sock.sendMessage(jid, { text: 'LaTeX rendering requires the private runtime.' });
    sock.sendUnifiedResponse = async jid => sock.sendMessage(jid, { text: 'Unified rich response requires the private runtime.' });
    sock.sendFakeReply = async (jid, text) => sock.sendMessage(jid, { text: String(text || '') });
    sock.createFakeReply = createFakeReplyFallback;
    sock.freply = fakeReplyApi;
    sock.offerCall = sock.makeCall = unavailable('WhatsApp call control');
    sock.createCallLink = unavailable('WhatsApp call control');
    sock.rejectCall = sock.acceptCall = sock.terminateCall = unavailable('WhatsApp call control');
    sock.sendCallLog = async (jid, title = 'Voice Call') => sock.sendMessage(jid, { text: `Call log: ${title}` });
    sock.playCallMusic = unavailable('Call music');
    sock.answerCallMusic = async () => false;
    sock.skipCall = async () => ({ skipped: false });
    sock.stopCall = async () => false;
    sock.getCallQueue = () => ({ active: null, queued: [], total: 0 });
    sock.getActiveCallSessions = () => [];
    sock.handleIncomingCall = async () => undefined;
    sock.handleCall = sock.handleIncomingCall;
    sock.serializeCall = call => ({ ...call, from: normalizeJid(call?.from || call?.chatId || '') });
    return sock;
  }

  return {
    toJid: normalizeJid,
    serialize: serializePublicMessage,
    serializeCall: (sock, call) => ({ ...call, from: normalizeJid(call?.from || call?.chatId || '') }),
    extendSocket,
    unwrapMessage,
    downloadMedia,
    storeMessage: rememberMessage,
    getStoredMessage,
    registerJidPair: (lid, phone) => { if (String(lid || '').endsWith('@lid') && String(phone || '').endsWith('@s.whatsapp.net')) jidPairs.set(normalizeJid(lid), normalizeJid(phone)); },
    syncBotJidPairs: () => undefined,
    getBotIdentifiers: sock => new Set([normalizeJid(sock?.user?.id), normalizeJid(sock?.authState?.creds?.me?.id)].filter(Boolean)),
    trackSentMessageId: markSent,
    setOutgoingMessageObserver: observer => { outgoingMessageObserver = typeof observer === 'function' ? observer : null; },
    isBotSentMessage: id => sentMessageIds.has(String(id || '')),
    freply: fakeReplyApi,
    createFakeReply: createFakeReplyFallback,
    compatibilityMode: true,
    unavailableFeatures: ['native_flow', 'rich_message', 'historical_fake_reply', 'call_control', 'call_music']
  };
}
