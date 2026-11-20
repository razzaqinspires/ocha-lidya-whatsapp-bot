import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

test('creator identity and varied greetings work without any provider API key', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-ai-local-policy-'));
  const configUrl = pathToFileURL(path.resolve(original, 'src/config.js')).href;
  const dbUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
  const engineUrl = pathToFileURL(path.resolve(original, 'src/ai/engine.js')).href;
  const profileUrl = pathToFileURL(path.resolve(original, 'src/ai/user-profiles.js')).href;
  const providerUrl = pathToFileURL(path.resolve(original, 'src/ai/providers.js')).href;
  const source = `
    const config = await import(${JSON.stringify(configUrl)}); await config.loadConfig();
    const db = await import(${JSON.stringify(dbUrl)}); await db.initializeDatabase();
    const provider = await import(${JSON.stringify(providerUrl)}); await provider.initializeProviderKeys();
    const engine = await import(${JSON.stringify(engineUrl)}); await engine.initializeAIHistoryCache();
    const profiles = await import(${JSON.stringify(profileUrl)}); await profiles.initializeUserProfiles();
    globalThis.fetch = async () => { throw new Error('Provider must not be called for local identity/greeting'); };
    const replies = [];
    const sock = { sendPresenceUpdate: async () => {} };
    const makeMessage = (body, id, owner = true) => ({ chat: owner ? '6283193905842@s.whatsapp.net' : '6281234567890@s.whatsapp.net', sender: owner ? '6283193905842@s.whatsapp.net' : '6281234567890@s.whatsapp.net', pushName: owner ? 'Sky' : 'Ayu', body, id, key: { id }, isGroup: false, isOwner: owner, reply: async text => { replies.push(text); return { key: { id: 'sent-' + id } }; } });
    await engine.answerMessage(sock, makeMessage('Siapa owner kamu?', 'identity-1'));
    await engine.answerMessage(sock, makeMessage('Halo', 'hello-1'));
    await engine.answerMessage(sock, makeMessage('Halo', 'hello-2'));
    await engine.answerMessage(sock, makeMessage('Kamu tahu aku siapa?', 'whoami-1'));
    await engine.answerMessage(sock, makeMessage('Ini aku bilang apa?', 'recall-user-1'));
    await engine.answerMessage(sock, makeMessage('Terus jawaban kamu?', 'recall-ai-1'));
    await engine.answerMessage(sock, makeMessage('Siapa pembuat kamu?', 'public-creator-1', false));
    const profile = await profiles.getUserProfile('6283193905842@s.whatsapp.net', { isOwner: true });
    console.log(JSON.stringify({ replies, profile: { displayName: profile.displayName, role: profile.role, xp: profile.xp } }));
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temp, encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('{"replies"'));
    assert.ok(line, result.stdout);
    const output = JSON.parse(line);
    assert.match(output.replies[0], /Arifi Razzaq/);
    assert.notEqual(output.replies[1], output.replies[2], 'consecutive greetings must not be static repeats');
    assert.match(output.replies[3], /Kamu adalah Arifi Razzaq/);
    assert.match(output.replies[4], /Kamu tahu aku siapa/);
    assert.match(output.replies[5], /Jawabanku sebelumnya/);
    assert.match(output.replies[6], /Arifi Razzaq/);
    assert.equal(output.profile.displayName, 'Arifi Razzaq');
    assert.equal(output.profile.role, 'Owner & Creator');
    assert.ok(output.profile.xp >= 30);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
