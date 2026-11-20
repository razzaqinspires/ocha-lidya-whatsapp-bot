import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [parentPidText, instanceId, instanceDir, runtime] = process.argv.slice(2);
const parentPid = Number(parentPidText);
if (!Number.isInteger(parentPid) || !instanceId || !instanceDir || !runtime) process.exit(2);
const heartbeat = path.join(instanceDir, 'heartbeat');
const shutdown = path.join(instanceDir, 'shutdown');
const tunnelPidFile = path.join(instanceDir, 'cloudflared.pid');
const staleAfterMs = 30_000;
const intervalMs = 2000;
let checking = false;

function processExists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

function cleanupOrphans() {
  try {
    const tunnelPid = Number(fs.readFileSync(tunnelPidFile, 'utf8'));
    if (Number.isInteger(tunnelPid) && tunnelPid > 1) process.kill(tunnelPid, 'SIGTERM');
  } catch {}
  try {
    const list = spawnSync(runtime, ['ps', '-aq', '--filter', `label=com.razzaq.ocha.codelab.instance=${instanceId}`], {
      encoding: 'utf8', timeout: 5000
    });
    const ids = String(list.stdout || '').split(/\s+/).filter(value => /^[a-f0-9]{12,64}$/i.test(value));
    if (ids.length) spawnSync(runtime, ['rm', '-f', ...ids], { stdio: 'ignore', timeout: 10_000 });
  } catch {}
  try { fs.rmSync(instanceDir, { recursive: true, force: true }); } catch {}
}

const timer = setInterval(() => {
  if (checking) return;
  checking = true;
  try {
    if (fs.existsSync(shutdown)) {
      clearInterval(timer);
      return;
    }
    let age = Infinity;
    try { age = Date.now() - fs.statSync(heartbeat).mtimeMs; } catch {}
    if (!processExists(parentPid) || age > staleAfterMs) {
      cleanupOrphans();
      clearInterval(timer);
    }
  } finally { checking = false; }
}, intervalMs);
