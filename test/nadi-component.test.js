import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveNadiComponent, parseGitHubRepository } from '../src/runtime/nadi-component.js';

const REPO = 'https://github.com/razzaqinspires/artificial-consciousness-component';
const PIN = '16c2fa6e1b500745f260bcf091284a6e18726883';

test('Ocha NADI source is preconfigured to the verified immutable GitHub commit', () => {
  assert.equal(process.env.OCHA_NADI_REPO_URL || REPO, REPO);
  assert.equal(process.env.OCHA_NADI_REF || PIN, PIN);
  assert.deepEqual(parseGitHubRepository(REPO), {
    owner: 'razzaqinspires', repo: 'artificial-consciousness-component',
    canonicalUrl: REPO
  });
});

test('NADI installer reports a clear network failure without corrupting existing install', { timeout: 15_000 }, async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-nadi-offline-'));
  const priorFetch = globalThis.fetch;
  const prior = {
    repo: process.env.OCHA_NADI_REPO_URL, ref: process.env.OCHA_NADI_REF,
    home: process.env.OCHA_NADI_HOME, source: process.env.OCHA_NADI_SOURCE_DIR,
    remote: process.env.OCHA_NADI_BASE_URL, update: process.env.OCHA_NADI_UPDATE,
    sha: process.env.OCHA_NADI_SHA256
  };
  try {
    process.env.OCHA_NADI_REPO_URL = REPO;
    process.env.OCHA_NADI_REF = PIN;
    process.env.OCHA_NADI_HOME = temp;
    delete process.env.OCHA_NADI_SOURCE_DIR;
    delete process.env.OCHA_NADI_BASE_URL;
    process.env.OCHA_NADI_UPDATE = '1';
    delete process.env.OCHA_NADI_SHA256;
    globalThis.fetch = async () => { throw new TypeError('simulated network unavailable'); };
    await assert.rejects(
      resolveNadiComponent({ logger: { info() {} } }),
      /simulated network unavailable/
    );
    assert.equal(await fs.readdir(path.join(temp, 'releases')).then(x => x.length), 0);
  } finally {
    globalThis.fetch = priorFetch;
    const restore = (key, value) => value === undefined ? delete process.env[key] : process.env[key] = value;
    restore('OCHA_NADI_REPO_URL', prior.repo); restore('OCHA_NADI_REF', prior.ref);
    restore('OCHA_NADI_HOME', prior.home); restore('OCHA_NADI_SOURCE_DIR', prior.source);
    restore('OCHA_NADI_BASE_URL', prior.remote); restore('OCHA_NADI_UPDATE', prior.update);
    restore('OCHA_NADI_SHA256', prior.sha);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
