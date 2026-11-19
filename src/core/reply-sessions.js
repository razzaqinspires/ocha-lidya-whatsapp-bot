const sessions = new Map();
const DEFAULT_TTL_MS = 10 * 60_000;
const MAX_SESSIONS = 5000;

function sessionKey(chat, messageId) {
  return `${String(chat || '')}::${String(messageId || '')}`;
}

function normalizeChoices(choices = []) {
  if (!Array.isArray(choices)) throw new TypeError('Reply-session choices must be an array.');
  const map = new Map();
  for (const choice of choices) {
    if (!choice || choice.key === undefined || typeof choice.key === 'object') continue;
    const key = String(choice.key).trim();
    if (!key || map.has(key)) continue;
    map.set(key, { label: String(choice.label || key), value: choice.value });
  }
  return map;
}

export function registerReplySession({
  chat,
  messageId,
  sender,
  kind = 'command',
  choices = [],
  onSelect,
  helpText = 'Balas dengan salah satu nomor/opsi yang tersedia pada pesan tersebut.',
  ttlMs = DEFAULT_TTL_MS,
  metadata = {}
} = {}) {
  if (!chat || !messageId || !sender) throw new Error('Reply session requires chat, messageId, and sender.');
  if (typeof onSelect !== 'function') throw new TypeError('Reply session requires an onSelect handler.');
  const key = sessionKey(chat, messageId);
  const createdAt = Date.now();
  sessions.delete(key);
  sessions.set(key, {
    chat: String(chat),
    messageId: String(messageId),
    sender: String(sender),
    kind: String(kind),
    choices: normalizeChoices(choices),
    onSelect,
    helpText: String(helpText),
    createdAt,
    expiresAt: createdAt + Math.max(1000, Math.min(24 * 60 * 60_000, Number(ttlMs) || DEFAULT_TTL_MS)),
    metadata
  });
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  return { key, expiresAt: sessions.get(key).expiresAt };
}

/**
 * Routes a reply to a registered command screen before the AI trigger is tested.
 * A screen is bound to the sender who opened it, preventing group participants
 * from selecting or hijacking another user's private command session.
 */
export async function dispatchReplySession(sock, message) {
  const quotedId = message?.quoted?.key?.id;
  if (!quotedId || !message?.chat) return { matched: false };
  const key = sessionKey(message.chat, quotedId);
  const session = sessions.get(key);
  if (!session) return { matched: false };

  if (session.expiresAt <= Date.now()) {
    sessions.delete(key);
    return { matched: false, expired: true };
  }

  if (session.sender !== String(message.sender || '')) {
    await message.reply('Sesi pilihan ini dibuat oleh pengguna lain. Jalankan kembali command untuk membuat sesi sendiri.');
    return { matched: true, unauthorized: true };
  }

  const input = String(message.body || '').trim();
  const choice = session.choices.get(input);
  if (!choice) {
    await message.reply(session.helpText);
    return { matched: true, invalidChoice: true, kind: session.kind };
  }

  // Consume before invoking the handler: duplicate incoming events cannot run
  // the same selection twice. A next-page handler creates a fresh session.
  sessions.delete(key);
  await session.onSelect({ sock, message, key: input, label: choice.label, value: choice.value, session });
  return { matched: true, selected: true, kind: session.kind };
}

export function getReplySessionStats() {
  const now = Date.now();
  let expired = 0;
  for (const [key, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(key);
      expired++;
    }
  }
  return { active: sessions.size, expiredRemoved: expired };
}

export function clearReplySessions() {
  sessions.clear();
}
