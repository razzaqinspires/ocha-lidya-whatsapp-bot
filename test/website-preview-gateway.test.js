import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
  const processLog = path.join(temp, 'cloudflared-processes.log');
  await fs.writeFile(cloudflared, `#!/usr/bin/env node\nconst fs = require('node:fs');\nif (process.argv[2] === '--version') { console.log('cloudflared version test'); process.exit(0); }\nfs.appendFileSync(${JSON.stringify(processLog)}, 'START ' + process.pid + '\\n');\nconsole.error('https://test-preview.trycloudflare.com');\nconst stop = () => { fs.appendFileSync(${JSON.stringify(processLog)}, 'STOP ' + process.pid + '\\n'); process.exit(0); };\nprocess.on('SIGTERM', stop); process.on('SIGINT', stop);\nsetInterval(() => {}, 1000);\n`, { mode: 0o755 });
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
      current.codeLab.tunnelIdleMs = 150;
      current.codeLab.maxSessionsTotal = 20;
    }, { actor: 'test', reason: 'website gateway integration' });

    const boot = await codeLab.startCodeLab();
    assert.equal(boot.tunnel, 'idle/on-demand', 'bot startup must not launch cloudflared');
    await assert.rejects(fs.access(processLog), { code: 'ENOENT' }, 'no tunnel process exists before a preview is requested');

    const files = {
      'index.html': '<!doctype html><html><head><link rel="stylesheet" href="assets/site.css"></head><body><h1>Gateway works</h1><script src="assets/site.js"></script></body></html>',
      'assets/site.css': 'body{color:#123}',
      'assets/site.js': 'window.ready=true'
    };
    const sites = await Promise.all(Array.from({ length: 8 }, (_, index) => codeLab.createWebsiteSession({
      ownerId: index === 0 ? '6281111111111@s.whatsapp.net' : `628111111112${index}@s.whatsapp.net`, chatId: index === 0 ? '6281111111111@s.whatsapp.net' : `628111111112${index}@s.whatsapp.net`,
      title: index === 0 ? 'Gateway Test' : `Parallel Gateway ${index}`, summary: 'Static test site', files
    })));
    const site = sites[0];
    const tunnelLog = await fs.readFile(processLog, 'utf8');
    const tunnelPids = [...tunnelLog.matchAll(/^START (\d+)$/gm)].map(match => Number(match[1]));
    assert.equal(tunnelPids.length, 1, 'parallel preview requests must share exactly one cloudflared process');
    const status = codeLab.getCodeLabStatus();
    assert.equal(status.activeSessions, 8);
    assert.equal(status.tunnel, 'https://test-preview.trycloudflare.com');
    assert.equal(status.tunnelPid, Number(tunnelPids[0]));
    assert.equal(status.tunnelGeneration, 1);
    assert.ok(sites.every(item => new URL(item.previewUrl).origin === new URL(site.previewUrl).origin), 'all sessions share one public tunnel hostname');

    const childScript = `
      import { pathToFileURL } from 'node:url';
      const root = ${JSON.stringify(original)};
      const temp = ${JSON.stringify(temp)};
      const config = await import(pathToFileURL(root + '/src/config.js'));
      const lab = await import(pathToFileURL(root + '/src/runtime/code-lab.js'));
      await config.loadConfig();
      await config.updateConfig(current => {
        current.codeLab.enabled = true;
        current.codeLab.publicTunnelEnabled = true;
        current.codeLab.websiteBuilderEnabled = true;
        current.codeLab.aiExecutionEnabled = true;
        current.codeLab.cloudflaredBin = ${JSON.stringify(cloudflared)};
        current.codeLab.port = 18880;
        current.codeLab.tempDir = temp + '/runtime';
      }, { actor: 'lease-test', reason: 'cross-process tunnel lock test' });
      try {
        await lab.createWebsiteSession({ ownerId: 'second-process@s.whatsapp.net', files: { 'index.html': '<h1>second</h1>' } });
        console.log('LOCK_RESULT:UNEXPECTED_START');
      } catch (error) {
        console.log('LOCK_RESULT:' + error.message);
      } finally {
        await lab.stopCodeLab();
      }
    `;
    const competing = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
      cwd: temp, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, PATH: `${binaryDir}:${previousPath || ''}` }
    });
    assert.equal(competing.status, 0, competing.stderr || competing.stdout);
    assert.match(competing.stdout, /LOCK_RESULT:Quick Tunnel (?:masih aktif|sedang disiapkan)/);
    assert.equal([...((await fs.readFile(processLog, 'utf8')).matchAll(/^START (\d+)$/gm))].length, 1, 'a second Node process sharing the runtime directory must not spawn another cloudflared');
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

    const stopResponses = await Promise.all(sites.map(item => {
      const pathname = new URL(item.previewUrl).pathname;
      const [, , id, token] = pathname.split('/');
      return fetch(`http://127.0.0.1:${port}/api/s/${id}/${token}/stop`, { method: 'POST' });
    }));
    assert.ok(stopResponses.every(response => response.status === 200));
    const idleDeadline = Date.now() + 3000;
    while (Date.now() < idleDeadline && codeLab.getCodeLabStatus().tunnelPid) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(codeLab.getCodeLabStatus().tunnel, 'idle/on-demand', 'idle tunnel is terminated when no preview sessions remain');
    assert.equal(codeLab.getCodeLabStatus().tunnelPid, null);
    assert.throws(() => process.kill(Number(tunnelPids[0]), 0), { code: 'ESRCH' }, 'the cloudflared process must really be gone');
    await assert.rejects(fs.access(path.join(temp, 'runtime', '.cloudflared-quick-tunnel.lock')), { code: 'ENOENT' });
    assert.equal([...((await fs.readFile(processLog, 'utf8')).matchAll(/^START (\d+)$/gm))].length, 1, 'idle stop must not create a replacement process');

    // An unexpected child exit revokes all sessions and releases the lease
    // before a later user request may publish a replacement URL.
    const interrupted = await codeLab.createWebsiteSession({ ownerId: 'interrupted@s.whatsapp.net', files: { 'index.html': '<h1>interrupted</h1>' } });
    const beforeCrashLog = await fs.readFile(processLog, 'utf8');
    const allPidsBeforeCrash = [...beforeCrashLog.matchAll(/^START (\d+)$/gm)].map(match => Number(match[1]));
    assert.equal(allPidsBeforeCrash.length, 2);
    const crashedPid = allPidsBeforeCrash[1];
    process.kill(crashedPid, 'SIGKILL');
    const crashDeadline = Date.now() + 5000;
    while (Date.now() < crashDeadline) {
      const current = codeLab.getCodeLabStatus();
      const leaseExists = await fs.access(path.join(temp, 'runtime', '.cloudflared-quick-tunnel.lock')).then(() => true, () => false);
      if (current.tunnelPid === null && current.activeSessions === 0 && !leaseExists) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(codeLab.getCodeLabStatus().activeSessions, 0, 'unexpected tunnel exit revokes sessions tied to the old URL');
    assert.equal(codeLab.getCodeLabStatus().tunnelPid, null);
    assert.throws(() => process.kill(crashedPid, 0), { code: 'ESRCH' });
    await new Promise(resolve => setTimeout(resolve, 2100), 'allow the bounded reconnect backoff to elapse');
    const recovered = await codeLab.createWebsiteSession({ ownerId: 'recovered@s.whatsapp.net', files: { 'index.html': '<h1>recovered</h1>' } });
    assert.equal(codeLab.getCodeLabStatus().tunnelGeneration, 3);
    assert.equal(new URL(recovered.previewUrl).origin, new URL(interrupted.previewUrl).origin, 'the fake tunnel returns the same test origin after process recovery');
    const allPidsAfterRecovery = [...((await fs.readFile(processLog, 'utf8')).matchAll(/^START (\d+)$/gm))].map(match => Number(match[1]));
    assert.equal(allPidsAfterRecovery.length, 3, 'a fresh process is created only after the previous PID has exited and its lock is released');
    const recoveredPath = new URL(recovered.previewUrl).pathname;
    const [, , recoveredId, recoveredToken] = recoveredPath.split('/');
    await fetch(`http://127.0.0.1:${port}/api/s/${recoveredId}/${recoveredToken}/stop`, { method: 'POST' });
    const finalIdleDeadline = Date.now() + 3000;
    while (Date.now() < finalIdleDeadline && codeLab.getCodeLabStatus().tunnelPid) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(codeLab.getCodeLabStatus().tunnelPid, null, 'recovered tunnel is also stopped after its final session is removed');
  } finally {
    await codeLab.stopCodeLab().catch(() => {});
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
