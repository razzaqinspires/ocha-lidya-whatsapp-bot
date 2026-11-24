import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';

test('verified website slot is claimed on publish; public page and editor session are protected', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-website-flow-'));
  process.chdir(temp);
  try {
    const { initializeDatabase } = await import(pathToFileURL(path.resolve(original, 'src/core/database.js')));
    const { getRecord, putRecord } = await import(pathToFileURL(path.resolve(original, 'src/core/repository.js')));
    const {
      createWebsiteSite, publishWebsiteSite, getPublicWebsiteResource,
      createWebsiteEditorSession, handleWebsiteEditorRequest, handleWebsitePublicRequest, updateWebsiteSite, createWebsitePost
    } = await import(pathToFileURL(path.resolve(original, 'src/rental/website-sites.js')));
    await initializeDatabase();
    const owner = '628123456789@s.whatsapp.net';
    await putRecord('website.verification', owner, {
      ownerJid: owner, verified: true, badge: 'blue-check',
      websiteSlotsGranted: 1, websiteSlotsUsed: 0, verifiedAt: new Date().toISOString()
    });

    const draft = await createWebsiteSite(owner, { template: 'agency', slug: 'agency-flow', title: 'Studio Contoh' });
    assert.equal(draft.status, 'draft');
    assert.equal((await getRecord('website.verification', owner)).websiteSlotsUsed, 0);

    await updateWebsiteSite(owner, draft.slug, { tagline: 'Karya digital profesional' });
    const video = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(12)]);
    const postResult = await createWebsitePost(owner, draft.slug, { caption: 'Video portofolio', media: video });
    assert.equal(postResult.site.assets[0].mime, 'video/mp4');
    const published = await publishWebsiteSite(owner, draft.slug, 'https://example.trycloudflare.com');
    assert.equal(published.status, 'published');
    assert.match(published.publicUrl, /^https:\/\/example\.trycloudflare\.com\/w\/agency-flow\//);
    assert.equal((await getRecord('website.verification', owner)).websiteSlotsUsed, 1);

    const token = published.publicUrl.split('/').at(-1);
    const publicPage = await getPublicWebsiteResource(draft.slug, token);
    assert.equal(publicPage.status, 200);
    assert.match(publicPage.body.toString(), /Karya digital profesional/);
    assert.match(publicPage.body.toString(), /<video class=\"post-media\"/);
    const mediaResource = await getPublicWebsiteResource(draft.slug, token, `assets/${postResult.site.assets[0].fileName}`);
    assert.equal(mediaResource.status, 200);
    assert.equal(mediaResource.contentType, 'video/mp4');
    const captureHttp = () => {
      const result = { status: 0, headers: {}, body: Buffer.alloc(0) };
      result.res = {
        writeHead(status, headers = {}) { result.status = status; result.headers = headers; },
        end(body = Buffer.alloc(0)) { result.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body)); }
      };
      return result;
    };
    const rangeResponse = captureHttp();
    await handleWebsitePublicRequest({ method: 'GET', headers: { range: 'bytes=4-11' } }, rangeResponse.res, new URL(published.publicUrl + `/assets/${postResult.site.assets[0].fileName}`));
    assert.equal(rangeResponse.status, 206);
    assert.equal(rangeResponse.headers['Content-Range'], 'bytes 4-11/24');
    assert.equal(rangeResponse.body.length, 8);
    const denied = await getPublicWebsiteResource(draft.slug, 'A'.repeat(43));
    assert.equal(denied.status, 404);

    const editorUrl = await createWebsiteEditorSession(owner, draft.slug, 'https://example.trycloudflare.com');
    const editorToken = editorUrl.split('#')[1];
    const capture = () => {
      const result = { status: 0, headers: {}, body: '' };
      result.res = {
        writeHead(status, headers = {}) { result.status = status; result.headers = headers; },
        end(body = '') { result.body = String(body); }
      };
      return result;
    };
    const valid = capture();
    await handleWebsiteEditorRequest({ method: 'GET', headers: { host: 'example.trycloudflare.com', origin: 'https://example.trycloudflare.com', authorization: `Bearer ${editorToken}` }, url: `/editor-api/${draft.slug}` }, valid.res, new URL(`https://example.trycloudflare.com/editor-api/${draft.slug}`));
    assert.equal(valid.status, 200);
    assert.equal(JSON.parse(valid.body).site.slug, draft.slug);

    const crossOrigin = capture();
    await handleWebsiteEditorRequest({ method: 'GET', headers: { host: 'example.trycloudflare.com', origin: 'https://attacker.example', authorization: `Bearer ${editorToken}` }, url: `/editor-api/${draft.slug}` }, crossOrigin.res, new URL(`https://example.trycloudflare.com/editor-api/${draft.slug}`));
    assert.equal(crossOrigin.status, 401);

    await assert.rejects(createWebsiteSite(owner, { template: 'business', slug: 'second-site' }), /slot|satu website/i);
  } finally {
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
