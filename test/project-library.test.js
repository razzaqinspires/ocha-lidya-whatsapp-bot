import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  listUserProjects,
  getWebsiteProject,
  getActiveWebsiteProject,
  saveWebsiteProject,
  getProjectExportPreference,
  setProjectExportPreference,
  createProjectArchive,
  removeProjectArchive,
  getProjectHistory,
  getProjectLibraryStatus,
  projectUserKey
} from '../src/ai/project-library.js';

async function zipEntries(file) {
  return execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
}

test('Project Library isolates user repositories, preserves task memory, versions updates, and exports only the selected repo', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-project-library-'));
  const previousRoot = process.env.OCHA_PROJECT_LIBRARY_ROOT;
  process.env.OCHA_PROJECT_LIBRARY_ROOT = path.join(root, 'library');
  const ownerA = '6281111111111@s.whatsapp.net';
  const ownerB = '6282222222222@s.whatsapp.net';
  try {
    const first = await saveWebsiteProject({
      ownerId: ownerA,
      chatId: 'chat-a',
      title: 'Toko Online Aruna',
      summary: 'Etalase dan katalog produk.',
      files: {
        'index.html': '<!doctype html><html><body><h1>Aruna</h1></body></html>',
        'assets/site.css': 'body{font-family:system-ui}',
        'assets/site.js': 'window.shopReady=true'
      },
      projectMemory: {
        summary: 'Toko online statis untuk katalog.',
        architecture: 'HTML + CSS + JavaScript modular.',
        features: ['Product catalog', 'Responsive layout'],
        decisions: ['No external CDN'],
        nextSteps: ['Add cart interaction']
      },
      task: 'Buat website toko online Aruna'
    });

    assert.equal(first.version, 1);
    assert.equal(first.slug, 'toko-online-aruna');
    assert.ok(first.path.startsWith(path.join(process.env.OCHA_PROJECT_LIBRARY_ROOT, projectUserKey(ownerA))));
    assert.equal((await listUserProjects({ ownerId: ownerB })).length, 0);
    const isolatedStatus = await getProjectLibraryStatus({ ownerId: ownerA });
    assert.equal(isolatedStatus.projects, 1);
    assert.ok(isolatedStatus.storageBytes >= first.totalBytes);
    assert.equal(isolatedStatus.maxStorageBytes > isolatedStatus.storageBytes, true);
    assert.equal(Object.hasOwn(isolatedStatus, 'root'), false);
    assert.equal(await getWebsiteProject({ ownerId: ownerB, projectId: first.projectId }), null);

    const selectedMeta = await getWebsiteProject({ ownerId: ownerA, projectId: first.projectId, includeFiles: false });
    assert.equal(selectedMeta.files, undefined);
    assert.equal(Array.isArray(selectedMeta.fileManifest), true);
    const activeMeta = await getActiveWebsiteProject({ ownerId: ownerA, chatId: 'chat-a', includeFiles: false });
    assert.equal(activeMeta.projectId, first.projectId);
    assert.equal(activeMeta.files, undefined);
    const active = await getActiveWebsiteProject({ ownerId: ownerA, chatId: 'chat-a' });
    assert.equal(active.files['assets/site.js'], 'window.shopReady=true');

    const updated = await saveWebsiteProject({
      ownerId: ownerA,
      chatId: 'chat-a',
      projectId: first.projectId,
      title: 'Toko Online Aruna',
      summary: 'Katalog dan keranjang demo.',
      files: {
        'index.html': '<!doctype html><html><body><h1>Aruna Shop</h1></body></html>',
        'assets/site.css': 'body{font-family:system-ui;color:#222}',
        'assets/site.js': 'window.shopReady=true;window.cartReady=true',
        'assets/cart.js': 'export const cart=[]'
      },
      projectMemory: {
        summary: 'Toko online dengan katalog dan keranjang demo.',
        features: ['Product catalog', 'Responsive layout', 'Cart demo'],
        decisions: ['No external CDN'],
        nextSteps: ['Connect a real backend later']
      },
      task: 'Tambahkan keranjang belanja demo dan pertahankan katalog'
    });
    assert.equal(updated.version, 2);
    assert.equal(updated.projectId, first.projectId);
    assert.equal(updated.files['assets/cart.js'], 'export const cart=[]');
    assert.ok(updated.gitEnabled === true || updated.gitEnabled === false);
    assert.equal((await getProjectHistory({ ownerId: ownerA, projectId: first.projectId })).some(item => item.version === 1), true);

    assert.equal(await getProjectExportPreference({ ownerId: ownerA }), 'ask');
    await setProjectExportPreference({ ownerId: ownerA, mode: 'always' });
    assert.equal(await getProjectExportPreference({ ownerId: ownerA }), 'always');
    assert.equal(await getProjectExportPreference({ ownerId: ownerB }), 'ask');

    const archive = await createProjectArchive({ ownerId: ownerA, projectId: first.projectId });
    try {
      const names = await zipEntries(archive.path);
      assert.ok(names.includes('toko-online-aruna/index.html'));
      assert.ok(names.includes('toko-online-aruna/assets/cart.js'));
      assert.ok(names.includes('toko-online-aruna/README.md'));
      assert.equal(names.some(name => name.includes('.git/') || name.includes('.control') || name.includes('.history') || name.includes('.env')), false);
      assert.equal(names.some(name => name.startsWith('library/')), false);
    } finally {
      await removeProjectArchive(archive.path);
    }
  } finally {
    if (previousRoot === undefined) delete process.env.OCHA_PROJECT_LIBRARY_ROOT;
    else process.env.OCHA_PROJECT_LIBRARY_ROOT = previousRoot;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Project Library rejects traversal and secret material before writing a repository', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-project-safety-'));
  const previousRoot = process.env.OCHA_PROJECT_LIBRARY_ROOT;
  process.env.OCHA_PROJECT_LIBRARY_ROOT = root;
  try {
    await assert.rejects(saveWebsiteProject({
      ownerId: 'user-safety@s.whatsapp.net',
      title: 'Unsafe',
      files: { '../outside.html': '<h1>bad</h1>', 'index.html': '<h1>ok</h1>' }
    }), /Path repository tidak aman/);
    await assert.rejects(saveWebsiteProject({
      ownerId: 'user-safety@s.whatsapp.net',
      title: 'Secret',
      files: { 'index.html': '<h1>ok</h1>', 'assets/app.js': 'const x="ghp_abcdefghijklmnopqrstuvwxyz0123456789";' }
    }), /secret/i);
    assert.equal((await listUserProjects({ ownerId: 'user-safety@s.whatsapp.net' })).length, 0);
  } finally {
    if (previousRoot === undefined) delete process.env.OCHA_PROJECT_LIBRARY_ROOT;
    else process.env.OCHA_PROJECT_LIBRARY_ROOT = previousRoot;
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('Project Library export rechecks edited files and refuses obvious secret leakage', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-project-export-secret-'));
  const previousRoot = process.env.OCHA_PROJECT_LIBRARY_ROOT;
  process.env.OCHA_PROJECT_LIBRARY_ROOT = path.join(root, 'library');
  try {
    const project = await saveWebsiteProject({
      ownerId: '6283333333333@s.whatsapp.net',
      title: 'Private Catalog',
      files: { 'index.html': '<h1>Private</h1>' }
    });
    await fs.writeFile(path.join(project.path, 'index.html'), '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----');
    await assert.rejects(createProjectArchive({ ownerId: '6283333333333@s.whatsapp.net', projectId: project.projectId }), /kredensial terdeteksi/i);
  } finally {
    if (previousRoot === undefined) delete process.env.OCHA_PROJECT_LIBRARY_ROOT;
    else process.env.OCHA_PROJECT_LIBRARY_ROOT = previousRoot;
    await fs.rm(root, { recursive: true, force: true });
  }
});
