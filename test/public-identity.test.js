import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const original = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-public-identity-'));
process.chdir(temp);
const config = await import(pathToFileURL(path.resolve(original, 'src/config.js')).href);
await config.loadConfig();
const identity = await import(pathToFileURL(path.resolve(original, 'src/core/public-identity.js')).href);

test('public identity discloses creator name and organization but never owner phone or secrets', () => {
  const prompt = identity.buildPublicIdentityPrompt({ isOwner: false });
  assert.match(prompt, /Arifi Razzaq/);
  assert.match(prompt, /Razzaq Ventures/);
  assert.doesNotMatch(prompt, /6283193905842/);
  assert.doesNotMatch(prompt, /API.?KEY|secret vault/i);
  assert.match(identity.formatCreatorDisclosure(), /Arifi Razzaq/);
});

test('public creator disclosure switch suppresses the creator name for non-owner conversations', async () => {
  await config.updateConfig(value => { value.bot.publicCreatorDisclosure = false; }, { actor: 'test', reason: 'privacy toggle test' });
  const prompt = identity.buildPublicIdentityPrompt({ isOwner: false });
  assert.doesNotMatch(prompt, /Arifi Razzaq/);
  assert.match(identity.formatCreatorDisclosure(), /tidak dapat memberikan|dikelola oleh tim/i);
  assert.match(identity.buildPublicIdentityPrompt({ isOwner: true }), /Arifi Razzaq/);
});

test.after(async () => { process.chdir(original); await fs.rm(temp, { recursive: true, force: true }); });
