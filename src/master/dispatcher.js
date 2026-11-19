import { spawn } from 'node:child_process';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getConfig } from '../core/config.js';
import { logger } from '../core/logger.js';

const TOKENS = ['>>>', '>>', '=>', '>', '$'];
export function isMasterSyntax(body) {
  return TOKENS.some(token => body.startsWith(token) && body.slice(token.length).trim());
}
const runtimeLimits = () => getConfig().limits;
const outputLimit = () => Number(runtimeLimits().masterMaxOutput || 12000);
const timeout = () => Math.min(Number(runtimeLimits().masterTimeoutMs || 8000), 30000);

export function getRunnerForToken(token) {
  if (token === '>' || token === '=>') return 'masterEvalEnabled';
  if (token === '$') return 'masterCliEnabled';
  if (token === '>>') return 'masterPythonEnabled';
  if (token === '>>>') return 'masterGolangEnabled';
  return null;
}

function runProcess(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR }
    });
    let settled = false;
    const limit = outputLimit();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      if (!settled) { settled = true; reject(new Error(`Execution timeout after ${timeout()} ms`)); }
    }, timeout());
    const collect = (target, chunk) => {
      target.value += chunk.toString();
      if (target.value.length > limit) target.value = `${target.value.slice(0, limit)}\n[output truncated]`;
    };
    const out = { value: '' }, err = { value: '' };
    child.stdout.on('data', chunk => collect(out, chunk));
    child.stderr.on('data', chunk => collect(err, chunk));
    child.on('error', error => {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(error); }
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (!settled) { settled = true; resolve({ code, stdout: out.value, stderr: err.value }); }
    });
    child.stdin.end(input);
  });
}

async function runGo(source) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-go-'));
  const file = path.join(directory, 'main.go');
  try {
    await fs.writeFile(file, source, { mode: 0o600 });
    return await runProcess('go', ['run', file]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function renderResult(token, command, result) {
  const state = result.code === 0 ? 'SUCCESS' : 'FAILED';
  const lines = [
    '╭─ OCHA MASTER CONSOLE ─────────────────────',
    `│ Runtime  : ${token === '$' ? 'CLI SHELL' : token === '>>' ? 'PYTHON' : 'GO'}`,
    `│ Command  : ${command}`,
    `│ Exit     : ${result.code} · ${state}`
  ];
  if (result.stdout) lines.push('├─ STDOUT', result.stdout.trimEnd());
  if (result.stderr) lines.push('├─ STDERR', result.stderr.trimEnd());
  if (!result.stdout && !result.stderr) lines.push('├─ OUTPUT', '(no output)');
  lines.push('╰───────────────────────────────────────────');
  return lines.join('\n').slice(0, outputLimit());
}

async function sendResult(m, token, command, result) {
  logger.info({ runtime: token, command: command.slice(0, 160), exitCode: result.code }, 'Master runner completed');
  await m.reply(renderResult(token, command, result));
}

async function runJs(m, source, returnMode) {
  if (!getConfig().security.masterEvalEnabled) {
    return m.reply('JavaScript eval sedang OFF. Aktifkan dengan .master eval on.');
  }
  // vm is a convenience context, not a security boundary. Keep eval owner-only and opt-in.
  const logs = [];
  const writeLog = (...values) => logs.push(values.map(value => {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }).join(' '));
  const safeConsole = { log: writeLog, info: writeLog, warn: writeLog, error: writeLog, debug: writeLog };
  const context = vm.createContext({ console: safeConsole, Buffer, setTimeout, clearTimeout, setInterval, clearInterval });
  const body = returnMode && !/\breturn\b/.test(source) ? `return (${source});` : source;
  const wrapped = `(async()=>{ ${body} })()`;
  try {
    const script = new vm.Script(wrapped, { filename: 'ocha-owner-eval.js' });
    const execution = script.runInContext(context, { timeout: timeout() });
    const value = await Promise.race([
      execution,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Async execution timeout')), timeout()))
    ]);
    const output = [...logs, ...(value === undefined ? [] : [typeof value === 'string' ? value : JSON.stringify(value)])].join('\n');
    await m.reply([
      '╭─ OCHA MASTER CONSOLE · JAVASCRIPT ───────',
      output || 'undefined',
      '╰──────────────────────────────────────────'
    ].join('\n').slice(0, outputLimit()));
  } catch (error) {
    logger.warn({ err: error }, 'Master JavaScript eval failed');
    await m.reply(`OCHA MASTER · JAVASCRIPT ERROR\n${error.name}: ${error.message}`);
  }
}

export async function runMasterCommand(sock, m, body) {
  const token = TOKENS.find(value => body.startsWith(value));
  if (!token) return;
  const command = body.slice(token.length).trim();
  const security = getConfig().security;
  const runnerKey = getRunnerForToken(token);
  if (!runnerKey || !security[runnerKey]) {
    const name = token === '$' ? 'CLI' : token === '>>' ? 'Python' : token === '>>>' ? 'Go' : 'JavaScript eval';
    const help = token === '$' ? '.master cli on' : token === '>>' ? '.master python on' : token === '>>>' ? '.master golang on' : '.master eval on';
    return m.reply(`${name} runner sedang OFF. Aktifkan langsung dengan ${help}.`);
  }

  if (token === '>' || token === '=>') return runJs(m, command, token === '=>');
  logger.info({ runtime: runnerKey, command: command.slice(0, 160), chatType: m.isGroup ? 'GROUP' : 'PRIVATE' }, 'Master command started');
  try {
    let result;
    if (token === '$') result = await runProcess('/bin/sh', ['-lc', command]);
    else if (token === '>>') result = await runProcess('python3', ['-I', '-c', command]);
    else if (token === '>>>') result = await runGo(command);
    await sendResult(m, token, command, result);
  } catch (error) {
    logger.warn({ err: error, token }, 'Master command failed');
    await m.reply(`╭─ OCHA MASTER ERROR ─────────────────\n${error.name}: ${error.message}\n╰──────────────────────────────────────`);
  }
}
