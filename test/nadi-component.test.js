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
    owner: 'razzaqinspires',
    repo: 'artificial-consciousness-component',
    canonicalUrl: REPO,
  });
});

test(
  'NADI uses the non-secret private component path from config without a remote download',
  { timeout: 15_000 },
  async () => {
    const priorSource = process.env.OCHA_NADI_SOURCE_DIR;
    const priorFetch = globalThis.fetch;
    let requests = 0;
    try {
      process.env.OCHA_NADI_SOURCE_DIR = path.resolve('.private/artificial-consciousness-component');
      globalThis.fetch = async () => {
        requests += 1;
        throw new TypeError('unexpected network access');
      };
      const result = await resolveNadiComponent({ logger: { info() {} } });
      assert.equal(result.source, 'external-directory');
      assert.equal(result.version, '2.1.2');
      assert.equal(path.resolve(result.root), path.resolve('.private/artificial-consciousness-component'));
      assert.equal(requests, 0);
    } finally {
      globalThis.fetch = priorFetch;
      if (priorSource === undefined) delete process.env.OCHA_NADI_SOURCE_DIR;
      else process.env.OCHA_NADI_SOURCE_DIR = priorSource;
    }
  },
);
