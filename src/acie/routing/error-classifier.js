const RULES = [
  ['rate-limit', /(?:rate.?limit|too many requests|http\s*429)/i, true],
  ['quota-exhausted', /(?:quota|insufficient credits|limit reached)/i, false],
  ['authentication', /(?:unauthorized|forbidden|invalid token|authentication|http\s*401|http\s*403)/i, false],
  ['invalid-input', /(?:invalid input|bad request|unsupported url|http\s*400|validation)/i, false],
  ['dependency-failure', /(?:module not found|cannot find package|dependency)/i, true],
  ['network-error', /(?:econnreset|econnrefused|enotfound|eai_again|timeout|network)/i, true],
  ['runtime-failure', /(?:runtime|process exited|signal|segmentation fault)/i, true],
  ['invalid-output', /(?:invalid output|schema mismatch|unexpected output)/i, false],
  ['permanent-error', /(?:not found|gone|unsupported operation|permanent)/i, false]
];

export function classifyProviderError(error) {
  const text = `${error?.code || ''} ${error?.message || error || ''}`;
  for (const [kind, pattern, retryable] of RULES) if (pattern.test(text)) return { kind, retryable, message: String(error?.message || error || kind).slice(0, 500) };
  return { kind: 'unknown', retryable: false, message: String(error?.message || error || 'Unknown provider error').slice(0, 500) };
}
