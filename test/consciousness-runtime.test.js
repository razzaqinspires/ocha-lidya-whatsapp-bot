import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSocialIntroduction,
  evaluateSocialFollowUp
} from '../src/runtime/social-autonomy-policy.js';
import { parseGitHubRepository } from '../src/runtime/nadi-component.js';
import {
  getConsciousnessPrompt,
  getConsciousnessStatus,
  startConsciousnessRuntime,
  stopConsciousnessRuntime,
  verifyConsciousnessMemory
} from '../src/runtime/consciousness-runtime.js';

test('NADI prompt remains honest when external component is unavailable', () => {
  assert.match(getConsciousnessPrompt(), /unavailable|NADI OPERATIONAL STATE/);
  assert.equal(typeof getConsciousnessStatus().enabled, 'boolean');
});

test('GitHub source URL is normalized and constrained to a repository URL', () => {
  assert.deepEqual(parseGitHubRepository('https://github.com/owner/artificial-consciousness-component.git'), {
    owner: 'owner', repo: 'artificial-consciousness-component',
    canonicalUrl: 'https://github.com/owner/artificial-consciousness-component'
  });
  assert.throws(() => parseGitHubRepository('http://github\.com/repo'), /HTTPS/);
  assert.throws(() => parseGitHubRepository('https://example.com/owner/repo'), /github\.com/);
  assert.throws(() => parseGitHubRepository('https://github.com/owner/repo/tree/main'), /URL repositori/);
});

test('social initiation requires group/admin and member opt-in', () => {
  assert.equal(evaluateSocialIntroduction({ groupEnabled: true, groupAdminApproved: true }).allowed, false);
  assert.equal(evaluateSocialIntroduction({ groupEnabled: true, groupAdminApproved: false, memberOptedIn: true }).reason, 'group_admin_consent_required');
  assert.equal(evaluateSocialIntroduction({ groupEnabled: true, groupAdminApproved: true, memberOptedIn: true }).action, 'single_neutral_introduction');
  assert.equal(evaluateSocialIntroduction({ groupEnabled: true, groupAdminApproved: true, memberOptedIn: true, ignoredSinceLastContact: true }).reason, 'respect_silence');
});

test('Ocha never nags or sends angry repeated follow-ups', () => {
  assert.equal(evaluateSocialFollowUp({ memberOptedIn: true, ignored: true, explicitFollowUpRequested: true }).allowed, false);
  assert.equal(evaluateSocialFollowUp({ memberOptedIn: true, explicitFollowUpRequested: true, followUpsSent: 1 }).reason, 'follow_up_limit_reached');
  assert.deepEqual(evaluateSocialFollowUp({ memberOptedIn: true, explicitFollowUpRequested: true }), { allowed: true, reason: 'explicit_follow_up', tone: 'neutral' });
});

test('NADI startup degrades safely when Python/runtime is unavailable', { timeout: 10_000 }, async () => {
  const priorRepo = process.env.OCHA_NADI_REPO_URL;
  const priorSource = process.env.OCHA_NADI_SOURCE_DIR;
  const priorRemote = process.env.OCHA_NADI_BASE_URL;
  const priorRef = process.env.OCHA_NADI_REF;
  const priorPython = process.env.OCHA_PYTHON_BIN;
  try {
    process.env.OCHA_NADI_REPO_URL = 'https://github.com/razzaqinspires/artificial-consciousness-component';
    process.env.OCHA_NADI_REF = '16c2fa6e1b500745f260bcf091284a6e18726883';
    process.env.OCHA_PYTHON_BIN = '/definitely/missing/nadi-python';
    delete process.env.OCHA_NADI_SOURCE_DIR;
    delete process.env.OCHA_NADI_BASE_URL;
    const status = await startConsciousnessRuntime();
    assert.equal(status.ready, false);
    assert.ok(status.lastError);
    assert.match(getConsciousnessPrompt(), /unavailable/);
  } finally {
    if (priorRepo === undefined) delete process.env.OCHA_NADI_REPO_URL; else process.env.OCHA_NADI_REPO_URL = priorRepo;
    if (priorSource === undefined) delete process.env.OCHA_NADI_SOURCE_DIR; else process.env.OCHA_NADI_SOURCE_DIR = priorSource;
    if (priorRemote === undefined) delete process.env.OCHA_NADI_BASE_URL; else process.env.OCHA_NADI_BASE_URL = priorRemote;
    if (priorRef === undefined) delete process.env.OCHA_NADI_REF; else process.env.OCHA_NADI_REF = priorRef;
    if (priorPython === undefined) delete process.env.OCHA_PYTHON_BIN; else process.env.OCHA_PYTHON_BIN = priorPython;
    await stopConsciousnessRuntime();
  }
});

test('NADI verification reports unavailable rather than fabricating integrity', async () => {
  await assert.rejects(verifyConsciousnessMemory(), /NADI belum siap/);
});
