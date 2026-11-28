import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const componentRoot = path.join(root, '.private', 'artificial-consciousness-component');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  return port;
}

function findPython() {
  const candidates = process.env.OCHA_PYTHON_BIN
    ? [process.env.OCHA_PYTHON_BIN]
    : process.platform === 'win32'
      ? ['py', 'python']
      : ['python3', 'python'];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0) return candidate;
  }
  return null;
}

test('Ocha NADI client connects to the separate AC component over loopback HTTP v1', async t => {
  const python = findPython();
  if (!python) return t.skip('Python 3 runtime is not available on this test host.');
  await fs.access(path.join(componentRoot, 'ac', '__main__.py'));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-nadi-client-smoke-'));
  const port = await freePort();
  const clientUrl = new URL('../src/runtime/consciousness-runtime.js', import.meta.url).href;
  const program = `
    import assert from 'node:assert/strict';
    const runtime = await import(${JSON.stringify(clientUrl)});
    try {
      const started = await runtime.startConsciousnessRuntime();
      assert.equal(started.ready, true, started.lastError || 'NADI did not become ready');
      assert.equal(started.componentVersion, '2.1.1');
      assert.equal(started.componentSource, 'external-directory');
      const status = await runtime.readConsciousnessStatus();
      assert.ok(status.kernel_version === '2.1.1');
      assert.ok(status.heartbeat?.running === true);
      const integrity = await runtime.verifyConsciousnessMemory();
      assert.equal(integrity.valid, true);
      const tick = await runtime.tickConsciousnessNow();
      assert.equal(tick.status, 'ok');
      const prompt = runtime.getConsciousnessPrompt();
      assert.match(prompt, /EXTERNAL RUNTIME TELEMETRY/);
      assert.ok(prompt.includes('Heartbeat: ') && prompt.includes(' bpm;'));
      console.log(JSON.stringify({
        ready: started.ready,
        componentVersion: started.componentVersion,
        componentSource: started.componentSource,
        heartbeatRunning: status.heartbeat.running,
        ledgerValid: integrity.valid,
        tickStatus: tick.status,
        promptTelemetry: prompt.includes('EXTERNAL RUNTIME TELEMETRY')
      }));
    } finally {
      await runtime.stopConsciousnessRuntime();
    }
  `;
  try {
    const home = path.join(temp, 'home');
    const dataDir = path.join(temp, 'nadi-data');
    await fs.mkdir(home, { recursive: true });
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      OCHA_PYTHON_BIN: python,
      OCHA_NADI_SOURCE_DIR: componentRoot,
      OCHA_NADI_DATA_DIR: dataDir,
      OCHA_NADI_PORT: String(port),
      OCHA_AC_HEARTBEAT_MS: '250',
    };
    delete env.OCHA_NADI_BASE_URL;
    delete env.OCHA_NADI_API_TOKEN;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 35_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `${result.stderr || ''}\n${result.stdout || ''}`);
    const outcome = result.stdout.split(/\r?\n/).find(line => line.startsWith('{"ready"'));
    assert.ok(outcome, result.stdout);
    const parsed = JSON.parse(outcome);
    assert.equal(parsed.ready, true);
    assert.equal(parsed.ledgerValid, true);
    assert.equal(parsed.tickStatus, 'ok');
    assert.equal(parsed.promptTelemetry, true);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
