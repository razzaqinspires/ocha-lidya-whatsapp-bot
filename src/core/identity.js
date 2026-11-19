const digitsOnly = value => String(value || '').replace(/[^0-9]/g, '');

export function normalizePhone(value) {
  let digits = digitsOnly(value);
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  return digits;
}

export function phoneJid(value) {
  const digits = normalizePhone(value);
  return digits ? `${digits}@s.whatsapp.net` : null;
}

function verifiedNumber(value) {
  if (typeof value !== 'string') return '';
  if (value.endsWith('@lid') || value.endsWith('@g.us') || value.endsWith('@broadcast')) return '';
  if (value.endsWith('@s.whatsapp.net')) {
    const number = value.slice(0, -'@s.whatsapp.net'.length).split(':')[0];
    return /^\d{8,15}$/.test(number) ? number : '';
  }
  return /^\d{8,15}$/.test(value) ? value : '';
}

/** Owner verification accepts only an explicit PN JID or a validated phone string; LID digits are never treated as phone digits. */
export function isOwner(sender, ownerNumber) {
  const owner = normalizePhone(ownerNumber);
  if (!owner) return false;
  const candidates = Array.isArray(sender) ? sender : [sender];
  return candidates.some(candidate => verifiedNumber(String(candidate || '')) === owner);
}

export function getSenderJids(message) {
  const key = message?.key || {};
  return [...new Set([
    key.senderPn, key.remoteJidPn, key.participantPn,
    key.remoteJidAlt, key.participantAlt,
    key.participant, key.remoteJid
  ].filter(Boolean))];
}
