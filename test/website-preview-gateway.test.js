import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('website project is served by the shared gateway with token checks and local assets', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-website-gateway-test-'));
  process.chdir(temp);
  const configUrl = pathToFileURL(path.resolve(original, 'src/config.js')).href;
  const config = await import(configUrl);
  const codeLabUrl = pathToFileURL(path.resolve(original, 'src/runtime/code-lab.js')).href;
  const codeLab = await import(codeLabUrl);
  const binaryDir = path.join(temp, 'bin');
  await fs.mkdir(binaryDir, { recursive: true });
  const cloudflared = path.join(binaryDir, 'cloudflared-test');
  await fs.writeFile(cloudflared, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "cloudflared version test"; exit 0; fi\necho "https://test-preview.trycloudflare.com"\nexec sleep 600\n', { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${binaryDir}:${previousPath || ''}`;
  try {
    await config.loadConfig();
    await config.updateConfig(current => {
      current.codeLab.enabled = true;
      current.codeLab.publicTunnelEnabled = true;
      current.codeLab.websiteBuilderEnabled = true;
      current.codeLab.aiExecutionEnabled = true;
      current.codeLab.cloudflaredBin = cloudflared;
      current.codeLab.port = 18879;
      current.codeLab.tempDir = path.join(temp, 'runtime');
      current.codeLab.ttlMs = 3600000;
    }, { actor: 'test', reason: 'website gateway integration' });
    const site = await codeLab.createWebsiteSession({
      ownerId: '6281111111111@s.whatsapp.net', chatId: '6281111111111@s.whatsapp.net',
      title: 'Gateway Test', summary: 'Static test site',
      files: {
        'index.html': '<!doctype html><html><head><link rel="stylesheet" href="assets/site.css"></head><body><h1>Gateway works</h1><script src="assets/site.js"></script></body></html>',
        'assets/site.css': 'body{color:#123}',
        'assets/site.js': 'window.ready=true'
      }
    });
    const status = codeLab.getCodeLabStatus();
    assert.equal(status.activeSessions, 1);
    assert.equal(status.tunnel, 'https://test-preview.trycloudflare.com');
    const port = Number(status.gateway.split(':').at(-1));
    const previewPath = new URL(site.previewUrl).pathname;
    const root = await fetch(`http://127.0.0.1:${port}${previewPath}`);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /Gateway Test/);
    assert.match(root.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);

    const [, , id, token] = previewPath.split('/');
    const html = await fetch(`http://127.0.0.1:${port}/project/${id}/${token}/index.html`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /Gateway works/);
    const css = await fetch(`http://127.0.0.1:${port}/project/${id}/${token}/assets/site.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type') || '', /text\/css/);
    assert.equal(await css.text(), 'body{color:#123}');
    const latest = codeLab.getLatestWebsiteProject({ ownerId: '6281111111111@s.whatsapp.net', chatId: '6281111111111@s.whatsapp.net' });
    assert.equal(latest.id, site.id);
    latest.files['assets/site.css'] = 'body{color:#05f}';
    const updated = await codeLab.updateWebsiteSession({
      ownerId: '6281111111111@s.whatsapp.net', chatId: '6281111111111@s.whatsapp.net',
      sessionId: latest.id, title: 'Gateway Test Updated', summary: 'Updated static test site', files: latest.files
    });
    assert.equal(updated.previewUrl, site.previewUrl, 'website edits preserve the existing preview URL');
    assert.equal(updated.version, 2);
    const updatedCss = await fetch(`http://127.0.0.1:${port}/project/${id}/${token}/assets/site.css`);
    assert.equal(await updatedCss.text(), 'body{color:#05f}');
    await assert.rejects(codeLab.updateWebsiteSession({
      ownerId: '6282222222222@s.whatsapp.net', chatId: '6282222222222@s.whatsapp.net',
      sessionId: latest.id, title: 'Hijack', files: latest.files
    }), /tidak ditemukan atau bukan milik/);
    const invalid = await fetch(`http://127.0.0.1:${port}/project/${id}/${'A'.repeat(43)}/index.html`);
    assert.equal(invalid.status, 410);
    assert.equal(codeLab.getCodeLabStatus().activeWorkers, 0, 'static site does not consume an execution worker');
  } finally {
    await codeLab.stopCodeLab().catch(() => {});
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
