import test from 'node:test';
import assert from 'node:assert/strict';
import { baileysLogger } from '../src/core/logger.js';

test('Baileys logger is fully silent and child loggers stay silent', () => {
  assert.equal(baileysLogger.level, 'silent');
  for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
    assert.equal(typeof baileysLogger[level], 'function');
    assert.doesNotThrow(() => baileysLogger[level]({ test: true }, 'suppressed'));
  }
  assert.equal(baileysLogger.child({ component: 'baileys' }), baileysLogger);
  assert.equal(baileysLogger.isLevelEnabled('error'), false);
});
