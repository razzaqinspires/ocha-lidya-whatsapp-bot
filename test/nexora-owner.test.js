import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

test('Nexora all off switches AI and Code Lab capabilities globally', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-nexora-all-test-'));
  try {
    const configUrl = pathToFileURL(path.resolve(original, 'src/config.js')).href;
    const pluginUrl = pathToFileURL(path.resolve(original, 'src/plugins/owner/nexora.js')).href;
    const source = `
      const config = await import(${JSON.stringify(configUrl)});
      await config.loadConfig();
      const pluginModule = await import(${JSON.stringify(pluginUrl)});
      let reply = '';
      await pluginModule.default.execute({ m: { sender: '6283193905842@s.whatsapp.net', reply: async text => { reply = text; } }, args: ['all', 'off'] });
      const current = config.getConfig();
      console.log('NEXORA_RESULT:' + JSON.stringify({ ai: current.ai.enabled, code: current.codeLab.enabled, autoRun: current.codeLab.aiExecutionEnabled, tunnel: current.codeLab.publicTunnelEnabled, reply }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temp, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('NEXORA_RESULT:'));
    assert.ok(line, result.stdout);
    const output = JSON.parse(line.slice('NEXORA_RESULT:'.length));
    assert.deepEqual({ ai: output.ai, code: output.code, autoRun: output.autoRun, tunnel: output.tunnel }, { ai: false, code: false, autoRun: false, tunnel: false });
    assert.match(output.reply, /berlaku untuk seluruh pengguna/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
