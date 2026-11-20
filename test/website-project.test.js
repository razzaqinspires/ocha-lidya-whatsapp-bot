import test from 'node:test';
import assert from 'node:assert/strict';
import { isWebsiteBuildIntent, normalizeWebsiteProject, auditWebsiteProjectFiles, createWebsiteGenerationMessages, runWebsiteBuildSlot, getWebsiteBuildQueueStatus } from '../src/ai/website-project.js';

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
  assert.throws(() => normalizeWebsiteProject({ files: [{ path: 'server.php', content: 'x' }, { path: 'index.html', content: 'ok' }] }), /Path file website tidak aman/);
  assert.throws(() => normalizeWebsiteProject({ files: [{ path: 'about.html', content: 'x' }] }), /wajib memiliki index.html/);
});

test('website manifest enforces per-file and total size limits', () => {
  assert.throws(() => normalizeWebsiteProject({ files: [{ path: 'index.html', content: 'x'.repeat(513 * 1024) }] }), /melewati batas/);
  assert.throws(() => normalizeWebsiteProject({ files: [
    { path: 'index.html', content: 'x'.repeat(400 * 1024) },
    ...Array.from({ length: 10 }, (_, index) => ({ path: `assets/part-${index}.css`, content: 'x'.repeat(400 * 1024) }))
  ] }), /Total file website/);
});

test('website generation prompt demands a static, offline-safe multi-file manifest', () => {
  const messages = createWebsiteGenerationMessages('Buat landing page', [{ role: 'user', content: 'Perusahaan X' }]);
  assert.match(messages[0].content, /JSON valid saja/);
  assert.match(messages[0].content, /Preview CSP memblokir koneksi keluar/);
  assert.match(messages.at(-1).content, /Buat repository website baru berdasarkan tugas/);
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
  assert.deepEqual(getWebsiteBuildQueueStatus(), { active: 0, queued: 0, usersActive: 0 });
});


test('incremental website revisions preserve untouched files and project memory', () => {
  const existing = {
    title: 'Toko Aruna', summary: 'Katalog awal',
    files: { 'index.html': '<h1>Old</h1>', 'assets/site.css': 'body{}', 'assets/cart.js': 'const cart=[];' },
    projectMemory: { summary: 'Shop', architecture: 'HTML CSS JS', features: ['Catalog'], decisions: ['No CDN'], nextSteps: ['Cart'] }
  };
  const updated = normalizeWebsiteProject({
    title: 'Toko Aruna',
    summary: 'Katalog dengan cart',
    changes: [
      { path: 'index.html', content: '<h1>New</h1>' },
      { path: 'assets/cart.js', content: 'const cart=[]; window.cartReady=true;' }
    ],
    deletedFiles: [],
    projectMemory: { summary: 'Shop with cart', features: ['Catalog', 'Cart'], decisions: ['No CDN'], nextSteps: ['Checkout demo'] }
  }, existing);
  assert.equal(updated.files['assets/site.css'], 'body{}', 'untouched source file must be preserved');
  assert.match(updated.files['assets/cart.js'], /cartReady/);
  assert.equal(updated.projectMemory.features.includes('Catalog'), true);
  assert.equal(updated.projectMemory.nextSteps[0], 'Checkout demo');
});

test('incremental website revision requires a valid root index after deletions', () => {
  assert.throws(() => normalizeWebsiteProject({ changes: [], deletedFiles: ['index.html'] }, {
    files: { 'index.html': '<h1>old</h1>', 'a.css': 'body{}' }
  }), /wajib memiliki index.html/);
});

test('website build queue applies per-user concurrency fairness', async () => {
  let releaseA;
  let releaseB;
  const a1 = runWebsiteBuildSlot(async () => new Promise(resolve => { releaseA = resolve; }), {
    concurrency: 2, queueLimit: 4, userKey: 'user-a', perUserConcurrency: 1, perUserQueueLimit: 1
  });
  const a2 = runWebsiteBuildSlot(async () => 'a2', {
    concurrency: 2, queueLimit: 4, userKey: 'user-a', perUserConcurrency: 1, perUserQueueLimit: 1
  });
  const b1 = runWebsiteBuildSlot(async () => new Promise(resolve => { releaseB = resolve; }), {
    concurrency: 2, queueLimit: 4, userKey: 'user-b', perUserConcurrency: 1, perUserQueueLimit: 1
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(getWebsiteBuildQueueStatus().active, 2);
  assert.equal(getWebsiteBuildQueueStatus().queued, 1);
  await assert.rejects(runWebsiteBuildSlot(async () => 'a3', {
    concurrency: 2, queueLimit: 4, userKey: 'user-a', perUserConcurrency: 1, perUserQueueLimit: 1
  }), /kuota antrean/i);
  releaseA('a1');
  releaseB('b1');
  assert.deepEqual(await Promise.all([a1, a2, b1]), ['a1', 'a2', 'b1']);
});


test('website static audit rejects missing local assets, remote assets, package imports and outbound browser APIs', () => {
  const valid = {
    'index.html': '<link rel="stylesheet" href="assets/site.css"><script type="module" src="assets/app.js"></script><img src="assets/logo.svg">',
    'assets/site.css': 'body{background:url("../assets/logo.svg")}',
    'assets/app.js': "import { cart } from './cart.js'; console.log(cart);",
    'assets/cart.js': 'export const cart=[];',
    'assets/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
  };
  assert.deepEqual(auditWebsiteProjectFiles(valid), []);
  const missing = auditWebsiteProjectFiles({
    'index.html': '<script src="https://cdn.example/app.js"></script><img src="assets/missing.svg">',
    'assets/app.js': "import React from 'react'; fetch('/api/products');"
  });
  assert.ok(missing.some(issue => /resource eksternal/.test(issue)));
  assert.ok(missing.some(issue => /tidak menemukan file/.test(issue)));
  assert.ok(missing.some(issue => /bukan modul lokal/.test(issue)));
  assert.ok(missing.some(issue => /API jaringan/.test(issue)));
  assert.throws(() => normalizeWebsiteProject({ files: [
    { path: 'index.html', content: '<img src="assets/nope.svg">' }
  ] }), /Audit referensi website/);
});
