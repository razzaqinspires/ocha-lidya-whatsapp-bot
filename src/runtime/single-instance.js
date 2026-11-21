import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(process.cwd());
const LOCK_DIR = path.join(ROOT, 'data', 'runtime');
const LOCK_FILE = path.join(LOCK_DIR, 'ocha-main.lock');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function processIdentity(pid) {
  const numeric = Number(pid);
  if (!Number.isSafeInteger(numeric) || numeric <= 1) return { alive: false, startTicks: null, commandLine: '' };
  try { process.kill(numeric, 0); }
  catch (error) { return { alive: error?.code === 'EPERM', startTicks: null, commandLine: '' }; }
  if (process.platform !== 'linux') return { alive: true, startTicks: null, commandLine: '' };
  try {
    const [stat, cmdline, cwd] = await Promise.all([
      fs.readFile(`/proc/${numeric}/stat`, 'utf8'),
      fs.readFile(`/proc/${numeric}/cmdline`, 'utf8'),
      fs.readlink(`/proc/${numeric}/cwd`).catch(() => null)
    ]);
    const close = stat.lastIndexOf(')');
    const fields = close >= 0 ? stat.slice(close + 1).trim().split(/\s+/) : [];
    return {
      alive: !['Z', 'X'].includes(fields[0]),
      startTicks: fields[19] || null,
      argv: cmdline.split('\0').filter(Boolean),
      cwd,
      commandLine: cmdline.replaceAll('\0', ' ').trim()
    };
  } catch (error) {
    return { alive: error?.code === 'EPERM' || error?.code === 'EACCES', startTicks: null, commandLine: '' };
  }
}

async function readLock() {
  try {
    const raw = await fs.readFile(LOCK_FILE, 'utf8');
    return { raw, record: JSON.parse(raw) };
  } catch { return { raw: '', record: null }; }
}

export async function acquireRuntimeLock({ handoffFromPid = process.env.OCHA_HANDOFF_FROM_PID, timeoutMs = 45_000 } = {}) {
  await fs.mkdir(LOCK_DIR, { recursive: true, mode: 0o700 });
  const token = crypto.randomBytes(24).toString('base64url');
  const deadline = Date.now() + (handoffFromPid ? timeoutMs : 2500);

  // Compatibility bridge for an upgrade whose previous process predates the
  // runtime lock. A direct child launched for handoff waits for that parent to
  // exit even if no lock file exists yet, preventing two WhatsApp sockets.
  let expectedParentPid = Number(handoffFromPid);
  if (!Number.isSafeInteger(expectedParentPid) || expectedParentPid <= 1) {
    expectedParentPid = 0;
    const directParentPid = Number(process.ppid);
    const parentInfo = await processIdentity(directParentPid);
    const expectedEntry = path.join(ROOT, 'src', 'index.js');
    const isLegacyOchaParent = process.platform === 'linux' && parentInfo.alive && (parentInfo.argv || []).some(argument => {
      const candidate = path.isAbsolute(argument)
        ? path.resolve(argument)
        : path.resolve(parentInfo.cwd || ROOT, argument);
      return candidate === expectedEntry;
    });
    if (isLegacyOchaParent) expectedParentPid = directParentPid;
  }
  if (Number.isSafeInteger(expectedParentPid) && expectedParentPid > 1 && Number(process.ppid) === expectedParentPid) {
    while ((await processIdentity(expectedParentPid)).alive) {
      if (Date.now() >= deadline) {
        throw new Error(`Controlled restart menunggu proses induk lama PID ${expectedParentPid} keluar; tidak akan membuka socket WhatsApp ganda.`);
      }
      await sleep(100);
    }
  }

  while (true) {
    const record = {
      pid: process.pid,
      startTicks: (await processIdentity(process.pid)).startTicks,
      token,
      root: ROOT,
      startedAt: new Date().toISOString(),
      handoffFromPid: handoffFromPid ? Number(handoffFromPid) : null
    };
    let handle;
    try {
      handle = await fs.open(LOCK_FILE, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(record));
      await handle.sync().catch(() => {});
      await handle.close();
      let released = false;
      return {
        acquired: true,
        pid: process.pid,
        file: LOCK_FILE,
        async release() {
          if (released) return;
          released = true;
          let current;
          try { current = JSON.parse(await fs.readFile(LOCK_FILE, 'utf8')); } catch {}
          if (current?.token === token && Number(current.pid) === process.pid) {
            await fs.rm(LOCK_FILE, { force: true }).catch(() => {});
          }
        }
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code !== 'EEXIST') throw error;
    }

    const existing = await readLock();
    if (!existing.record) {
      const stat = await fs.stat(LOCK_FILE).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs < 5000) {
        if (Date.now() >= deadline) return { acquired: false, duplicatePid: null, pending: true, file: LOCK_FILE };
        await sleep(50);
        continue;
      }
    }
    const owner = await processIdentity(existing.record?.pid);
    const sameProcess = Number(existing.record?.pid) === process.pid;
    const identityMatches = owner.alive && (!existing.record?.startTicks || !owner.startTicks || String(existing.record.startTicks) === String(owner.startTicks));
    if (identityMatches && !sameProcess) {
      const handoffMatches = handoffFromPid && Number(existing.record?.pid) === Number(handoffFromPid);
      if (!handoffMatches) {
        return { acquired: false, duplicatePid: Number(existing.record.pid), file: LOCK_FILE };
      }
      if (Date.now() >= deadline) {
        throw new Error(`Controlled restart menunggu proses lama PID ${handoffFromPid}, tetapi lock belum dilepas dalam ${timeoutMs} ms.`);
      }
      await sleep(120);
      continue;
    }

    // Stale lock: only remove the exact file contents that were inspected.
    const latest = await fs.readFile(LOCK_FILE, 'utf8').catch(() => '');
    if (latest === existing.raw) await fs.rm(LOCK_FILE, { force: true }).catch(() => {});
  }
}
