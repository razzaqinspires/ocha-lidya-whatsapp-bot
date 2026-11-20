import { spawn } from 'node:child_process';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import * as database from '../core/database.js';
import { registerReplySession } from '../core/reply-sessions.js';
import { inspectWorkload, assessWorkloadWithOcha, shouldAutoApproveAssessment, createConfirmationCode } from './workload-tracker.js';
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

async function runJs(sock, m, source, returnMode) {
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
  const config = getConfig();
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');
  const crypto = await import('node:crypto');
  const childProcess = await import('node:child_process');
  const require = createRequire(import.meta.url);
  const ctx = { sock, m, message: m, config, logger, db: database, fs, path, os, crypto, childProcess, process, Buffer, require, importModule: specifier => import(specifier) };
  const context = vm.createContext({ ...ctx, ctx, console: safeConsole, Buffer, process, require, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, fetch, URL, URLSearchParams, AbortController, TextEncoder, TextDecoder, structuredClone });
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

async function executeMasterCommand(sock, m, body) {
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

  if (token === '>' || token === '=>') return runJs(sock, m, command, token === '=>');
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


const pendingWarnings = new Map();
const WARNING_TTL_MS = 120_000;
const MAX_PENDING_WARNINGS = 100;

function formatAssessment(runtime, heuristic, assessment, code, { localFallback = false } = {}) {
  const impacts = assessment?.impacts?.length ? assessment.impacts.map((item, index) => `${index + 1}. ${item}`).join('\n') : heuristic.reasons.join('\n');
  return [
    '╭─ OCHA WORKLOAD WARNING ─────────────────',
    `│ Runtime   : ${runtime}`,
    `│ Risk      : ${(assessment?.severity || heuristic.level).toUpperCase()}`,
    `│ AI review : ${localFallback ? 'Tidak tersedia · pemeriksaan lokal' : assessment ? `${assessment.provider} · ${assessment.latencyMs} ms` : 'Tidak tersedia'}`, 
    '├─ PENILAIAN OCHA', assessment?.summary || 'Pola berisiko terdeteksi oleh WorkloadTracker.',
    '├─ POTENSI DAMPAK', impacts || 'Periksa kode dan target sebelum melanjutkan.',
    '├─ SARAN LEBIH AMAN', assessment?.saferAlternative || 'Periksa target, lakukan backup, dan uji pada salinan data.',
    '├─ KONFIRMASI OWNER', `Balas pesan peringatan ini dengan: CONFIRM ${code}`,
    'Atau balas: CANCEL', 'Konfirmasi berlaku 120 detik, satu kali, hanya untuk pengirim dan kode ini.',
    'PERINGATAN: JavaScript eval berjalan di proses bot dan dapat menggunakan kapabilitas runtime yang tersedia. Jangan konfirmasi kode yang tidak kamu pahami.',
    '╰────────────────────────────────────────'
  ].join('\n');
}

async function requestRiskConfirmation(sock, m, body, token, command, heuristic) {
  if (m.isGroup) return m.reply('Konfirmasi eksekusi berisiko hanya tersedia di chat pribadi owner. Tidak ada kode yang dijalankan.');
  if (heuristic.hardBlock) {
    return m.reply(['╭─ OCHA SECURITY BLOCK ─────────────────', 'Perintah ditolak sebelum dieksekusi.', ...heuristic.reasons,
      'Perintah yang dapat merusak host/OS secara luas tidak dapat dibuka melalui konfirmasi chat.',
      '╰──────────────────────────────────────'].join('\n'));
  }
  let assessment;
  try {
    assessment = await assessWorkloadWithOcha(token === '$' ? 'CLI SHELL' : token === '>>' ? 'PYTHON' : token === '>>>' ? 'GO' : 'JAVASCRIPT EVAL', command);
  } catch (error) {
    // Single-provider policy: never switch vendors. When Groq is exhausted,
    // use deterministic local heuristics and require an explicit owner reply.
    // This is NOT an automatic approval and never overrides hard blocks.
    logger.warn({ err: error, runtime: token, localRisk: heuristic.level, hardBlock: heuristic.hardBlock }, 'Ocha Workload AI assessment unavailable; using local review with mandatory owner confirmation');
    assessment = {
      severity: heuristic.level === 'low' ? 'medium' : heuristic.level,
      recommendation: 'REVIEW',
      summary: 'Penilaian AI tidak tersedia karena provider utama sedang gagal atau limit habis. Ocha menggunakan pemeriksaan pola lokal; hasil ini bukan audit semantik lengkap.',
      impacts: heuristic.reasons.length ? heuristic.reasons : ['Kode akan dijalankan dengan kapabilitas runtime yang diaktifkan untuk Master Console.'],
      saferAlternative: 'Periksa kode dan target secara manual. Batalkan jika ada akses proses, filesystem, jaringan, konfigurasi, kredensial, atau pengiriman pesan yang tidak diperlukan.',
      provider: 'LOCAL HEURISTIC', latencyMs: 0
    };
    const code = createConfirmationCode();
    const sent = await m.reply(formatAssessment(token, heuristic, assessment, code, { localFallback: true }));
    const messageId = sent?.key?.id;
    if (!messageId) return m.reply('Konfirmasi tidak dapat didaftarkan karena ID pesan WhatsApp tidak tersedia. Perintah tidak dijalankan.');
    const key = `${m.chat}:${messageId}`;
    const commandHash = crypto.createHash('sha256').update(`${token}\0${command}`).digest('hex');
    pendingWarnings.set(key, { createdAt: Date.now(), code, runtime: token, commandHash, sender: m.sender });
    while (pendingWarnings.size > MAX_PENDING_WARNINGS) pendingWarnings.delete(pendingWarnings.keys().next().value);
    registerReplySession({
      chat: m.chat, messageId, sender: m.sender, kind: 'master-risk-confirmation',
      choices: [
        { key: `CONFIRM ${code}`, label: 'Konfirmasi dan jalankan', value: 'confirm' },
        { key: 'CANCEL', label: 'Batalkan', value: 'cancel' }
      ],
      ttlMs: WARNING_TTL_MS,
      helpText: `Balas pesan peringatan ini dengan CONFIRM ${code}, atau CANCEL.`,
      onSelect: async ({ value }) => {
        const pending = pendingWarnings.get(key);
        pendingWarnings.delete(key);
        if (!pending || Date.now() - pending.createdAt > WARNING_TTL_MS) return m.reply('Konfirmasi kedaluwarsa. Tidak ada kode yang dijalankan.');
        if (pending.sender !== m.sender || pending.commandHash !== commandHash || pending.code !== code) return m.reply('Validasi konfirmasi tidak cocok. Tidak ada kode yang dijalankan.');
        if (value === 'cancel') return m.reply('Perintah dibatalkan. Tidak ada kode yang dijalankan.');
        logger.warn({ runtime: token, sender: m.sender, commandHash, risk: assessment.severity, assessment: 'LOCAL_HEURISTIC' }, 'Owner explicitly confirmed execution while AI provider unavailable');
        return executeMasterCommand(sock, m, body);
      },
      metadata: { runtime: token, risk: assessment.severity, commandHash, assessment: 'LOCAL_HEURISTIC' }
    });
    return;
  }
  if (shouldAutoApproveAssessment(assessment, heuristic)) {
    logger.info({ runtime: token, command: command.slice(0, 160), sender: m.sender, risk: assessment.severity, provider: assessment.provider, latencyMs: assessment.latencyMs }, 'Ocha WorkloadTracker approved command without confirmation');
    return executeMasterCommand(sock, m, body);
  }
  const code = createConfirmationCode();
  const sent = await m.reply(formatAssessment(token, heuristic, assessment, code));
  const messageId = sent?.key?.id;
  if (!messageId) return m.reply('Gagal mendaftarkan konfirmasi karena WhatsApp tidak mengembalikan ID pesan. Perintah tidak dijalankan.');
  const key = `${m.chat}:${messageId}`;
  pendingWarnings.set(key, { createdAt: Date.now(), code, runtime: token });
  while (pendingWarnings.size > MAX_PENDING_WARNINGS) pendingWarnings.delete(pendingWarnings.keys().next().value);
  registerReplySession({
    chat: m.chat, messageId, sender: m.sender, kind: 'master-risk-confirmation',
    choices: [
      { key: `CONFIRM ${code}`, label: 'Konfirmasi dan jalankan', value: 'confirm' },
      { key: 'CANCEL', label: 'Batalkan', value: 'cancel' }
    ],
    ttlMs: WARNING_TTL_MS,
    helpText: `Balas dengan CONFIRM ${code} untuk menjalankan, atau CANCEL untuk membatalkan.`,
    onSelect: async ({ value }) => {
      const pending = pendingWarnings.get(key);
      pendingWarnings.delete(key);
      if (!pending || Date.now() - pending.createdAt > WARNING_TTL_MS) return m.reply('Konfirmasi sudah kedaluwarsa. Jalankan ulang perintah jika masih diperlukan.');
      if (value === 'cancel') return m.reply('Perintah dibatalkan. Tidak ada kode yang dijalankan.');
      logger.warn({ runtime: token, command: command.slice(0, 200), sender: m.sender, risk: assessment.severity }, 'Owner explicitly confirmed risky master command');
      return executeMasterCommand(sock, m, body);
    },
    metadata: { runtime: token, risk: assessment.severity, commandHash: crypto.createHash('sha256').update(command).digest('hex') }
  });
}

export async function runMasterCommand(sock, m, body, options = {}) {
  const token = TOKENS.find(value => body.startsWith(value));
  if (!token) return;
  const command = body.slice(token.length).trim();
  if (!options.confirmed) {
    const heuristic = inspectWorkload(token, command);
    if (heuristic.hardBlock || heuristic.suspicious) {
      logger.warn({ runtime: token, level: heuristic.level, hardBlock: heuristic.hardBlock, reasons: heuristic.reasons, sender: m.sender }, 'Master workload flagged for safety review');
      return requestRiskConfirmation(sock, m, body, token, command, heuristic);
    }
  }
  return executeMasterCommand(sock, m, body);
}
