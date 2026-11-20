import test from 'node:test';
import assert from 'node:assert/strict';
import { isWebsiteBuildIntent, normalizeWebsiteProject, createWebsiteGenerationMessages, runWebsiteBuildSlot, getWebsiteBuildQueueStatus } from '../src/ai/website-project.js';

test('website build intent recognizes Indonesian website creation requests', () => {
  assert.equal(isWebsiteBuildIntent('Buatkan website toko online untuk Lumóra'), true);
  assert.equal(isWebsiteBuildIntent('Saya ingin membuat landing page perusahaan'), true);
  assert.equal(isWebsiteBuildIntent('Jelaskan apa itu website builder'), false);
});

test('website manifest accepts a bounded multi-file project', () => {
  const project = normalizeWebsiteProject({
    title: 'Contoh', summary: 'Demo', files: [
      { path: 'index.html', content: '<!doctype html><link rel="stylesheet" href="assets/site.css"><h1>Halo</h1>' },
      { path: 'assets/site.css', content: 'body{font-family:sans-serif}' },
      { path: 'assets/site.js', content: 'console.log("ok")' }
    ]
  });
  assert.equal(project.fileCount, 3);
  assert.equal(project.files['assets/site.css'], 'body{font-family:sans-serif}');
});

test('website manifest rejects traversal, hidden paths, unsupported extensions and missing index', () => {
  assert.throws(() => normalizeWebsiteProject({ files: [{ path: '../secret.txt', content: 'x' }] }), /Path file website tidak aman/);
  assert.throws(() => normalizeWebsiteProject({ files: [{ path: '.env', content: 'x' }, { path: 'index.html', content: 'ok' }] }), /Path file website tidak aman/);
  assert.throws(() => normalizeWebsiteProject({ files: [{ path: 'server.php', content: 'x' }, { path: 'index.html', content: 'ok' }] }), /Jenis atau panjang path/);
  assert.throws(() => normalizeWebsiteProject({ files: [{ path: 'about.html', content: 'x' }] }), /wajib memiliki index.html/);
});

test('website manifest enforces per-file and total size limits', () => {
  assert.throws(() => normalizeWebsiteProject({ files: [{ path: 'index.html', content: 'x'.repeat(65 * 1024) }] }), /melewati batas/);
  assert.throws(() => normalizeWebsiteProject({ files: [
    { path: 'index.html', content: 'x'.repeat(60 * 1024) },
    { path: 'a.css', content: 'x'.repeat(60 * 1024) },
    { path: 'b.css', content: 'x'.repeat(60 * 1024) },
    { path: 'c.css', content: 'x'.repeat(60 * 1024) },
    { path: 'd.css', content: 'x'.repeat(60 * 1024) }
  ] }), /Total file website/);
});

test('website generation prompt demands a static, offline-safe multi-file manifest', () => {
  const messages = createWebsiteGenerationMessages('Buat landing page', [{ role: 'user', content: 'Perusahaan X' }]);
  assert.match(messages[0].content, /JSON valid saja/);
  assert.match(messages[0].content, /connect-src/);
  assert.match(messages.at(-1).content, /Buat website berdasarkan/);
});


test('website build queue bounds concurrent generations and rejects overflow', async () => {
  let active = 0;
  let peak = 0;
  const gates = [];
  const tasks = Array.from({ length: 4 }, (_, index) => runWebsiteBuildSlot(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => gates[index] = resolve);
    active -= 1;
    return index;
  }, { concurrency: 2, queueLimit: 2 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(getWebsiteBuildQueueStatus().active, 2);
  assert.equal(getWebsiteBuildQueueStatus().queued, 2);
  await assert.rejects(runWebsiteBuildSlot(async () => 'overflow', { concurrency: 2, queueLimit: 2 }), /antrean.*penuh/i);
  gates[0]();
  await new Promise(resolve => setImmediate(resolve));
  gates[2]();
  await new Promise(resolve => setImmediate(resolve));
  gates[1]();
  await new Promise(resolve => setImmediate(resolve));
  gates[3]();
  assert.deepEqual(await Promise.all(tasks), [0, 1, 2, 3]);
  assert.equal(peak, 2);
  assert.deepEqual(getWebsiteBuildQueueStatus(), { active: 0, queued: 0 });
});
