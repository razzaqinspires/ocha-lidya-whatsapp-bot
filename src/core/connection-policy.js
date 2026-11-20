export function normalizePhoneNumber(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export function isValidInternationalNumber(value) {
  return /^\d{8,15}$/.test(String(value ?? ''));
}

export function getReconnectDelay(attempt, code, { baseMs = 1500, maxMs = 30000, random = Math.random, restartRequiredCode = 515 } = {}) {
  if (Number(code) === Number(restartRequiredCode)) return 500;
  const safeAttempt = Math.max(0, Math.min(Number(attempt) || 0, 5));
  const exponential = Math.min(baseMs * (2 ** safeAttempt), maxMs);
  const jitter = 0.8 + Math.min(1, Math.max(0, Number(random()) || 0)) * 0.4;
  return Math.min(maxMs, Math.round(exponential * jitter));
}

export function shouldStopReconnect(code, {
  loggedOutCode = 401,
  forbiddenCode = 403,
  multideviceMismatchCode = 411,
  connectionReplacedCode = 440,
  badSessionCode = 500
} = {}) {
  // Do not enter a reconnect loop when WhatsApp says this session was
  // replaced by another connection or requires user/session intervention.
  const terminalCodes = [
    loggedOutCode,
    forbiddenCode,
    multideviceMismatchCode,
    connectionReplacedCode,
    badSessionCode
  ];
  return terminalCodes.some(value => Number(code) === Number(value));
}


export function shouldRequestPairingCode({ authMode, registered, qr, pairingRequested }) {
  return authMode === 'pairing' && !registered && Boolean(qr) && !pairingRequested;
}


export function shouldRecoverInvalidSession({ code, authMode, recoverEnabled, registered, recoveryUsed }) {
  return Number(code) === 401 && authMode === 'pairing' && recoverEnabled === true &&
    registered === true && recoveryUsed !== true;
}
