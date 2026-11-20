import test from 'node:test';
import assert from 'node:assert/strict';
import { baileysLogger, sanitizeLogValue, isSensitiveSessionDump } from '../src/core/logger.js';

test('Baileys logger is fully silent and child loggers stay silent', () => {
  assert.equal(baileysLogger.level, 'silent');
  for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
    assert.equal(typeof baileysLogger[level], 'function');
    assert.doesNotThrow(() => baileysLogger[level]({ test: true }, 'suppressed'));
  }
  assert.equal(baileysLogger.child({ component: 'baileys' }), baileysLogger);
  assert.equal(baileysLogger.isLevelEnabled('error'), false);
});


test('terminal log sanitizer redacts Signal private session material', () => {
  const safe = sanitizeLogValue({
    privKey: Buffer.from('private-material'),
    rootKey: 'root-material',
    chainKey: 'chain-material',
    remoteIdentityKey: Buffer.from('identity-material'),
    publicValue: 'visible'
  });
  assert.equal(safe.privKey, '[REDACTED]');
  assert.equal(safe.rootKey, '[REDACTED]');
  assert.equal(safe.chainKey, '[REDACTED]');
  assert.equal(safe.remoteIdentityKey, '[REDACTED]');
  assert.equal(safe.publicValue, 'visible');
});

test('raw libsignal SessionEntry console dumps are recognized and suppressed', () => {
  assert.equal(isSensitiveSessionDump(['Closing session: SessionEntry {'] ), true);
  assert.equal(isSensitiveSessionDump(['ordinary application log']), false);
});
