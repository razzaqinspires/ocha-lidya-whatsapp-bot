/** Build a WhatsApp contact-card payload using the Baileys contactMessage shape. */
function escapeVCard(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

export function normalizeContactNumber(value) {
  const number = String(value ?? '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(number)) {
    throw new TypeError('Nomor kontak harus berupa nomor internasional 8-15 digit tanpa tanda +.');
  }
  return number;
}

export function buildContactMessage({ number, displayName, organization = '' }) {
  const phone = normalizeContactNumber(number);
  const name = String(displayName ?? '').trim();
  if (!name || name.length > 80) {
    throw new TypeError('Nama kontak wajib diisi dan maksimal 80 karakter.');
  }

  const orgLine = organization ? `ORG:${escapeVCard(organization)};\n` : '';
  const nameParts = name.split(/\s+/);
  const familyName = nameParts.shift() || name;
  const givenName = nameParts.join(' ');
  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    // N is intentionally included: Baileys issue #1135 documents clients that
    // ignore FN when constructing the saved contact's structured name.
    `N:${escapeVCard(familyName)};${escapeVCard(givenName)};;;`,
    `FN:${escapeVCard(name)}`,
    orgLine.trimEnd(),
    `TEL;type=CELL;type=VOICE;waid=${phone}:+${phone}`,
    'END:VCARD'
  ].filter(Boolean).join('\n');

  // Keep displayName inside each contact item. This matches the corrected
  // contactMessage shape discussed in WhiskeySockets/Baileys#1135.
  return {
    contacts: {
      contacts: [{ displayName: name, vcard }]
    }
  };
}
