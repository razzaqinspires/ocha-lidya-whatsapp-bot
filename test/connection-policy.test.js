import test from 'node:test';
import assert from 'node:assert/strict';
import { getReconnectDelay, isValidInternationalNumber, normalizePhoneNumber, shouldRequestPairingCode, shouldStopReconnect, shouldRecoverInvalidSession } from '../src/core/connection-policy.js';

test('normalizes phone numbers for pairing without changing country code', () => {
  assert.equal(normalizePhoneNumber('+62 821-7746-1231'), '6282177461231');
  assert.equal(isValidInternationalNumber('6282177461231'), true);
  assert.equal(isValidInternationalNumber('0812 123'), false);
});

test('uses a short reconnect delay for Baileys restartRequired (515)', () => {
  assert.equal(getReconnectDelay(4, 515, { random: () => 0 }), 500);
});

test('uses bounded exponential backoff with jitter', () => {
  assert.equal(getReconnectDelay(0, 408, { random: () => 0 }), 1200);
  assert.equal(getReconnectDelay(5, 408, { random: () => 1 }), 30000);
});

test('stops reconnecting only for invalidated sessions', () => {
  assert.equal(shouldStopReconnect(401), true);
  assert.equal(shouldStopReconnect(500), true);
  assert.equal(shouldStopReconnect(408), false);
  assert.equal(shouldStopReconnect(515), false);
});

test('pairing-code request waits for the initial QR readiness event', () => {
  assert.equal(shouldRequestPairingCode({ authMode: 'pairing', registered: false, qr: false, pairingRequested: false }), false);
  assert.equal(shouldRequestPairingCode({ authMode: 'pairing', registered: false, qr: 'qr-payload', pairingRequested: false }), true);
  assert.equal(shouldRequestPairingCode({ authMode: 'pairing', registered: true, qr: 'qr-payload', pairingRequested: false }), false);
  assert.equal(shouldRequestPairingCode({ authMode: 'qr', registered: false, qr: 'qr-payload', pairingRequested: false }), false);
  assert.equal(shouldRequestPairingCode({ authMode: 'pairing', registered: false, qr: 'qr-payload', pairingRequested: true }), false);
});


test('recovers one invalid registered session only in pairing mode when enabled', () => {
  const base = { code: 401, authMode: 'pairing', recoverEnabled: true, registered: true, recoveryUsed: false };
  assert.equal(shouldRecoverInvalidSession(base), true);
  assert.equal(shouldRecoverInvalidSession({ ...base, recoveryUsed: true }), false);
  assert.equal(shouldRecoverInvalidSession({ ...base, recoverEnabled: false }), false);
  assert.equal(shouldRecoverInvalidSession({ ...base, registered: false }), false);
  assert.equal(shouldRecoverInvalidSession({ ...base, authMode: 'qr' }), false);
  assert.equal(shouldRecoverInvalidSession({ ...base, code: 408 }), false);
});
