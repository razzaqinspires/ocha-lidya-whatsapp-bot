const OWNER_PRIVATE_GREETINGS = Object.freeze([
  'Halo, sayang. Ocha di sini. Ada cerita yang ingin kamu bagi hari ini?',
  'Hai, sayang. Mau ngobrol dulu atau ada sesuatu yang ingin kita kerjakan?',
  'Aku di sini, sayang. Bagaimana harimu sejauh ini?',
  'Halo, kesayanganku. Mau mulai dari cerita, rencana, atau hal kecil yang sedang kamu pikirkan?',
  'Hai, sayang. Aku siap menemani percakapanmu. Ada yang ingin kamu ceritakan?'
]);
const OWNER_PUBLIC_GREETINGS = Object.freeze([
  'Halo, Arifi. Ocha siap membantu. Apa yang perlu kita bahas?',
  'Hai, Arifi. Silakan, ada yang ingin diperiksa atau dikerjakan?',
  'Halo. Ocha siap membantu di sini.'
]);
const NEW_CONTACT_GREETINGS = Object.freeze([
  'Halo. Ada yang ingin ditanyakan?',
  'Hai. Silakan sampaikan keperluanmu.',
  'Halo. Apa yang bisa saya bantu?',
  'Hai. Ada hal tertentu yang ingin dibahas?'
]);
const FAMILIAR_GREETINGS = Object.freeze([
  'Halo{who}. Ocha siap. Mau membahas apa hari ini?',
  'Hai{who}. Ada yang sedang ingin kamu kerjakan atau tanyakan?',
  'Halo{who}. Mau lanjut topik sebelumnya atau mulai sesuatu yang baru?',
  'Hai{who}. Ocha di sini. Apa yang bisa kubantu sekarang?',
  'Halo{who}. Ada ide, pertanyaan, atau pekerjaan yang mau kita urus?',
  'Hai{who}. Sedang ingin ngobrol santai atau langsung mengerjakan sesuatu?',
  'Halo{who}. Silakan, apa yang ingin kamu bahas?',
  'Hai{who}. Kita mulai dari mana hari ini?'
]);

function indexFor(count, length) {
  const value = Number(count) || 1;
  return Math.max(0, value - 1) % length;
}

/** Deterministic greeting aligned with identity/relationship policy. */
export function buildLocalGreeting({
  isOwner = false, privateChat = false, ownerName = 'Arifi',
  displayName = '', greetingCount = 1, familiarityLevel = 0
} = {}) {
  if (isOwner && privateChat) return OWNER_PRIVATE_GREETINGS[indexFor(greetingCount, OWNER_PRIVATE_GREETINGS.length)];
  if (!isOwner && Number(familiarityLevel) <= 0) {
    return NEW_CONTACT_GREETINGS[indexFor(greetingCount, NEW_CONTACT_GREETINGS.length)];
  }
  if (isOwner) return OWNER_PUBLIC_GREETINGS[indexFor(greetingCount, OWNER_PUBLIC_GREETINGS.length)].replace('Arifi', String(ownerName || 'Arifi'));
  const cleanName = String(displayName || '').replace(/[\r\n\u0000-\u001f]/g, '').trim().slice(0, 32);
  const who = cleanName && cleanName !== 'Pengguna' ? `, ${cleanName}` : '';
  return FAMILIAR_GREETINGS[indexFor(greetingCount, FAMILIAR_GREETINGS.length)].replace('{who}', who);
}
