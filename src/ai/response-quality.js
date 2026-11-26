const GREETING_ONLY = /^(?:hai+|halo+|hello+|hi+|hey+|assalamualaikum|assalamu['’]alaikum|pagi|siang|sore|malam|wkwk+|haha+|hehe+|ok(?:e|ay)?|sip|baik)[!.?,\s]*$/iu;

const GENERIC_NON_ANSWERS = Object.freeze([
  /^apa\s+yang\s+ingin\s+(?:kamu|anda)\s+(?:lakukan|kerjakan)(?:\s+hari\s+ini)?[.!?\s]*$/iu,
  /^apa\s+yang\s+(?:ingin|mau)\s+(?:kamu|anda|kita)\s+(?:bahas|kerjakan|lakukan)(?:\s+hari\s+ini)?[.!?\s]*$/iu,
  /^apa\s+yang\s+ingin\s+kamu\s+tanyakan(?:\s+hari\s+ini)?[.!?\s]*$/iu,
  /^mau\s+mulai\s+dari\s+mana[.!?\s]*$/iu,
  /^kita\s+mulai\s+dari\s+mana[.!?\s]*$/iu,
  /^ada\s+yang\s+bisa\s+(?:saya|aku|kami)\s+bantu(?:\s+(?:hari\s+ini|sekarang))?[.!?\s]*$/iu,
  /^ada\s+(?:sesuatu|hal)\s+yang\s+ingin\s+kamu\s+(?:ceritakan|bahas|kerjakan)(?:\s+hari\s+ini)?[.!?\s]*$/iu,
  /^silakan\s+sampaikan\s+(?:apa\s+yang\s+ingin\s+kamu\s+(?:bahas|tanyakan)|keperluanmu)(?:\s+hari\s+ini)?[.!?\s]*$/iu,
  /^apa\s+topik\s+yang\s+ingin\s+kamu\s+bahas(?:\s+hari\s+ini)?[.!?\s]*$/iu,
  /^(?:halo|hai|hello)[,!\s]+(?:ada\s+yang\s+bisa\s+(?:saya|aku)\s+bantu|apa\s+yang\s+(?:ingin|mau)\s+kamu\s+(?:bahas|lakukan|tanyakan))(?:\s+hari\s+ini)?[.!?\s]*$/iu
]);

const CURRENT_INFO = /\b(?:hari\s+ini|saat\s+ini|sekarang|terbaru|terkini|barusan|minggu\s+ini|today|currently|latest|right\s+now|breaking)\b/iu;
const TOPIC_GAZA = /\b(?:gaza|palestina|palestinian|israel|rafah|jalur\s+gaza)\b/iu;

export function isGreetingOnlyInput(value) {
  return GREETING_ONLY.test(String(value || '').trim());
}

/**
 * A short user turn is substantive when it has a real question/task shape.
 * Conversational acknowledgements and pure greetings are intentionally excluded.
 */
export function isSubstantiveUserTurn(value) {
  const text = String(value || '').trim();
  if (!text || isGreetingOnlyInput(text)) return false;
  const words = text.match(/[\p{L}\p{N}]{2,}/gu) || [];
  if (words.length >= 3 && text.length >= 12) return true;
  if (/[?？]/u.test(text) && words.length >= 2) return true;
  return /^(?:tolong|jelaskan|uraikan|bandingkan|analisis|buatkan|ringkas|terjemahkan|hitungkan|periksa|cek|carikan|siapa|apa|bagaimana|mengapa|kenapa|kapan|dimana|di mana|berapa|apakah)\b/iu.test(text);
}

/** Detect an answer consisting only of a generic invitation instead of task fulfillment. */
export function isGenericNonAnswerResponse(value) {
  const text = String(value || '').replace(/```[\s\S]*?```/g, '').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 320) return false;
  const segments = text.split(/(?<=[.!?])\s+/u).map(part => part.trim()).filter(Boolean);
  if (!segments.length || segments.length > 3) return false;
  const isBareGreeting = part => /^(?:hai+|halo+|hello+|hi+|hey+)[,! .]*$/iu.test(part);
  return segments.every(part => isBareGreeting(part) || GENERIC_NON_ANSWERS.some(pattern => pattern.test(part)));
}

/** Truthful local response if the model still fails its single repair attempt. */
export function buildNonAnswerFallback(userText) {
  const request = String(userText || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 260);
  if (CURRENT_INFO.test(request) && TOPIC_GAZA.test(request)) {
    return 'Pertanyaanmu meminta perkembangan Gaza yang paling baru. Jawaban model tadi tidak menjawab pertanyaan, dan jalur percakapan ini belum mengambil sumber berita real-time untuk memverifikasi keadaan hari ini. Saya tidak akan mengarang angka korban, kondisi bantuan, atau perkembangan di lapangan. Kirimkan artikel atau tautan berita yang ingin diperiksa; saya dapat merangkum isinya dan memisahkan fakta terkonfirmasi dari klaim.';
  }
  if (CURRENT_INFO.test(request)) {
    return 'Pertanyaanmu meminta informasi terkini. Jawaban model tadi tidak menjawabnya dan belum ada sumber real-time yang berhasil diambil pada giliran ini. Saya tidak akan menebak perkembangan terbaru. Kirimkan sumber atau tautan yang ingin diperiksa agar informasinya dapat dirangkum dengan benar.';
  }
  return `Jawaban yang dihasilkan tadi tidak menjawab permintaanmu: “${request}”. Saya tidak akan menggantinya dengan sapaan atau mengarang jawaban. Pemrosesan perlu diulang agar pertanyaanmu dijawab secara langsung.`;
}
