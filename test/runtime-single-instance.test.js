import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/runtime/single-instance.js');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function capture(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`child exit ${code}: ${stderr}`)));
  });
}

test('runtime lock rejects a second main process while the first process owns the project', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-single-instance-'));
  const firstScript = `import { acquireRuntimeLock } from ${JSON.stringify(modulePath)}; const lock = await acquireRuntimeLock(); if (!lock.acquired) process.exit(3); console.log('FIRST_LOCKED'); await new Promise(r => setTimeout(r, 1800)); await lock.release(); console.log('FIRST_RELEASED');`;
  const secondScript = `import { acquireRuntimeLock } from ${JSON.stringify(modulePath)}; const lock = await acquireRuntimeLock(); console.log(JSON.stringify({ acquired: lock.acquired, duplicatePid: lock.duplicatePid })); if (lock.acquired) await lock.release();`;
  const first = spawn(process.execPath, ['--input-type=module', '-e', firstScript], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const firstResultPromise = capture(first);
  try {
    let firstOutput = '';
    first.stdout.on('data', chunk => { firstOutput += chunk; });
    const firstReady = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('first runtime process did not acquire its lock')), 5000);
      first.stdout.on('data', chunk => {
        if (firstOutput.includes('FIRST_LOCKED')) { clearTimeout(timer); resolve(); }
      });
      first.once('error', reject);
    });
    await firstReady;
    const second = spawn(process.execPath, ['--input-type=module', '-e', secondScript], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const secondResult = await capture(second);
    const parsed = JSON.parse(secondResult.stdout.trim());
    assert.equal(parsed.acquired, false);
    assert.equal(Number(parsed.duplicatePid), Number(first.pid));
    const firstResult = await firstResultPromise;
    assert.match(`${firstOutput}${firstResult.stdout}`, /FIRST_RELEASED/);
    await sleep(30);
    await assert.rejects(fs.access(path.join(cwd, 'data', 'runtime', 'ocha-main.lock')));
  } finally {
    if (first.exitCode === null) first.kill('SIGKILL');
    await fs.rm(cwd, { recursive: true, force: true });
  }
});


test('legacy source-watcher replacement waits for parent src/index.js to exit without a lock or handoff env', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-legacy-handoff-'));
  const sourceDir = path.join(cwd, 'src');
  const childPidFile = path.join(cwd, 'replacement.pid');
  const resultFile = path.join(cwd, 'replacement-result.json');
  await fs.mkdir(sourceDir, { recursive: true });
  const childScript = `import { acquireRuntimeLock } from ${JSON.stringify(modulePath)}; import fs from 'node:fs'; const started = Date.now(); const lock = await acquireRuntimeLock(); fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ acquired: lock.acquired, waitedMs: Date.now() - started, parentPid: ${'process.env.OCHA_HANDOFF_FROM_PID || null'} })); if (lock.acquired) await lock.release();`;
  const parentEntry = `import { spawn } from 'node:child_process'; import fs from 'node:fs'; const child = spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(childScript)}], { cwd: process.cwd(), env: { ...process.env }, detached: true, stdio: 'ignore' }); child.unref(); fs.writeFileSync(${JSON.stringify(childPidFile)}, String(child.pid)); console.log('LEGACY_PARENT_READY'); await new Promise(resolve => setTimeout(resolve, 1500));`;
  await fs.writeFile(path.join(sourceDir, 'index.js'), parentEntry);
  const parent = spawn(process.execPath, ['src/index.js'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let parentOutput = '';
  parent.stdout.on('data', chunk => { parentOutput += chunk; });
  const parentReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('legacy parent did not become ready')), 5000);
    parent.stdout.on('data', chunk => {
      if (parentOutput.includes('LEGACY_PARENT_READY')) { clearTimeout(timer); resolve(); }
    });
    parent.once('error', reject);
  });
  let childPid = null;
  try {
    await parentReady;
    childPid = Number(await fs.readFile(childPidFile, 'utf8'));
    await new Promise((resolve, reject) => {
      parent.once('close', resolve);
      parent.once('error', reject);
    });
    const deadline = Date.now() + 5000;
    let result;
    while (Date.now() < deadline) {
      try { result = JSON.parse(await fs.readFile(resultFile, 'utf8')); break; }
      catch { await sleep(50); }
    }
    assert.ok(result, 'replacement must acquire its lock after the legacy parent exits');
    assert.equal(result.acquired, true);
    assert.equal(result.parentPid, null, 'legacy source watcher does not set the handoff environment variable');
    assert.ok(result.waitedMs >= 1000, `replacement acquired too early (${result.waitedMs}ms)`);
  } finally {
    if (childPid > 1) { try { process.kill(childPid, 'SIGKILL'); } catch {} }
    if (parent.exitCode === null) parent.kill('SIGKILL');
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
