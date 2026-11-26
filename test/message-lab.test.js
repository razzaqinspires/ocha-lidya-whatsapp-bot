import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pluginPath = path.join(root, '.private/ocha-private-runtime/src/plugins/owner/message-lab.js');
const catalogPath = path.join(root, 'src/plugins/owner/message-test-catalog.js');
const hasPrivateSource = fs.existsSync(pluginPath);
const source = hasPrivateSource ? fs.readFileSync(pluginPath, 'utf8') : '';
const catalogSource = fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath, 'utf8') : '';
const combinedSource = `${source}\n${catalogSource}`;
const fixtureDir = path.join(root, 'assets/message-test');

test('private message test lab remains owner-only and private-only', { skip: !hasPrivateSource }, () => {
  assert.match(source, /name:\s*'test'/);
  assert.match(source, /ownerOnly:\s*true/);
  assert.match(source, /privateOnly:\s*true/);
  assert.match(combinedSource, /\.test select \$\{item\.number\}/);
  assert.match(combinedSource, /\.test page 2/);
  assert.match(combinedSource, /number: 16/);
  assert.match(source, /runNumberedTest/);
  assert.match(combinedSource, /\.test select all/);
  assert.match(combinedSource, /NUMBERED_TESTS/);
  assert.doesNotMatch(combinedSource, /Hasil Native Flow Test|terkirim ke relay/);
});

test('message test lab fixtures exist locally and cover the predefined media pack', () => {
  const names = [
    'sample-image.png',
    'sample-video.mp4',
    'sample-audio.wav',
    'sample-document.pdf',
    'sample-sticker.webp',
    'carousel-01.png',
    'carousel-02.png',
  ];
  for (const name of names) {
    const fullPath = path.join(fixtureDir, name);
    assert.ok(fs.existsSync(fullPath), `missing fixture ${name}`);
    assert.ok(fs.statSync(fullPath).size > 100, `fixture ${name} looks empty`);
  }
  if (hasPrivateSource) assert.match(source, /assets',\s*'message-test/);
});

test('message test lab remains an internal private-runtime capability in the public source tree', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/plugins/owner/message-lab.js')), false);
});
