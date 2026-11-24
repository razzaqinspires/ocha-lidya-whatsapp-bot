import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

test('config facade replays persistent config.replace events from JSONL', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-config-test-'));
  process.chdir(temp);
  try {
    const configUrl = pathToFileURL(path.resolve(original, 'src/config.js')).href;
    const first = await import(`${configUrl}?first=${Date.now()}`);
    await first.loadConfig();
    assert.equal(first.getConfig().whatsapp.authMode, 'pairing');
    assert.equal(first.getConfig().whatsapp.browserName, 'Chrome');
    assert.equal(first.getConfig().schemaVersion, 35);
    assert.equal(first.getConfig().security.masterWorkloadWarningMode, 'compact');
    assert.equal(first.getConfig().security.masterWorkloadReviewEnabled, true);
    assert.deepEqual(first.getConfig().ui.fullButton, { enabled: false, strategy: 'adaptive', maxBodyChars: 1800, excludedCommands: [] });
    assert.deepEqual(first.getConfig().menu, { showDescriptions: false, pagination: { enabled: false, pageSize: 50 } });
    assert.deepEqual(first.getConfig().commandGuard, { cooldown: { enabled: false }, antiSpam: { enabled: false, dailyWarnings: 5 } });
    assert.equal(first.getConfig().whatsapp.recoverInvalidSession, true);
    assert.equal(first.getConfig().logging.level, 'info');
    assert.equal(first.getConfig().logging.color, 'auto');
    assert.equal(first.getConfig().ai.timeoutMs, 60000);
    assert.deepEqual(first.getConfig().ai.providerOrder, ['groq', 'gemini', 'deepseek', 'openai']);
    assert.equal(first.getConfig().ai.totalBudgetMs, 180000);
    assert.equal(first.getConfig().ai.maxOutputTokens, 4096);
    assert.equal(first.getConfig().ai.historyMessages, 96);
    assert.equal(first.getConfig().ai.maxInputChars, 96000);
    assert.equal(first.getConfig().ai.freeOnly, true);
    assert.equal(first.getConfig().ai.models.groq, 'openai/gpt-oss-120b');
    assert.equal(first.getConfig().codeLab.ttlMs, 3600000);
    assert.equal(first.getConfig().codeLab.maxConcurrent, 2);
    assert.equal(first.getConfig().codeLab.aiExecutionEnabled, true);
    assert.equal(first.getConfig().codeLab.websiteBuilderEnabled, true);
    assert.equal(first.getConfig().codeLab.websiteBuilderConcurrency, 2);
    assert.equal(first.getConfig().codeLab.websiteBuilderQueueLimit, 8);
    await first.updateConfig(c => { c.mode = 'self'; c.prefix.single = '!'; c.prefix.mode = 'single'; c.whatsapp.authMode = 'pairing'; c.whatsapp.pairingNumber = '6282177461231'; }, { actor: 'test', reason: 'persistence test' });
    assert.equal(first.getConfig().mode, 'self');
    await first.updateConfig(c => { c.codeLab.maxConcurrent = 4; }, { actor: 'test', reason: 'Code Lab configuration test' });
    assert.equal(first.getConfig().codeLab.maxConcurrent, 4);
    const db = await import(pathToFileURL(path.resolve(original, 'src/core/database.js')).href);
    const checkpoint = await db.getLatestConfigRecord();
    assert.equal(checkpoint.payload.config.mode, 'self');

    const second = await import(`${configUrl}?second=${Date.now()}`);
    await second.loadConfig();
    assert.equal(second.getConfig().mode, 'self');
    assert.equal(second.getConfig().prefix.single, '!');
    assert.equal(second.getConfig().whatsapp.authMode, 'pairing');
    assert.equal(second.getConfig().whatsapp.pairingNumber, '6282177461231');
    assert.equal(second.getConfig().whatsapp.browserName, 'Chrome');
    assert.equal(second.getConfig().codeLab.maxConcurrent, 4);
    await assert.rejects(
      first.updateConfig(c => { c.whatsapp.browserName = 'Ocha Lidya'; }),
      /whatsapp.browserName harus/
    );
    await assert.rejects(first.updateConfig(c => { c.codeLab.ttlMs = 3600001; }), /codeLab.ttlMs harus/);
    await assert.rejects(first.updateConfig(c => { c.codeLab.maxConcurrent = 5; }), /codeLab.maxConcurrent harus 1-4/);
    await assert.rejects(first.updateConfig(c => { c.codeLab.websiteBuilderConcurrency = 5; }), /websiteBuilderConcurrency harus 1-4/);
  } finally {
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});


test('legacy config migrates to canonical browser, session recovery, logger, UI, and AI settings', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-config-migration-test-'));
  try {
    const databaseUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
    const configUrl = pathToFileURL(path.resolve(original, 'src/config.js')).href;
    const source = `
      const database = await import(${JSON.stringify(databaseUrl)});
      await database.initializeDatabase();
      await database.appendRecord('config.replace', {
        config: {
          schemaVersion: 4,
          bot: { owner: '6283193905842', expectedNumber: '6282177461231' },
          whatsapp: { authMode: 'pairing', pairingNumber: '6282177461231', browserName: 'Ocha Lidya' }
        },
        changedBy: 'test',
        reason: 'legacy v1.4.2 config'
      });
      const config = await import(${JSON.stringify(configUrl)});
      await config.loadConfig();
      console.log('MIGRATION_RESULT:' + JSON.stringify({ schemaVersion: config.getConfig().schemaVersion, browserName: config.getConfig().whatsapp.browserName }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: temp,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const resultLine = result.stdout.split(/\r?\n/).find(line => line.startsWith('MIGRATION_RESULT:'));
    assert.ok(resultLine, result.stdout);
    assert.deepEqual(JSON.parse(resultLine.slice('MIGRATION_RESULT:'.length)), { schemaVersion: 35, browserName: 'Chrome' });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('schema v22 preserves a custom multi-provider priority order', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-provider-order-migration-'));
  try {
    const databaseUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
    const configUrl = pathToFileURL(path.resolve(original, 'src/config.js')).href;
    const source = `
      const db = await import(${JSON.stringify(databaseUrl)}); await db.initializeDatabase();
      await db.appendRecord('config.replace', { config: { schemaVersion: 21, ai: { providerOrder: ['deepseek', 'gemini'], maxKeyAttempts: 1 } } });
      const config = await import(${JSON.stringify(configUrl)}); await config.loadConfig();
      console.log('ORDER_RESULT:' + JSON.stringify({ schemaVersion: config.getConfig().schemaVersion, order: config.getConfig().ai.providerOrder, maxKeyAttempts: config.getConfig().ai.maxKeyAttempts }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temp, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('ORDER_RESULT:'));
    assert.ok(line, result.stdout);
    assert.deepEqual(JSON.parse(line.slice('ORDER_RESULT:'.length)), { schemaVersion: 35, order: ['deepseek', 'gemini'] });
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('schema v9 migration removes Qwen and legacy maxKeyAttempts', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-config-v10-test-'));
  try {
    const databaseUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
    const configUrl = pathToFileURL(path.resolve(original, 'src/config.js')).href;
    const source = `
      const database = await import(${JSON.stringify(databaseUrl)});
      await database.initializeDatabase();
      await database.appendRecord('config.replace', { config: {
        schemaVersion: 9,
        bot: { owner: '6283193905842', expectedNumber: '6282177461231' },
        whatsapp: { authMode: 'pairing', pairingNumber: '6282177461231', browserName: 'Chrome' },
        ai: { providerOrder: ['qwen', 'groq'], models: { qwen: 'qwen-model', groq: 'openai/gpt-oss-20b' }, maxKeyAttempts: 2, timeoutMs: 5000, totalBudgetMs: 12000 }
      } });
      const config = await import(${JSON.stringify(configUrl)});
      await config.loadConfig();
      console.log('V10_RESULT:' + JSON.stringify({ schemaVersion: config.getConfig().schemaVersion, ai: config.getConfig().ai }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temp, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('V10_RESULT:'));
    assert.ok(line, result.stdout);
    const output = JSON.parse(line.slice('V10_RESULT:'.length));
    assert.equal(output.schemaVersion, 35);
    assert.deepEqual(output.ai.providerOrder, ['groq', 'gemini', 'deepseek', 'openai']);
    assert.equal(output.ai.models.qwen, undefined);
    assert.equal(output.ai.maxKeyAttempts, undefined);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('schema v11 applies AI Boost only to shipped defaults and preserves owner custom settings', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-config-v12-boost-test-'));
  try {
    const databaseUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
    const configUrl = pathToFileURL(path.resolve(original, 'src/config.js')).href;
    const source = `
      const database = await import(${JSON.stringify(databaseUrl)});
      await database.initializeDatabase();
      await database.appendRecord('config.replace', { config: {
        schemaVersion: 11,
        ai: { timeoutMs: 7000, totalBudgetMs: 45000, maxOutputTokens: 320, temperature: 0.6, historyMessages: 6, maxInputChars: 6000, coalesceMs: 350, models: { groq: 'owner-custom-model' } }
      } });
      const config = await import(${JSON.stringify(configUrl)});
      await config.loadConfig();
      const ai = config.getConfig().ai;
      console.log('BOOST_MIGRATION:' + JSON.stringify({ schemaVersion: config.getConfig().schemaVersion, timeoutMs: ai.timeoutMs, totalBudgetMs: ai.totalBudgetMs, maxOutputTokens: ai.maxOutputTokens, historyMessages: ai.historyMessages, coalesceMs: ai.coalesceMs, maxKeyAttempts: ai.maxKeyAttempts, groqModel: ai.models.groq }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temp, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('BOOST_MIGRATION:'));
    assert.ok(line, result.stdout);
    assert.deepEqual(JSON.parse(line.slice('BOOST_MIGRATION:'.length)), {
      schemaVersion: 35, timeoutMs: 60000, totalBudgetMs: 180000, maxOutputTokens: 4096,
      historyMessages: 96, coalesceMs: 100, groqModel: 'owner-custom-model'
    });
  } finally {
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('v1.8.0 worker concurrency values migrate to the new low-memory maximum', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-code-lab-v181-migration-'));
  try {
    const databaseUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
    const configUrl = pathToFileURL(path.resolve(original, 'src/config.js')).href;
    const source = `
      const db = await import(${JSON.stringify(databaseUrl)});
      await db.initializeDatabase();
      await db.appendRecord('config.replace', { config: {
        schemaVersion: 15,
        bot: { owner: '6283193905842', expectedNumber: '6282177461231' },
        whatsapp: { authMode: 'pairing', pairingNumber: '6282177461231', browserName: 'Chrome' },
        codeLab: { maxConcurrent: 8 }
      } });
      const config = await import(${JSON.stringify(configUrl)});
      await config.loadConfig();
      console.log('V181_RESULT:' + JSON.stringify({ schemaVersion: config.getConfig().schemaVersion, maxConcurrent: config.getConfig().codeLab.maxConcurrent }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temp, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('V181_RESULT:'));
    assert.ok(line, result.stdout);
    assert.deepEqual(JSON.parse(line.slice('V181_RESULT:'.length)), { schemaVersion: 35, maxConcurrent: 4 });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});


test('schema v26 resets every group to safe MUTE until owner activates it in that group', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-config-v25-group-mute-'));
  try {
    const databaseUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
    const configUrl = pathToFileURL(path.resolve(original, 'src/config.js')).href;
    const source = `
      const db = await import(${JSON.stringify(databaseUrl)}); await db.initializeDatabase();
      await db.appendRecord('config.replace', { config: {
        schemaVersion: 25,
        features: {
          groupsMuted: false,
          groupMuteOverrides: { '120363123456789012-1234567890@g.us': false, 'not-a-group': false },
          lastJoinedGroupId: '120363123456789012-1234567890@g.us'
        }
      } });
      const config = await import(${JSON.stringify(configUrl)}); await config.loadConfig();
      console.log('GROUP_MUTE_MIGRATION:' + JSON.stringify({ schemaVersion: config.getConfig().schemaVersion, features: config.getConfig().features }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temp, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('GROUP_MUTE_MIGRATION:'));
    assert.ok(line, result.stdout);
    const output = JSON.parse(line.slice('GROUP_MUTE_MIGRATION:'.length));
    assert.equal(output.schemaVersion, 35);
    assert.equal(output.features.groupsMuted, true, 'schema v26 restores global MUTE even if previous config was active');
    assert.deepEqual(output.features.groupMuteOverrides, {}, 'previous active exceptions are cleared so every group requires in-context owner activation');
    assert.equal(output.features.lastJoinedGroupId, '');
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('schema v34 expands shipped AI defaults while preserving owner-tuned values', async () => {
  const original = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-config-v32-migration-'));
  try {
    const databaseUrl = pathToFileURL(path.resolve(original, 'src/core/database.js')).href;
    const configUrl = pathToFileURL(path.resolve(original, 'src/config.js')).href;
    const source = `
      const db = await import(${JSON.stringify(databaseUrl)}); await db.initializeDatabase();
      await db.appendRecord('config.replace', { config: { schemaVersion: 31, ai: {
        timeoutMs: 30000, totalBudgetMs: 120000, maxOutputTokens: 8192,
        historyMessages: 24, maxInputChars: 24000, freeOnly: false,
        models: { groq: 'owner-selected-model' }
      } } });
      const config = await import(${JSON.stringify(configUrl)}); await config.loadConfig();
      const ai = config.getConfig().ai;
      console.log('V32_RESULT:' + JSON.stringify({ schemaVersion: config.getConfig().schemaVersion,
        timeoutMs: ai.timeoutMs, totalBudgetMs: ai.totalBudgetMs,
        maxOutputTokens: ai.maxOutputTokens, historyMessages: ai.historyMessages,
        maxInputChars: ai.maxInputChars, freeOnly: ai.freeOnly, model: ai.models.groq }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temp, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('V32_RESULT:'));
    assert.ok(line, result.stdout);
    assert.deepEqual(JSON.parse(line.slice('V32_RESULT:'.length)), {
      schemaVersion: 35, timeoutMs: 60000, totalBudgetMs: 180000,
      maxOutputTokens: 4096, historyMessages: 96, maxInputChars: 96000,
      freeOnly: false, model: 'owner-selected-model'
    });
  } finally {
    process.chdir(original);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
