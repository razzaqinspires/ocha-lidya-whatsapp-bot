import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
}

function waitForClose(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 1500);
    child.once('close', () => { clearTimeout(timer); resolve(); });
  });
}

test('failed Code Lab handoff rolls gateway ownership back to the still-running process', async () => {
  const previousCwd = process.cwd();
  const previousHostMarker = process.env.OCHA_HOST_PREFLIGHT_COMPLETED;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-code-lab-handoff-rollback-'));
  process.chdir(temp);
  process.env.OCHA_HOST_PREFLIGHT_COMPLETED = '1';
  const config = await import(pathToFileURL(path.join(projectRoot, 'src/config.js')).href);
  const codeLab = await import(pathToFileURL(path.join(projectRoot, 'src/runtime/code-lab.js')).href);
  let replacement;
  try {
    await config.loadConfig();
    const tempDir = path.join(temp, 'runtime');
    await config.updateConfig(current => {
      current.codeLab.enabled = true;
      current.codeLab.publicTunnelEnabled = false;
      current.codeLab.port = 18891;
      current.codeLab.tempDir = tempDir;
    }, { actor: 'test', reason: 'handoff rollback test' });

    const boot = await codeLab.startCodeLab();
    assert.notEqual(boot.gateway, 'offline');
    const instanceId = `main-${crypto.createHash('sha256').update(`${path.resolve(temp)}:${path.resolve(tempDir)}`).digest('hex').slice(0, 14)}`;
    const instanceDir = path.join(tempDir, `instance-${instanceId}`);
    await fs.mkdir(instanceDir, { recursive: true });
    // This PID is alive but is deliberately not a Code Lab watchdog. Handoff
    // must reject it after gateway close, then cancellation must restore service.
    await fs.writeFile(path.join(instanceDir, 'watchdog.json'), JSON.stringify({ pid: process.pid, protocolVersion: 2 }));

    replacement = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: temp,
      stdio: 'ignore',
      windowsHide: true
    });
    await waitForSpawn(replacement);

    await assert.rejects(codeLab.prepareCodeLabHandoff(replacement.pid), /tidak dapat diverifikasi sebagai Code Lab watchdog/);
    try { replacement.kill('SIGTERM'); } catch {}
    await waitForClose(replacement);
    if (replacement.exitCode === null && replacement.signalCode === null) {
      try { replacement.kill('SIGKILL'); } catch {}
    }

    const rollback = await codeLab.cancelCodeLabHandoff();
    assert.equal(rollback.restored, true);
    assert.equal(rollback.gatewayListening, true);
    assert.notEqual(codeLab.getCodeLabStatus().gateway, 'offline');
  } finally {
    if (replacement && replacement.exitCode === null && replacement.signalCode === null) {
      try { replacement.kill('SIGKILL'); } catch {}
    }
    await codeLab.stopCodeLab().catch(() => {});
    process.chdir(previousCwd);
    if (previousHostMarker === undefined) delete process.env.OCHA_HOST_PREFLIGHT_COMPLETED;
    else process.env.OCHA_HOST_PREFLIGHT_COMPLETED = previousHostMarker;
    await fs.rm(temp, { recursive: true, force: true });
  }
});
