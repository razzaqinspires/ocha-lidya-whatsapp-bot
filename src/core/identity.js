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
export function isOwner(sender, ownerNumber) {
  const senderDigits = digitsOnly(String(sender || '').split('@')[0]);
  return senderDigits.length > 0 && senderDigits === normalizePhone(ownerNumber);
}
export function getSenderJids(message) {
  const key = message?.key || {};
  return [...new Set([key.senderPn, key.participantAlt, key.participant, key.remoteJidAlt, key.remoteJid].filter(Boolean))];
}
