const PN_SUFFIX = '@s.whatsapp.net';
const LID_SUFFIX = '@lid';

function normalizeJid(value) {
  if (typeof value !== 'string' || !value) return '';
  return value.replace(/:\d+(?=@)/, '');
}

function isPn(value) { return normalizeJid(value).endsWith(PN_SUFFIX); }
function isLid(value) { return normalizeJid(value).endsWith(LID_SUFFIX); }

function candidatesForKey(key = {}, isGroup = false) {
  const ordered = isGroup
    ? [key.senderPn, key.participantPn, key.participantAlt, key.participant]
    : [key.senderPn, key.remoteJidPn, key.remoteJidAlt, key.remoteJid];
  return [...new Set(ordered.filter(value => typeof value === 'string' && value))];
}

/**
 * Resolve a message sender only from PN fields carried by Baileys or a verified
 * Baileys LID mapping. Never synthesize a @s.whatsapp.net JID from LID digits.
 */
export async function resolveMessageSenderPn(sock, key = {}, isGroup = false) {
  const candidates = candidatesForKey(key, isGroup);
  const explicitPn = candidates.map(normalizeJid).find(isPn);
  if (explicitPn) return explicitPn;

  const lids = candidates.map(normalizeJid).filter(isLid);
  const mappings = sock?.signalRepository?.lidMapping;
  const lookup = mappings?.getPNForLID;
  if (typeof lookup === 'function') {
    for (const lid of lids) {
      try {
        const mapped = normalizeJid(await lookup.call(mappings, lid));
        if (isPn(mapped)) return mapped;
      } catch {}
    }
  }
  return null;
}

export function extractVerifiedPnCandidates(key = {}, isGroup = false) {
  return candidatesForKey(key, isGroup).map(normalizeJid).filter(isPn);
}

export function phoneNumberFromPnJid(jid) {
  const normalized = normalizeJid(jid);
  if (!isPn(normalized)) return null;
  const number = normalized.slice(0, -PN_SUFFIX.length);
  return /^\d{8,15}$/.test(number) ? number : null;
}

export function normalizeVerifiedJid(jid) {
  const normalized = normalizeJid(jid);
  return isPn(normalized) ? normalized : null;
}
