import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [parentPidText, instanceId, instanceDir, runtime] = process.argv.slice(2);
const parentPid = Number(parentPidText);
if (!Number.isInteger(parentPid) || !instanceId || !instanceDir || !runtime) process.exit(2);
const heartbeat = path.join(instanceDir, 'heartbeat');
const shutdown = path.join(instanceDir, 'shutdown');
const tunnelPidFile = path.join(instanceDir, 'cloudflared.pid');
const tunnelLockFile = path.join(path.dirname(instanceDir), '.cloudflared-quick-tunnel.lock');
const staleAfterMs = 30_000;
const intervalMs = 2000;
let checking = false;

function processExists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

function inspectProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  if (process.platform !== 'linux') return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const commandLine = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim();
    const close = stat.lastIndexOf(')');
    const fields = close >= 0 ? stat.slice(close + 1).trim().split(/\s+/) : [];
    return { state: fields[0] || null, startTicks: fields[19] || null, commandLine };
  } catch { return null; }
}

function safeStopTunnelProcess(record) {
  const pid = Number(record?.pid);
  if (!Number.isInteger(pid) || pid <= 1) return true;
  const matches = () => {
    const info = inspectProcess(pid);
    if (!info) return false;
    if (record.startTicks && info.startTicks && String(record.startTicks) !== String(info.startTicks)) return false;
    const expected = String(record.executable || 'cloudflared');
    return info.commandLine.includes(expected) && /\btunnel\b/.test(info.commandLine) && info.commandLine.includes('--url');
  };
  const initially = inspectProcess(pid);
  if (!initially) return !processExists(pid); // Cannot inspect a live PID: retain the lease.
  if (['Z', 'X'].includes(initially.state)) return true; // Zombie/dead process cannot serve traffic.
  if (record.startTicks && initially.startTicks && String(record.startTicks) !== String(initially.startTicks)) return true; // PID reused.
  if (!matches()) return false; // Do not release the lease when identity is ambiguous.
  try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error?.code !== 'ESRCH') return false; }
  const wait = milliseconds => {
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      const info = inspectProcess(pid);
      if (!info) return !processExists(pid);
      if (['Z', 'X'].includes(info.state)) return true;
      if (record.startTicks && info.startTicks && String(record.startTicks) !== String(info.startTicks)) return true;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    const finalInfo = inspectProcess(pid);
    return !finalInfo ? !processExists(pid) : (['Z', 'X'].includes(finalInfo.state) || Boolean(record.startTicks && finalInfo.startTicks && String(record.startTicks) !== String(finalInfo.startTicks)));
  };
  if (wait(1800)) return true;
  if (matches()) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error?.code !== 'ESRCH') return false; } }
  return wait(1800);
}

function cleanupOrphans() {
  let tunnelCleanupSafe = true;
  let tunnelRecord = null;
  try {
    const raw = fs.readFileSync(tunnelPidFile, 'utf8');
    try { tunnelRecord = JSON.parse(raw); } catch { tunnelRecord = { pid: Number(raw) }; }
  } catch {
    try { tunnelRecord = JSON.parse(fs.readFileSync(tunnelLockFile, 'utf8')); } catch {}
  }
  if (!Number.isSafeInteger(Number(tunnelRecord?.pid)) || Number(tunnelRecord.pid) <= 1) {
    try { tunnelRecord = JSON.parse(fs.readFileSync(tunnelLockFile, 'utf8')); } catch {}
  }
  if (tunnelRecord?.pid) tunnelCleanupSafe = safeStopTunnelProcess(tunnelRecord);
  try {
    const list = spawnSync(runtime, ['ps', '-aq', '--filter', `label=com.razzaq.ocha.codelab.instance=${instanceId}`], {
      encoding: 'utf8', timeout: 5000
    });
    const ids = String(list.stdout || '').split(/\s+/).filter(value => /^[a-f0-9]{12,64}$/i.test(value));
    if (ids.length) spawnSync(runtime, ['rm', '-f', ...ids], { stdio: 'ignore', timeout: 10_000 });
  } catch {}
  try {
    const lock = JSON.parse(fs.readFileSync(tunnelLockFile, 'utf8'));
    // Keep the cross-process lease if the recorded child could not be
    // positively identified and stopped. A new bot must not create a second
    // tunnel while an orphan may still be serving traffic.
    if (tunnelCleanupSafe && lock?.instanceId === instanceId) fs.rmSync(tunnelLockFile, { force: true });
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
