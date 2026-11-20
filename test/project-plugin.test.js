import test from 'node:test';
import assert from 'node:assert/strict';
import projectPlugin from '../src/plugins/general/project.js';
import { getProjectExportPreference } from '../src/ai/project-library.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('Project Library commands are blocked in group chats before any project lookup', async () => {
  let reply = '';
  const m = {
    chat: '120363000000000000@g.us',
    sender: '6281111111111@s.whatsapp.net',
    isGroup: true,
    reply: async text => { reply = text; return text; }
  };
  await projectPlugin.execute({ sock: {}, m, args: ['list'] });
  assert.match(reply, /hanya tersedia di chat pribadi/i);
});

test('ZIP export preference is private per user and persists as a setting', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-project-pref-'));
  const previousRoot = process.env.OCHA_PROJECT_LIBRARY_ROOT;
  process.env.OCHA_PROJECT_LIBRARY_ROOT = root;
  try {
    let reply = '';
    const m = {
      chat: '6281111111111@s.whatsapp.net',
      sender: '6281111111111@s.whatsapp.net',
      isGroup: false,
      reply: async text => { reply = text; return text; }
    };
    await projectPlugin.execute({ sock: {}, m, args: ['export', 'always'] });
    assert.match(reply, /ALWAYS/);
    assert.equal(await getProjectExportPreference({ ownerId: m.sender }), 'always');
    assert.equal(await getProjectExportPreference({ ownerId: '6282222222222@s.whatsapp.net' }), 'ask');
  } finally {
    if (previousRoot === undefined) delete process.env.OCHA_PROJECT_LIBRARY_ROOT;
    else process.env.OCHA_PROJECT_LIBRARY_ROOT = previousRoot;
    await fs.rm(root, { recursive: true, force: true });
  }
});
