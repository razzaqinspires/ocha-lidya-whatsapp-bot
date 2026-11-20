import { getConfig } from './config.js';

const SENSITIVE_PROPERTY = /(?:api.?key|access.?token|refresh.?token|token|secret|password|passwd|credential|authorization|cookie|private.?key|session|auth|github.?pat|signing.?key)/i;
const SECRET_ENV_NAMES = Object.freeze([
  'GITHUB_PAT',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'DEEPSEEK_API_KEY'
]);

function redact(value, key = '') {
  if (SENSITIVE_PROPERTY.test(key)) return value ? '[REDACTED — configured]' : '[REDACTED — not set]';
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') {
    const result = Object.create(null);
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = redact(childValue, childKey);
    }
    return result;
  }
  if (typeof value === 'string') return sanitizeEmbeddedSecret(value);
  return value;
}

export function isConfigurationInspectionIntent(text) {
  const value = String(text || '').toLowerCase()
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[?!.,]/g, ' ');
  const target = /\b(?:konfigurasi|configuration|config|pengaturan|settings?|setelan)\b/;
  const inspectionAction = /\b(?:lihat|melihat|tampilkan|menampilkan|buka|membuka|bacakan|bacakan|periksa|cek|akses|dump|export|print|list|show|display|read|reveal|inspect|view|boleh|bisa|dapat|mau|ingin|tolong|can|could)\b/;
  const allScope = /\b(?:semua|seluruh|lengkap|semuanya|isi|detail|full|entire|all|whole)\b/;
  if (!target.test(value)) return false;
  return inspectionAction.test(value) || allScope.test(value);
}

export function isSecretMaterialInspectionIntent(text) {
  const value = String(text || '').toLowerCase().normalize('NFKC');
  return /(?:\.env\b|environment\s+variables?|api[\s_-]?keys?|access[\s_-]?tokens?|refresh[\s_-]?tokens?|passwords?|credentials?|private[\s_-]?keys?|session\s+(?:file|data|credentials?)|isi\s+secret|nilai\s+secret)/i.test(value)
    && /\b(?:lihat|tampilkan|buka|bacakan|ambil|kirim|berikan|show|display|read|reveal|dump|export|what\s+is|apa|nilai|isi|semua|seluruh|lengkap)\b/i.test(value);
}

function sanitizeEmbeddedSecret(value) {
  const text = String(value);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(text)) return '[REDACTED — private key]';
  if (/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/i.test(text)) return '[REDACTED — authorization material]';
  if (/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,})\b/.test(text)) return '[REDACTED — credential-like value]';
  // Avoid exposing embedded credentials in database URLs or arbitrary URI settings.
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)[^@/\s]+(@)/ig, '$1[REDACTED]$2');
}

export function getOwnerConfigurationSnapshot(config = getConfig()) {
  return {
    configuration: redact(config),
    environmentSecrets: SECRET_ENV_NAMES.map(name => ({
      name,
      configured: Boolean(String(process.env[name] || '').trim()),
      value: '[NEVER SHOWN IN WHATSAPP]'
    })),
    securityNotes: [
      'Nilai API key, PAT, token, password, cookie, session, auth, dan private key tidak pernah ditampilkan.',
      'Status secret hanya menunjukkan configured true/false; isi secret tetap berada di environment lokal.',
      'Konfigurasi ini hanya dikirim melalui chat pribadi owner yang diverifikasi dari metadata WhatsApp.'
    ]
  };
}

export function formatOwnerConfiguration() {
  const snapshot = getOwnerConfigurationSnapshot();
  const json = JSON.stringify(snapshot, null, 2);
  return [
    '*OCHA LIDYA · OWNER CONFIGURATION SNAPSHOT*',
    'Akses owner terverifikasi · konfigurasi non-secret lengkap · nilai kredensial disensor.',
    '',
    '```json',
    json,
    '```',
    '',
    'Snapshot ini tidak membaca atau mengirim isi `.env`, kredensial WhatsApp, database journal, atau session file.'
  ].join('\n');
}
