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

export function shouldStopReconnect(code, { loggedOutCode = 401, badSessionCode = 500 } = {}) {
  return Number(code) === Number(loggedOutCode) || Number(code) === Number(badSessionCode);
}

export function shouldRequestPairingCode({ authMode, registered, qr, pairingRequested }) {
  return authMode === 'pairing' && !registered && Boolean(qr) && !pairingRequested;
}


export function shouldRecoverInvalidSession({ code, authMode, recoverEnabled, registered, recoveryUsed }) {
  return Number(code) === 401 && authMode === 'pairing' && recoverEnabled === true &&
    registered === true && recoveryUsed !== true;
}
