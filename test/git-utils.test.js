import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAutomaticCommitMessage,
  formatJakartaTimestamp,
  parseGitIgnore,
  parsePorcelainZ
} from '../src/core/git-utils.js';

test('parsePorcelainZ tracks added, modified, deleted and renamed paths', () => {
  const output = ' M src/index.js\0?? docs/new file.md\0D  old.txt\0R  new-name.js\0old-name.js\0';
  assert.deepEqual(parsePorcelainZ(output), [
    'src/index.js', 'docs/new file.md', 'old.txt', 'new-name.js', 'old-name.js'
  ]);
});

test('parseGitIgnore keeps patterns and drops comments/blank rows', () => {
  assert.deepEqual(parseGitIgnore('# comment\nnode_modules/\n\n.env\n!.env.example\n'), [
    'node_modules/', '.env', '!.env.example'
  ]);
});

test('commit timestamp includes Indonesian weekday, calendar date and WIB time', () => {
  const date = new Date('2026-11-18T12:30:45.000Z');
  assert.equal(formatJakartaTimestamp(date), 'Rabu, 18 November 2026 19:30:45 WIB');
  const message = createAutomaticCommitMessage(date);
  assert.match(message, /^pasang waktu Otomatis, waktu, tanggal, jam, dan hari yang kompleks\./);
  assert.match(message, /Waktu commit: Rabu, 18 November 2026 19:30:45 WIB/);
  assert.match(message, /ISO-8601: 2026-11-18T19:30:45\+07:00/);
});
