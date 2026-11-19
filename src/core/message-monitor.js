import { logger } from './logger.js';
import { getGroupMetadata } from './group-metadata.js';

const MAX_TRACKED = 5000;
const MAX_PENDING = 1500;
const TTL_MS = 24 * 60 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;
let colorMode = 'auto';
const outgoing = new Map();
const incoming = new Map();
const pendingStatus = new Map();

const ANSI = {
  reset: '\u001b[0m', dim: '\u001b[2m', cyan: '\u001b[36m', blue: '\u001b[94m',
  green: '\u001b[32m', magenta: '\u001b[35m', yellow: '\u001b[33m', red: '\u001b[31m'
};
const canColor = () => colorMode === 'always' || (colorMode === 'auto' && Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);
const paint = (value, color) => canColor() ? `${color}${value}${ANSI.reset}` : String(value);
const token = key => key?.id && key?.remoteJid ? `${key.remoteJid}\u001f${key.id}` : '';
const now = () => Date.now();

function prune(map, max, ttl) {
  const cutoff = now() - ttl;
  for (const [key, value] of map) {
    if (value.updatedAt < cutoff || map.size > max) map.delete(key);
    else if (map.size <= max) break;
  }
}

function compactId(id) { return String(id || '').slice(-8) || '--------'; }
function chatType(key) { return key?.remoteJid?.endsWith('@g.us') ? 'GROUP' : 'PRIVATE'; }
function chatLabel(key) {
  const jid = String(key?.remoteJid || 'unknown');
  if (jid.endsWith('@g.us')) return `group:${jid.slice(0, 9)}…`;
  const number = jid.split('@')[0].split(':')[0];
  return `private:…${number.slice(-4)}`;
}
function stamp() {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(new Date()) + ' WIB';
}
export function configureMessageMonitor(options = {}) {
  if (['auto', 'always', 'never'].includes(options.color)) colorMode = options.color;
}

function output(level, label, key, messageId, statusText, color, extra = '') {
  const channel = chatType(key);
  const line = [
    paint(`[${stamp()}]`, ANSI.dim),
    paint(`[OCHA FLOW]`, ANSI.cyan),
    paint(`[${channel}]`, channel === 'GROUP' ? ANSI.yellow : ANSI.blue),
    chatLabel(key),
    `#${compactId(messageId)}`,
    paint(statusText, color),
    label,
    extra
  ].filter(Boolean).join(' ');
  const stream = level === 'error' ? process.stderr : process.stdout;
  try { stream.write(`${line}\n`); } catch (error) { logger.debug({ err: error }, 'Message monitor output unavailable'); }
}

function tickState(record) {
  const status = record.status || 0;
  if (status >= 4) return { text: '✓✓ PLAYED', color: ANSI.magenta };
  if (status >= 3 || record.readCount > 0) return { text: '✓✓ READ', color: ANSI.blue };
  if (status >= 2 || record.deliveredCount > 0) return { text: '✓✓ DELIVERED', color: ANSI.green };
  if (status >= 1 || record.sent) return { text: '✓ SENT', color: ANSI.dim };
  return { text: '… PENDING', color: ANSI.yellow };
}

function renderOutgoing(record, reason = 'status') {
  const tick = tickState(record);
  const replyTag = record.botReply ? paint('BOT REPLIED', ANSI.magenta) : '';
  const groupCounts = record.isGroup
    ? `delivered ${record.deliveredCount || 0}/${record.participantCount || '?'} · read ${record.readCount || 0}/${record.participantCount || '?'}`
    : '';
  output('info', `${reason}${replyTag ? ` · ${replyTag}` : ''}`, record.key, record.key.id, tick.text, tick.color, groupCounts);
}

export function observeIncomingMessage(message) {
  const messageKey = token(message?.key);
  if (!messageKey) return null;
  prune(incoming, MAX_TRACKED, TTL_MS);
  const record = {
    key: message.key,
    sender: message.sender || message.key.participant || message.chat,
    chatType: chatType(message.key),
    botReplied: false,
    updatedAt: now()
  };
  incoming.set(messageKey, record);
  output('info', `INBOUND ${String(message.pushName || 'contact').slice(0, 32)}`, message.key, message.key.id, 'MESSAGE', ANSI.cyan);
  return record;
}

function registerOutgoing(key, sourceKey) {
  const id = token(key);
  if (!id) return;
  prune(outgoing, MAX_TRACKED, TTL_MS);
  const source = incoming.get(token(sourceKey));
  const record = {
    key,
    sent: true,
    status: 1,
    isGroup: chatType(key) === 'GROUP',
    botReply: Boolean(source),
    participantReceipts: new Map(),
    deliveredCount: 0,
    readCount: 0,
    participantCount: undefined,
    updatedAt: now()
  };
  outgoing.set(id, record);
  if (source) {
    source.botReplied = true;
    source.replyMessageId = key.id;
    source.updatedAt = now();
    const tick = tickState(record);
    output('info', 'OUT · BOT REPLIED', key, key.id, tick.text, ANSI.magenta, `source #${compactId(source.key.id)}`);
  } else {
    renderOutgoing(record, 'OUT');
  }
  const pending = pendingStatus.get(id);
  if (pending) {
    for (const update of pending.updates) applyStatus(record, update);
    pendingStatus.delete(id);
    renderOutgoing(record, 'ACK replay');
  }
}

export function observeOutgoingMessage(key, sourceKey = null) {
  registerOutgoing(key, sourceKey);
}

function applyStatus(record, update) {
  const status = Number(update?.status);
  if (Number.isFinite(status)) record.status = Math.max(record.status || 0, status);
  record.updatedAt = now();
}

export function observeMessageUpdates(updates = []) {
  for (const item of updates) {
    const id = token(item?.key);
    if (!id || item?.key?.fromMe === false) continue;
    const record = outgoing.get(id);
    if (record) {
      applyStatus(record, item.update);
      renderOutgoing(record, 'ACK UPDATE');
      continue;
    }
    prune(pendingStatus, MAX_PENDING, PENDING_TTL_MS);
    const pending = pendingStatus.get(id) || { updates: [], updatedAt: now() };
    pending.updates.push(item.update || {});
    pending.updatedAt = now();
    pendingStatus.set(id, pending);
  }
}

export function observeGroupReceipts(receipts = []) {
  for (const item of receipts) {
    const id = token(item?.key);
    if (!id) continue;
    const record = outgoing.get(id);
    if (!record) continue;
    const receipt = item.receipt || {};
    const participant = String(receipt.userJid || 'unknown');
    const previous = record.participantReceipts.get(participant) || {};
    const hasTimestamp = value => value !== undefined && value !== null && Number(value) > 0;
    record.participantReceipts.set(participant, {
      delivered: Boolean(previous.delivered || hasTimestamp(receipt.receiptTimestamp)),
      read: Boolean(previous.read || hasTimestamp(receipt.readTimestamp)),
      played: Boolean(previous.played || hasTimestamp(receipt.playedTimestamp))
    });
    const values = [...record.participantReceipts.values()];
    const groupMeta = getGroupMetadata(item.key.remoteJid);
    if (groupMeta?.participants?.length) record.participantCount = Math.max(1, groupMeta.participants.length - 1);
    record.deliveredCount = values.filter(value => value.delivered || value.read || value.played).length;
    record.readCount = values.filter(value => value.read || value.played).length;
    record.updatedAt = now();
    renderOutgoing(record, 'GROUP RECEIPT');
  }
}

export function getMessageMonitorStats() {
  return {
    trackedOutgoing: outgoing.size,
    trackedIncoming: incoming.size,
    pendingReceipts: pendingStatus.size,
    capacity: MAX_TRACKED
  };
}

export function getMessageFlowState(key) {
  const record = outgoing.get(token(key));
  if (!record) return null;
  return {
    status: record.status || 0,
    botReply: Boolean(record.botReply),
    deliveredCount: record.deliveredCount || 0,
    readCount: record.readCount || 0,
    participantCount: record.participantCount ?? null,
    isGroup: Boolean(record.isGroup)
  };
}
