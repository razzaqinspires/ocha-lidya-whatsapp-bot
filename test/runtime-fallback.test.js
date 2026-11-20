import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = process.cwd();

test('Code Lab auto runtime falls back to Podman when the Docker daemon is unavailable', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-runtime-fallback-'));
  const fakeBin = path.join(temp, 'bin');
  await fs.mkdir(fakeBin, { recursive: true });
  const dockerLog = path.join(temp, 'docker.log');
  const podmanLog = path.join(temp, 'podman.log');
  await fs.writeFile(path.join(fakeBin, 'docker'), `#!/bin/sh\necho "$*" >> ${JSON.stringify(dockerLog)}\necho "daemon unavailable" >&2\nexit 1\n`, { mode: 0o700 });
  await fs.writeFile(path.join(fakeBin, 'podman'), `#!/bin/sh\necho "$*" >> ${JSON.stringify(podmanLog)}\ncase "$1" in info|pull) exit 0 ;; image) exit 0 ;; *) exit 0 ;; esac\n`, { mode: 0o700 });
  const configUrl = pathToFileURL(path.join(root, 'src/config.js')).href;
  const dbUrl = pathToFileURL(path.join(root, 'src/core/database.js')).href;
  const codeLabUrl = pathToFileURL(path.join(root, 'src/runtime/code-lab.js')).href;
  const source = `
    const db = await import(${JSON.stringify(dbUrl)}); await db.initializeDatabase();
    const config = await import(${JSON.stringify(configUrl)}); await config.loadConfig();
    const net = await import('node:net');
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port; await new Promise(resolve => server.close(resolve));
    await config.updateConfig(c => { c.codeLab.enabled = true; c.codeLab.containerRuntime = 'auto'; c.codeLab.port = port; c.codeLab.tempDir = ${JSON.stringify(path.join(temp, 'runtime'))}; });
    const lab = await import(${JSON.stringify(codeLabUrl)});
    const status = await lab.startCodeLab();
    console.log('RUNTIME_RESULT:' + JSON.stringify({ runtimeReady: status.runtimeReady, runtime: status.runtime, preference: status.runtimePreference, tunnelPid: status.tunnelPid, tunnel: status.tunnel }));
    await lab.stopCodeLab();
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: temp,
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH || ''}` }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('RUNTIME_RESULT:'));
    assert.ok(line, result.stdout);
    const status = JSON.parse(line.slice('RUNTIME_RESULT:'.length));
    assert.equal(status.runtimeReady, true);
    assert.equal(status.runtime, 'podman');
    assert.equal(status.preference, 'auto');
    assert.equal(status.tunnelPid, null, 'runtime bootstrap must not start a Cloudflare tunnel at bot startup');
    assert.match(status.tunnel, /idle\/on-demand/);
    assert.match(await fs.readFile(dockerLog, 'utf8'), /info/);
    const podmanCalls = await fs.readFile(podmanLog, 'utf8');
    assert.match(podmanCalls, /info/);
    assert.match(podmanCalls, /image inspect python:3\.12-alpine/);
    assert.match(podmanCalls, /image inspect node:22-alpine/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
