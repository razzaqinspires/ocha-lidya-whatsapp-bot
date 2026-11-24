import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { buildSandboxArgs, runSandboxProcess } from '../src/acie/runtime/sandbox-runner.js';
import { createExternalAdapterDescriptor, validateAdapterDescriptor, getRuntimeCommand, normalizeAdapterInput, normalizeAdapterOutput } from '../src/acie/adapters/universal-adapter.js';
import { inspectRuntimeHost, assertSandboxExecutionAllowed } from '../src/acie/runtime/runtime-manager.js';

const digestImage = `node:22-alpine@sha256:${'a'.repeat(64)}`;

test('universal adapter descriptor is external, disabled and bound to provider identity', () => {
  const provider = { providerId: 'friend-tool-v1', contributionId: 'OCHA-001' };
  const adapter = createExternalAdapterDescriptor({ ...provider, entryPoint: 'src/index.mjs', language: 'javascript', capabilities: [{ id: 'demo.run' }] });
  assert.equal(adapter.provider.language, 'javascript');
  assert.equal(adapter.execution.enabled, false);
  assert.equal(validateAdapterDescriptor(adapter, provider).valid, true);
  assert.equal(validateAdapterDescriptor({ ...adapter, providerId: 'other' }, provider).valid, false);
});

test('adapter rejects unsafe entrypoints and unsupported build runtimes', () => {
  assert.throws(() => getRuntimeCommand('javascript', '../escape.js'), /Unsafe/);
  assert.throws(() => getRuntimeCommand('rust', 'src/main.rs'), /separately validated build adapter/);
  assert.throws(() => getRuntimeCommand('typescript', 'src/main.ts'), /Unsupported ACIE runtime language/);
});

test('adapter JSON protocol bounds input and validates structured output', () => {
  assert.equal(normalizeAdapterInput({ capability: 'demo.run' }), '{"capability":"demo.run"}');
  assert.deepEqual(normalizeAdapterOutput('{"ok":true,"text":"done"}'), { ok: true, text: 'done' });
  assert.throws(() => normalizeAdapterOutput('not-json'), /JSON object/);
  assert.throws(() => normalizeAdapterInput({ text: 'x'.repeat(300_000) }), /256 KiB/);
});

test('sandbox args enforce pinned image, read-only source, no network and resource limits', () => {
  const args = buildSandboxArgs({ sourceDirectory: '/srv/ocha/contributions/vault/c1/v1/original', image: digestImage, command: { executable: 'node', args: ['/acie/source/index.js'] } });
  for (const token of ['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit', '--memory', '--cpus', '--user', '65534:65534']) assert.ok(args.includes(token));
  assert.ok(args.some(item => item.includes('readonly')));
  assert.throws(() => buildSandboxArgs({ sourceDirectory: '/tmp/src', image: 'node:latest', command: { executable: 'node', args: [] } }), /pinned by sha256/);
  assert.throws(() => buildSandboxArgs({ sourceDirectory: '/tmp/src', image: digestImage, command: { executable: 'node', args: [] }, pids: 999 }), /resource limits/);
});

test('sandbox process runner uses argv without shell and bounds its process contract', async () => {
  let invoked;
  const fakeSpawn = (engine, args, options) => {
    invoked = { engine, args, options };
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
    process.nextTick(() => { child.stdout.write('{"ok":true}'); child.emit('close', 0, null); });
    return child;
  };
  const result = await runSandboxProcess({ engine: '/usr/bin/docker', args: ['run', 'image'], input: '{"x":1}', spawnImpl: fakeSpawn });
  assert.equal(result.stdout, '{"ok":true}');
  assert.equal(invoked.engine, '/usr/bin/docker');
  assert.equal(invoked.options.shell, false);
  assert.equal(Object.hasOwn(invoked.options.env, 'OPENAI_API_KEY'), false);
});

test('runtime remains unavailable until an explicit engine and image probe succeeds', () => {
  const host = inspectRuntimeHost({ root: process.cwd() });
  assert.equal(host.sandbox.available, false);
  assert.equal(host.sandbox.executionEnabled, false);
  assert.throws(() => assertSandboxExecutionAllowed({ sandbox: { approved: true }, executionAuthorized: true }), /no production sandbox runner/);
});

test('sandbox runtime failures never echo provider stderr or embedded credentials', async () => {
  const secret = 'sk_live_do_not_echo_123456789';
  const fakeSpawn = () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
    process.nextTick(() => { child.stderr.write(`provider failed with ${secret}`); child.emit('close', 17, null); });
    return child;
  };
  await assert.rejects(runSandboxProcess({ engine: '/usr/bin/docker', args: ['run'], input: '{}', spawnImpl: fakeSpawn }), error => {
    assert.equal(error.code, 'SANDBOX_RUNTIME_FAILURE');
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});
