const SAFE_FIELDS = new Set(['text', 'url', 'media', 'mimetype', 'filename', 'title', 'duration', 'metadata']);
const SECRET_KEY = /(?:api.?key|token|secret|password|authorization|credential|private.?key|cookie|session)/i;
const SECRET_TEXT = /\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*|((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*)[^\s,;]+/gi;

function redactText(value, max = 3500) {
  return String(value ?? '').replace(SECRET_TEXT, (_match, bearer, assignment) => bearer ? `${bearer}[REDACTED]` : `${assignment}[REDACTED]`).slice(0, max);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') return null;
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) if (SECRET_KEY.test(key)) url.searchParams.delete(key);
    return url.href.slice(0, 2048);
  } catch { return null; }
}

function safeMetadata(value, depth = 0) {
  if (depth > 4) return '[MaxDepth]';
  if (Array.isArray(value)) return value.slice(0, 30).map(item => safeMetadata(item, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? redactText(value, 500) : value;
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 50)) {
    if (SECRET_KEY.test(key)) continue;
    output[String(key).slice(0, 80)] = safeMetadata(item, depth + 1);
  }
  return output;
}

export function normalizeResponse(output, { attribution = null } = {}) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw new TypeError('Provider output must be an object');
  const normalized = {};
  for (const [key, value] of Object.entries(output)) {
    if (!SAFE_FIELDS.has(key)) continue;
    if (key === 'url') {
      const url = safeUrl(value);
      if (url) normalized.url = url;
      continue;
    }
    if (key === 'media') {
      const values = (Array.isArray(value) ? value : [value])
        .map(item => typeof item === 'string' ? item : item?.url)
        .map(safeUrl).filter(Boolean).slice(0, 5);
      if (values.length) normalized.media = values;
      continue;
    }
    if (key === 'filename' && /[\/\\]/.test(String(value))) continue;
    if (key === 'metadata' && (!value || typeof value !== 'object')) continue;
    if (key === 'text' || key === 'title' || key === 'duration' || key === 'filename' || key === 'mimetype') {
      normalized[key] = redactText(value, key === 'text' ? 3500 : 500);
      continue;
    }
    if (key === 'metadata') normalized.metadata = safeMetadata(value);
  }
  if (attribution) normalized.attribution = redactText(attribution, 200);
  return normalized;
}
