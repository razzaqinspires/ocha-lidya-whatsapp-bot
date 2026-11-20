import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../core/config.js';
import { logger } from '../core/logger.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WATCHDOG_FILE = path.join(MODULE_DIR, 'code-lab-watchdog.js');
const SENSITIVE_TOKEN_BYTES = 32;
const OUTPUT_HARD_LIMIT = 48 * 1024;
const INPUT_HARD_LIMIT = 4096;
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

const state = {
  server: null,
  serverPromise: null,
  tunnel: null,
  tunnelPromise: null,
  tunnelUrl: null,
  tunnelError: null,
  watchdog: null,
  rootDir: null,
  instanceDir: null,
  heartbeatPath: null,
  shutdownPath: null,
  tunnelPidPath: null,
  instanceId: null,
  sessions: new Map(),
  reservations: new Map(),
  pendingReservations: 0,
  startPromise: null,
  rateHistory: new Map(),
  queue: [],
  activeWorkers: 0,
  tunnelRestartTimer: null,
  tunnelFailures: 0,
  prerequisites: { cloudflared: null, runtime: null, runtimeError: null },
  startedAt: null,
  closing: false
};

const config = () => getConfig().codeLab || {};
const setting = (key, fallback) => {
  const value = config()[key];
  return value === undefined || value === null ? fallback : value;
};
const boundedInt = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function normalizeCodeLanguage(value, source = '') {
  const language = String(value || '').trim().toLowerCase();
  if (['py', 'python', 'python3'].includes(language)) return 'python';
  if (['js', 'javascript', 'node', 'nodejs', 'mjs'].includes(language)) return 'node';
  if (['html', 'htm', 'web'].includes(language)) return 'html';
  if (language) throw new Error(`Bahasa tidak didukung: ${language}. Gunakan Python, Node.js, atau HTML.`);
  const text = String(source).trimStart();
  if (/^(<!doctype\s+html|<html|<head|<body|<main|<div|<section)/i.test(text)) return 'html';
  if (/^(import\s+|from\s+\S+\s+import\s+|def\s+\w+\s*\(|print\s*\(|class\s+\w+\s*[:(])/m.test(text)) return 'python';
  if (/^(const\s+|let\s+|var\s+|function\s+|console\.|import\s+.*from\s+|export\s+)/m.test(text)) return 'node';
  throw new Error('Bahasa kode belum dapat dikenali. Sebutkan Python, Node.js, atau HTML.');
}

export function extractCodeBlock(text) {
  const source = String(text || '');
  const blocks = [];
  const pattern = /```([a-zA-Z0-9_+.-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(source))) {
    const body = match[2].trim();
    if (body) blocks.push({ language: match[1] || '', source: body });
  }
  return blocks.at(-1) || null;
}

export function isCodeExecutionIntent(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value || value.length > 500) return false;
  return /\b(?:coba\s+)?(?:jalankan|dijalankan|run|execute|eksekusi)\b/.test(value) ||
    /\b(?:uji|tes(?:t)?)\s+(?:kode|code|program|script|ini|di\s+atas)\b/.test(value) ||
    /\b(?:buat|buka|kasih)\s+(?:web\s+)?preview\b/.test(value) ||
    /\b(?:lihat|tampilkan)\s+(?:hasil\s+)?run\b/.test(value);
}

function responseHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...extra
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, responseHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  response.end(JSON.stringify(payload));
}

function readJson(request, limit = INPUT_HARD_LIMIT) {
  return new Promise((resolve, reject) => {
    let body = '';
    let exceeded = false;
    request.setEncoding('utf8');
    request.on('data', chunk => {
      if (exceeded) return;
      body += chunk;
      if (Buffer.byteLength(body) > limit) {
        exceeded = true;
        reject(Object.assign(new Error('Payload terlalu besar.'), { statusCode: 413 }));
      }
    });
    request.on('end', () => {
      if (exceeded) return;
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(Object.assign(new Error('JSON tidak valid.'), { statusCode: 400 })); }
    });
    request.on('error', reject);
  });
}

function safeScriptJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function viewerHtml(session) {
  const bootstrap = safeScriptJson({
    id: session.id,
    token: session.token,
    language: session.language,
    initialStatus: session.status,
    initialHtml: session.language === 'html' ? session.source : '',
    expiresAt: session.expiresAt
  });
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Ocha Code Lab</title>
<style>
:root{color-scheme:dark;--bg:#0b1020;--panel:#121a2d;--line:#26334d;--muted:#9aa9c2;--text:#edf2fb;--accent:#91b7ff;--green:#72d6aa;--red:#ff8e94}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at top,#182846 0,#0b1020 45%);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;min-height:100vh}
main{max-width:1100px;margin:auto;padding:28px 18px 48px}.top{display:flex;justify-content:space-between;align-items:center;gap:18px;margin-bottom:18px}.brand{font-weight:750;letter-spacing:.04em}.sub{color:var(--muted);font-size:13px}.pill{border:1px solid var(--line);border-radius:999px;padding:6px 11px;color:var(--accent);font-size:12px;white-space:nowrap}
.panel{background:rgba(18,26,45,.94);border:1px solid var(--line);border-radius:18px;padding:18px;margin-top:14px;box-shadow:0 18px 60px rgba(0,0,0,.2)}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}.panel h2{font-size:14px;margin:0;letter-spacing:.04em}.meta{display:flex;gap:16px;flex-wrap:wrap;color:var(--muted);font-size:12px}.status{font-weight:700;color:var(--green)}.status.failed,.status.expired{color:var(--red)}
#output{min-height:140px;max-height:360px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#080d18;border:1px solid #202b40;border-radius:12px;padding:14px;color:#dce7f9;font:13px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}
#preview{width:100%;height:480px;border:1px solid var(--line);border-radius:12px;background:#fff}.inputbar{display:flex;gap:9px;margin-top:12px}.inputbar input{min-width:0;flex:1;background:#080d18;border:1px solid var(--line);border-radius:10px;padding:12px;color:var(--text);font:inherit}.inputbar button{border:0;border-radius:10px;background:#dce8ff;color:#14223b;padding:0 18px;font-weight:700;cursor:pointer}.inputbar button:disabled{opacity:.4;cursor:not-allowed}.foot{color:var(--muted);font-size:12px;margin-top:12px}.empty{color:var(--muted)}@media(max-width:650px){main{padding:18px 12px 32px}.top{align-items:flex-start;flex-direction:column}.panel{padding:13px}#preview{height:390px}.inputbar button{padding:0 13px}}
</style></head>
<body><main>
<header class="top"><div><div class="brand">OCHA LIDYA <span style="color:var(--accent)">/ CODE LAB</span></div><div class="sub">Isolated execution preview · Temporary public session</div></div><div class="pill">AUTO EXPIRE · 60 MINUTES</div></header>
<section class="panel"><div class="panel-head"><h2>SESSION</h2><span id="status" class="status">${session.status.toUpperCase()}</span></div><div class="meta"><span>Runtime: <b id="language"></b></span><span>Session: <b id="session"></b></span><span>Expires: <b id="expires"></b></span></div></section>
<section class="panel"><div class="panel-head"><h2>PROGRAM OUTPUT</h2><span class="sub">stdout / stderr</span></div><pre id="output" aria-live="polite">Menyiapkan runtime…</pre><div class="inputbar"><input id="stdin" autocomplete="off" placeholder="Ketik input untuk program (contoh: 1)" maxlength="4096"><button id="send" type="button">Kirim input</button></div><div class="foot">Input dikirim ke stdin program. Program dihentikan otomatis saat batas waktu eksekusi atau sesi berakhir.</div></section>
<section id="html-panel" class="panel" hidden><div class="panel-head"><h2>WEB PREVIEW</h2><span class="sub">Sandboxed iframe</span></div><iframe id="preview" title="Generated HTML preview" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><div class="foot">Preview berjalan di iframe terisolasi, tanpa akses cookie atau origin halaman ini.</div></section>
<div class="foot">Tautan ini bersifat publik bagi siapa pun yang memilikinya. Jangan masukkan password, token, atau data pribadi ke program.</div>
</main>
<script>
const boot=${bootstrap};
const api=(suffix='')=>'/api/s/'+encodeURIComponent(boot.id)+'/'+encodeURIComponent(boot.token)+suffix;
const output=document.getElementById('output'),status=document.getElementById('status'),send=document.getElementById('send'),input=document.getElementById('stdin');
document.getElementById('language').textContent=boot.language.toUpperCase();document.getElementById('session').textContent=boot.id.slice(0,8);document.getElementById('expires').textContent=new Date(boot.expiresAt).toLocaleString();
function showHtml(source){const panel=document.getElementById('html-panel');panel.hidden=false;const csp='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; media-src data: blob:; style-src \'unsafe-inline\' data:; script-src \'unsafe-inline\' data: blob:; font-src data:; connect-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">';const doc=/<head[\\s>]/i.test(source)?source.replace(/<head([^>]*)>/i,'<head$1>'+csp):csp+source;document.getElementById('preview').srcdoc=doc;}
if(boot.language==='html')showHtml(boot.initialHtml);
async function refresh(){try{const response=await fetch(api(),{cache:'no-store'});if(response.status===410){status.textContent='EXPIRED';status.className='status expired';output.textContent='Sesi ini telah kedaluwarsa dan sudah dihancurkan.';send.disabled=true;input.disabled=true;return false;}if(!response.ok)throw new Error('HTTP '+response.status);const data=await response.json();status.textContent=data.status.toUpperCase();status.className='status '+data.status;output.textContent=[data.stdout,data.stderr?'[stderr]\\n'+data.stderr:''].filter(Boolean).join('\\n')|| (data.status==='queued'?'Menunggu worker tersedia…':data.status==='running'?'Program berjalan.':'Tidak ada output.');output.scrollTop=output.scrollHeight;if(['expired','stopped','failed','completed'].includes(data.status)){send.disabled=true;input.disabled=true;return false;}return true;}catch(error){output.textContent='Koneksi preview terputus: '+error.message;return true;}}
async function sendInput(){const value=input.value;if(!value)return;send.disabled=true;try{const response=await fetch(api('/input'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:value})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Input gagal');input.value='';await refresh();}catch(error){output.textContent+='\\n[preview] '+error.message;}finally{send.disabled=false;input.focus();}}
send.addEventListener('click',sendInput);input.addEventListener('keydown',event=>{if(event.key==='Enter')sendInput();});
refresh();const poll=setInterval(async()=>{const keep=await refresh();if(!keep)clearInterval(poll);},1000);
</script></body></html>`;
}

function parseSessionPath(pathname) {
  const match = pathname.match(/^\/s\/([a-f0-9-]{36})\/([A-Za-z0-9_-]{40,60})\/?$/);
  return match ? { id: match[1], token: match[2] } : null;
}

function parseApiPath(pathname) {
  const match = pathname.match(/^\/api\/s\/([a-f0-9-]{36})\/([A-Za-z0-9_-]{40,60})(?:\/(input|stop))?\/?$/);
  return match ? { id: match[1], token: match[2], action: match[3] || '' } : null;
}

function tokenMatches(session, token) {
  if (!session || !token) return false;
  const received = crypto.createHash('sha256').update(token).digest();
  return crypto.timingSafeEqual(received, session.tokenHash);
}

function publicSession(session) {
  return {
    id: session.id,
    language: session.language,
    status: session.status,
    stdout: session.stdout,
    stderr: session.stderr,
    exitCode: session.exitCode,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt
  };
}

async function routeRequest(request, response) {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/health') {
    return sendJson(response, 200, { ok: true, service: 'ocha-code-lab', activeSessions: state.sessions.size, activeWorkers: state.activeWorkers, queued: state.queue.length });
  }

  const api = parseApiPath(url.pathname);
  if (api) {
    const session = state.sessions.get(api.id);
    if (!session || !tokenMatches(session, api.token) || Date.now() >= session.expiresAt) {
      return sendJson(response, 410, { error: 'Sesi tidak ditemukan atau sudah kedaluwarsa.' });
    }
    if (request.method === 'GET' && !api.action) return sendJson(response, 200, publicSession(session));
    if (request.method === 'POST' && api.action === 'input') {
      const body = await readJson(request);
      const input = String(body.input ?? '');
      if (input.length > INPUT_HARD_LIMIT || input.includes('\u0000')) return sendJson(response, 400, { error: 'Input tidak valid atau terlalu panjang.' });
      const now = Date.now();
      if (session.lastInputAt && now - session.lastInputAt < 100) return sendJson(response, 429, { error: 'Terlalu banyak input berurutan. Tunggu sebentar.' });
      if (session.inputCount >= 128) return sendJson(response, 429, { error: 'Batas total input sesi tercapai.' });
      if (!['running', 'queued'].includes(session.status)) {
        return sendJson(response, 409, { error: 'Program tidak sedang menerima input.' });
      }
      if (session.child?.stdin?.writable) session.child.stdin.write(`${input}\n`);
      else if (session.status === 'queued' || !session.child) {
        if (session.pendingInputs.length >= 16) return sendJson(response, 429, { error: 'Antrean input sedang penuh.' });
        session.pendingInputs.push(input);
      }
      else return sendJson(response, 409, { error: 'Input program sudah ditutup.' });
      session.lastInputAt = now;
      session.inputCount += 1;
      touchExecutionDeadline(session);
      logger.info({ sessionId: session.id, ownerKey: session.ownerKey, inputLength: input.length }, 'Code Lab stdin received');
      return sendJson(response, 202, { ok: true });
    }
    if (request.method === 'POST' && api.action === 'stop') {
      await cleanupSession(session.id, 'stopped');
      return sendJson(response, 200, { ok: true });
    }
    return sendJson(response, 405, { error: 'Method tidak diizinkan.' });
  }

  const sessionPath = parseSessionPath(url.pathname);
  if (request.method === 'GET' && sessionPath) {
    const session = state.sessions.get(sessionPath.id);
    if (!session || !tokenMatches(session, sessionPath.token) || Date.now() >= session.expiresAt) {
      response.writeHead(410, responseHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
      response.end('<!doctype html><meta charset="utf-8"><title>Preview expired</title><main style="font:16px system-ui;padding:3rem">Sesi preview tidak tersedia atau sudah kedaluwarsa.</main>');
      return;
    }
    response.writeHead(200, responseHeaders({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self' data:; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    }));
    response.end(viewerHtml(session));
    return;
  }

  response.writeHead(404, responseHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
  response.end('Not found');
}

function ensureServer() {
  if (state.server?.listening) return Promise.resolve(state.server);
  if (state.serverPromise) return state.serverPromise;
  state.serverPromise = new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      void routeRequest(request, response).catch(error => {
        logger.warn({ code: error?.code, statusCode: error?.statusCode, message: error?.message }, 'Code Lab HTTP request failed');
        if (!response.headersSent) sendJson(response, error?.statusCode || 500, { error: error?.statusCode ? error.message : 'Permintaan preview gagal.' });
        else response.destroy();
      });
    });
    server.maxConnections = 256;
    server.headersTimeout = 10_000;
    server.requestTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    server.once('error', error => { state.serverPromise = null; reject(error); });
    server.listen(boundedInt(setting('port', 8787), 8787, 1024, 65535), '127.0.0.1', () => {
      state.server = server;
      state.serverPromise = null;
      resolve(server);
      logger.info({ port: server.address()?.port }, 'Code Lab preview gateway listening on loopback');
    });
  });
  return state.serverPromise;
}

function probeCommand(binary, args, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    let child;
    let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error); else resolve(result);
    };
    try {
      child = spawn(binary, args, {
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        env: { PATH: process.env.PATH || '', HOME: process.env.HOME || os.tmpdir(), NO_COLOR: '1' }
      });
    } catch (error) {
      finish(error);
      return;
    }
    const collect = chunk => { output = `${output}${chunk.toString()}`.slice(-4000); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', error => finish(error));
    child.once('close', code => {
      if (code === 0) finish(null, output.trim());
      else finish(new Error(`${binary} ${args.join(' ')} gagal (exit ${code}). ${output.slice(-1200)}`));
    });
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      finish(new Error(`${binary} ${args.join(' ')} melewati batas pemeriksaan ${timeoutMs} ms.`));
    }, timeoutMs);
    timer.unref?.();
  });
}

async function verifyRuntimePrerequisites() {
  const runtime = String(setting('containerRuntime', 'docker'));
  const images = [String(setting('pythonImage', 'python:3.12-alpine')), String(setting('nodeImage', 'node:22-alpine'))];
  try {
    state.prerequisites.runtime = await probeCommand(runtime, ['info']);
    await probeCommand(runtime, ['image', 'inspect', ...images], 12_000);
    state.prerequisites.runtimeError = null;
  } catch (error) {
    state.prerequisites.runtime = null;
    state.prerequisites.runtimeError = `Code Lab belum siap: ${runtime} daemon atau image runtime tidak tersedia. Jalankan "${runtime} pull ${images[0]}" dan "${runtime} pull ${images[1]}" lalu coba lagi. Detail: ${error.message}`;
    throw new Error(state.prerequisites.runtimeError);
  }
}

async function verifyTunnelPrerequisites() {
  const binary = String(setting('cloudflaredBin', 'cloudflared'));
  try {
    state.prerequisites.cloudflared = await probeCommand(binary, ['--version']);
  } catch (error) {
    state.prerequisites.cloudflared = null;
    throw new Error(`Cloudflare Quick Tunnel belum siap. Pasang cloudflared sekali pada VPS dan pastikan binary tersedia di PATH. Detail: ${error.message}`);
  }
}

function scheduleTunnelRestart() {
  if (state.tunnelRestartTimer || state.closing || !setting('enabled', true) || !setting('publicTunnelEnabled', true)) return;
  const delay = Math.min(60_000, 5000 * (2 ** Math.min(state.tunnelFailures, 4)));
  state.tunnelFailures += 1;
  state.tunnelRestartTimer = setTimeout(() => {
    state.tunnelRestartTimer = null;
    if (state.closing || !setting('enabled', true) || !setting('publicTunnelEnabled', true)) return;
    void startTunnel().catch(error => {
      state.tunnelError = error;
      logger.error({ message: error.message }, 'TryCloudflare reconnect failed; supervisor will retry');
      scheduleTunnelRestart();
    });
  }, delay);
  state.tunnelRestartTimer.unref?.();
}

async function handleUnexpectedTunnelExit(child, code, signal) {
  if (state.closing) return;
  state.tunnel = null;
  state.tunnelUrl = null;
  state.tunnelError = new Error(`TryCloudflare berhenti (exit ${code ?? signal}).`);
  logger.error({ code, signal }, 'Persistent TryCloudflare tunnel stopped unexpectedly');
  // Old hostnames cannot be assumed to survive a Quick Tunnel restart. Revoke
  // affected sessions and free worker/container resources before reconnecting.
  for (const session of [...state.sessions.values()]) await cleanupSession(session.id, 'tunnel-lost');
  scheduleTunnelRestart();
}

function startTunnel() {
  if (state.tunnelUrl && state.tunnel && state.tunnel.exitCode === null && state.tunnel.signalCode === null) return Promise.resolve(state.tunnelUrl);
  if (state.tunnelPromise) return state.tunnelPromise;
  if (state.tunnel) return stopTunnel().then(() => startTunnel());
  if (!setting('publicTunnelEnabled', true)) return Promise.reject(new Error('Public TryCloudflare tunnel dinonaktifkan oleh owner.'));
  const binary = String(setting('cloudflaredBin', 'cloudflared'));
  const port = state.server?.address()?.port || boundedInt(setting('port', 8787), 8787, 1024, 65535);
  state.tunnelPromise = new Promise((resolve, reject) => {
    let settled = false;
    let output = '';
    const child = spawn(binary, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: false,
      env: { PATH: process.env.PATH || '', HOME: process.env.HOME || os.tmpdir(), NO_COLOR: '1' }
    });
    state.tunnel = child;
    const tunnelPidPath = state.tunnelPidPath;
    const pidWritePromise = tunnelPidPath ? fs.writeFile(tunnelPidPath, String(child.pid || '')).catch(() => {}) : Promise.resolve();
    const removePidFile = () => {
      if (!tunnelPidPath) return;
      void pidWritePromise.then(async () => {
        const recordedPid = await fs.readFile(tunnelPidPath, 'utf8').catch(() => '');
        if (recordedPid.trim() === String(child.pid || '')) await fs.rm(tunnelPidPath, { force: true }).catch(() => {});
      }).catch(() => {});
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      state.tunnelUrl = null;
      state.tunnelError = error;
      state.tunnelPromise = null;
      removePidFile();
      reject(error);
    };
    const inspect = chunk => {
      output = `${output}${chunk.toString()}`.slice(-16_000);
      const match = output.match(URL_PATTERN);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        state.tunnelUrl = match[0].replace(/\/$/, '');
        state.tunnelError = null;
        state.tunnelFailures = 0;
        state.tunnelPromise = null;
        logger.info({ tunnel: new URL(state.tunnelUrl).host }, 'Persistent TryCloudflare tunnel ready');
        resolve(state.tunnelUrl);
      }
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.once('error', error => fail(new Error(`cloudflared tidak dapat dijalankan (${error.code || error.message}). Pasang cloudflared pada VPS.`)));
    child.once('exit', (code, signal) => {
      const wasCurrent = state.tunnel === child;
      if (wasCurrent) {
        state.tunnel = null;
        state.tunnelUrl = null;
      }
      removePidFile();
      if (!settled) fail(new Error(`Quick Tunnel berhenti sebelum URL siap (exit ${code ?? signal}). ${output.slice(-900)}`));
      else if (wasCurrent && !state.closing) void handleUnexpectedTunnelExit(child, code, signal);
      else logger.info({ code, signal }, 'TryCloudflare process exited');
    });
    const timer = setTimeout(() => {
      fail(new Error(`TryCloudflare belum memberikan URL dalam 25 detik. ${output.slice(-900)}`));
      try { child.kill('SIGTERM'); } catch {}
    }, 25_000);
    timer.unref?.();
  });
  return state.tunnelPromise;
}

async function stopTunnel() {
  clearTimeout(state.tunnelRestartTimer);
  state.tunnelRestartTimer = null;
  const child = state.tunnel;
  state.tunnel = null;
  state.tunnelUrl = null;
  state.tunnelPromise = null;
  if (state.tunnelPidPath) await fs.rm(state.tunnelPidPath, { force: true }).catch(() => {});
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 1800);
    timer.unref?.();
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    try { child.kill('SIGTERM'); } catch { clearTimeout(timer); resolve(); }
  });
}

function ownerSessionCounts(ownerKey) {
  return [...state.sessions.values()].filter(session => session.ownerKey === ownerKey).length;
}

function checkRateLimit(ownerKey) {
  const now = Date.now();
  const windowMs = 60_000;
  const history = (state.rateHistory.get(ownerKey) || []).filter(timestamp => now - timestamp < windowMs);
  const max = boundedInt(setting('maxExecutionsPerMinute', 3), 3, 1, 20);
  if (history.length >= max) throw new Error(`Batas eksekusi tercapai (${max} permintaan/menit). Coba lagi sebentar.`);
  history.push(now);
  state.rateHistory.set(ownerKey, history);
  if (state.rateHistory.size > 5000) {
    const oldestOwner = state.rateHistory.keys().next().value;
    if (oldestOwner && oldestOwner !== ownerKey) state.rateHistory.delete(oldestOwner);
  }
}

function appendOutput(session, type, chunk) {
  const text = chunk.toString('utf8');
  const outputLimit = boundedInt(setting('maxOutputBytes', OUTPUT_HARD_LIMIT), OUTPUT_HARD_LIMIT, 2048, OUTPUT_HARD_LIMIT);
  if (type === 'stderr') session.stderr = `${session.stderr}${text}`.slice(-outputLimit / 2);
  else session.stdout = `${session.stdout}${text}`.slice(-outputLimit / 2);
  session.lastOutputAt = Date.now();
}

function touchExecutionDeadline(session) {
  clearTimeout(session.executionTimer);
  if (!session.child || !['running', 'queued'].includes(session.status)) return;
  const maxRuntime = boundedInt(setting('maxRuntimeMs', 120_000), 120_000, 5_000, 600_000);
  session.executionTimer = setTimeout(() => {
    session.stderr = `${session.stderr}\n[Code Lab] Batas waktu proses ${Math.round(maxRuntime / 1000)} detik tercapai.`.slice(-OUTPUT_HARD_LIMIT / 2);
    session.status = 'failed';
    const worker = session.child;
    try { worker?.kill('SIGTERM'); } catch {}
    setTimeout(() => {
      try { worker?.kill('SIGKILL'); } catch {}
      void cleanupContainer(session);
    }, 1200).unref?.();
  }, maxRuntime);
  session.executionTimer.unref?.();
}

function containerArgs(session) {
  const runtime = String(setting('containerRuntime', 'docker'));
  const isPodman = /podman/i.test(runtime);
  const image = session.language === 'python'
    ? String(setting('pythonImage', 'python:3.12-alpine'))
    : String(setting('nodeImage', 'node:22-alpine'));
  const script = session.language === 'python' ? '/workspace/main.py' : '/workspace/main.mjs';
  const executable = session.language === 'python' ? 'python' : 'node';
  const launchArgs = session.language === 'python'
    ? ['-I', '-B', '-u', script]
    : ['--disable-proto=throw', script];
  const name = session.containerName;
  const labelPrefix = 'com.razzaq.ocha.codelab';
  const maxRuntimeSeconds = Math.ceil(boundedInt(setting('maxRuntimeMs', 120_000), 120_000, 5_000, 600_000) / 1000);
  const args = [
    'run', '--rm', '-i', '--name', name,
    '--label', `${labelPrefix}=true`,
    '--label', `${labelPrefix}.instance=${state.instanceId}`,
    '--label', `${labelPrefix}.session=${session.id}`,
    '--network', 'none',
    '--memory', '128m', '--memory-swap', '128m', '--cpus', '0.50', '--pids-limit', '64', '--shm-size', '8m',
    '--ulimit', 'nofile=64:64', '--ulimit', 'fsize=1048576:1048576',
    '--read-only', '--cap-drop', 'ALL', '--security-opt', isPodman ? 'no-new-privileges:true' : 'no-new-privileges',
    '--user', '65534:65534', '--workdir', '/workspace',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777',
    '-v', `${session.directory}:/workspace:ro`,
    '-e', 'HOME=/tmp', '-e', 'TMPDIR=/tmp', '-e', 'PYTHONDONTWRITEBYTECODE=1', '-e', 'PYTHONUNBUFFERED=1',
    '--pull=never', image, 'timeout', String(maxRuntimeSeconds), executable, ...launchArgs
  ];
  return { runtime, args };
}

function scheduleWorkerPump() {
  const concurrency = boundedInt(setting('maxConcurrent', 2), 2, 1, 4);
  while (state.activeWorkers < concurrency && state.queue.length) {
    const session = state.queue.shift();
    if (!state.sessions.has(session.id) || session.status !== 'queued') continue;
    state.activeWorkers += 1;
    void runWorker(session).finally(() => {
      state.activeWorkers = Math.max(0, state.activeWorkers - 1);
      scheduleWorkerPump();
    });
  }
}

export function rescheduleCodeWorkers() {
  scheduleWorkerPump();
}

async function runWorker(session) {
  if (!state.sessions.has(session.id)) return;
  const { runtime, args } = containerArgs(session);
  session.status = 'running';
  session.startedAt = new Date().toISOString();
  logger.info({ sessionId: session.id, language: session.language, ownerKey: session.ownerKey, runtime }, 'Code Lab worker started');
  await new Promise(resolve => {
    let settled = false;
    const finish = (code, signal, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(session.executionTimer);
      session.child = null;
      if (state.sessions.has(session.id)) {
        if (session.status !== 'stopped' && session.status !== 'expired') {
          session.exitCode = Number.isInteger(code) ? code : null;
          if (session.status !== 'failed') session.status = code === 0 ? 'completed' : 'failed';
          if (error) session.stderr = `${session.stderr}\n${error.message}`.slice(-OUTPUT_HARD_LIMIT / 2);
        }
      }
      logger.info({ sessionId: session.id, exitCode: session.exitCode, signal, status: session.status }, 'Code Lab worker finished');
      const directory = session.directory;
      session.directory = null;
      // Remove by unique container name even after docker run exits: this also
      // catches containers left behind when the CLI was terminated on timeout.
      void (async () => {
        await cleanupContainer(session);
        if (directory) await fs.rm(directory, { recursive: true, force: true });
      })().catch(error => logger.warn({ sessionId: session.id, message: error.message }, 'Completed Code Lab resource cleanup failed')).finally(resolve);
    };
    let child;
    try {
      child = spawn(runtime, args, {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        env: { PATH: process.env.PATH || '', HOME: process.env.HOME || os.tmpdir() }
      });
      session.child = child;
      session.containerStarted = true;
      touchExecutionDeadline(session);
    } catch (error) {
      finish(null, null, error);
      return;
    }
    child.stdout.on('data', chunk => appendOutput(session, 'stdout', chunk));
    child.stderr.on('data', chunk => appendOutput(session, 'stderr', chunk));
    for (const pending of session.pendingInputs.splice(0)) child.stdin.write(`${pending}\n`);
    child.once('error', error => finish(null, null, error));
    child.once('close', (code, signal) => finish(code, signal));
  });
}

async function runHtmlSession(session) {
  session.status = 'completed';
  session.exitCode = 0;
  session.startedAt = session.createdAt;
  session.stdout = 'HTML berhasil dimuat pada web preview.';
}

async function cleanupContainer(session) {
  if (!session.containerName || !session.containerStarted) return;
  session.containerStarted = false;
  const runtime = String(setting('containerRuntime', 'docker'));
  await new Promise(resolve => {
    let settled = false;
    const done = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(); };
    const child = spawn(runtime, ['rm', '-f', session.containerName], { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} done(); }, 5000);
    timer.unref?.();
    child.once('error', error => { if (error?.code !== 'ENOENT') logger.warn({ sessionId: session.id, code: error?.code }, 'Code Lab container cleanup command failed'); done(); });
    child.once('exit', done);
  });
}

async function cleanupSession(id, reason = 'expired') {
  const session = state.sessions.get(id);
  if (!session) return false;
  state.sessions.delete(id);
  state.queue = state.queue.filter(item => item.id !== id);
  clearTimeout(session.expiryTimer);
  clearTimeout(session.executionTimer);
  if (session.child) {
    try { session.child.kill('SIGTERM'); } catch {}
  }
  await cleanupContainer(session);
  if (session.directory) await fs.rm(session.directory, { recursive: true, force: true }).catch(error => logger.warn({ sessionId: id, message: error.message }, 'Code Lab workspace cleanup failed'));
  session.status = reason;
  session.token = '';
  session.source = '';
  logger.info({ sessionId: id, reason }, 'Code Lab session destroyed');
  return true;
}

async function ensureWorkspace(session) {
  if (session.language === 'html') return;
  session.directory = await fs.mkdtemp(path.join(state.instanceDir, 'job-'));
  await fs.chmod(session.directory, 0o755);
  const filename = session.language === 'python' ? 'main.py' : 'main.mjs';
  await fs.writeFile(path.join(session.directory, filename), session.source, { mode: 0o444, flag: 'wx' });
}

async function ensureWatchdog() {
  if (state.watchdog) return;
  const instanceDir = state.instanceDir;
  state.heartbeatPath = path.join(instanceDir, 'heartbeat');
  state.shutdownPath = path.join(instanceDir, 'shutdown');
  state.tunnelPidPath = path.join(instanceDir, 'cloudflared.pid');
  await fs.mkdir(instanceDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(state.heartbeatPath, String(Date.now()), { mode: 0o600 });
  const child = spawn(process.execPath, [WATCHDOG_FILE, String(process.pid), state.instanceId, instanceDir, String(setting('containerRuntime', 'docker'))], {
    detached: true, stdio: 'ignore', windowsHide: true,
    env: { PATH: process.env.PATH || '', HOME: process.env.HOME || os.tmpdir() }
  });
  state.watchdog = child;
  child.unref();
  child.once('error', error => logger.warn({ code: error.code, message: error.message }, 'Code Lab orphan watchdog failed to start'));
}

function startHeartbeat() {
  if (!state.heartbeatPath) return;
  const timer = setInterval(() => {
    if (state.heartbeatPath) fs.writeFile(state.heartbeatPath, String(Date.now())).catch(() => {});
  }, 2000);
  timer.unref?.();
  return timer;
}

let heartbeatTimer;

export async function startCodeLab() {
  if (!setting('enabled', true)) return { enabled: false, reason: 'disabled' };
  if (state.startPromise) return state.startPromise;
  if (state.server?.listening) {
    state.closing = false;
    if (!state.prerequisites.runtime) {
      try { await verifyRuntimePrerequisites(); }
      catch (error) { logger.error({ message: error.message }, 'Container runtime preflight is not ready'); }
    }
    if (setting('publicTunnelEnabled', true) && !state.tunnelUrl) {
      try {
        await verifyTunnelPrerequisites();
        await startTunnel();
      } catch (error) {
        state.tunnelError = error;
        logger.error({ message: error.message }, 'TryCloudflare startup/reconnect failed');
      }
    }
    return getCodeLabStatus();
  }
  state.startPromise = (async () => {
    state.closing = false;
    state.startedAt = new Date().toISOString();
    // Verify the tunnel and container backend independently. A missing Docker
    // image must not prevent the single preview gateway/tunnel from starting;
    // Python/Node sessions fail closed until the runtime check passes.
    const checks = [
      verifyRuntimePrerequisites().catch(error => logger.error({ message: error.message }, 'Container runtime preflight is not ready'))
    ];
    if (setting('publicTunnelEnabled', true)) {
      checks.push(verifyTunnelPrerequisites().catch(error => {
        state.tunnelError = error;
        logger.error({ message: error.message }, 'Cloudflare preflight is not ready');
      }));
    }
    await Promise.all(checks);
    state.rootDir = path.resolve(String(setting('tempDir', path.join(os.tmpdir(), 'ocha-code-lab'))));
    state.instanceId = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    state.instanceDir = path.join(state.rootDir, `instance-${state.instanceId}`);
    await fs.mkdir(state.instanceDir, { recursive: true, mode: 0o700 });
    await ensureServer();
    await ensureWatchdog();
    heartbeatTimer = startHeartbeat();
    if (setting('publicTunnelEnabled', true) && state.prerequisites.cloudflared) {
      try { await startTunnel(); }
      catch (error) {
        state.tunnelError = error;
        logger.error({ message: error.message }, 'TryCloudflare did not become ready; Code Lab will reject public preview requests');
      }
    }
    return getCodeLabStatus();
  })();
  try { return await state.startPromise; }
  finally { state.startPromise = null; }
}

export async function createCodeSession({ ownerId, chatId = '', language = '', source = '' }) {
  if (!setting('enabled', true)) throw new Error('Code Lab sedang dinonaktifkan oleh owner.');
  if (state.closing) throw new Error('Code Lab sedang dihentikan.');
  if (!state.server?.listening) await startCodeLab();
  const code = String(source ?? '');
  if (!code.trim()) throw new Error('Kode kosong.');
  const maxBytes = boundedInt(setting('maxSourceBytes', 65_536), 65_536, 1024, 262_144);
  if (Buffer.byteLength(code, 'utf8') > maxBytes) throw new Error(`Kode melewati batas ${maxBytes} byte.`);
  const normalizedLanguage = normalizeCodeLanguage(language, code);
  if (normalizedLanguage !== 'html' && !state.prerequisites.runtime) {
    throw new Error(state.prerequisites.runtimeError || 'Container runtime belum lolos pemeriksaan. Periksa Docker/Podman dan image runtime, lalu jalankan .nexora runtime docker untuk memeriksa ulang.');
  }
  const ownerKey = crypto.createHash('sha256').update(String(ownerId || 'anonymous')).digest('hex').slice(0, 16);
  const totalLimit = boundedInt(setting('maxSessionsTotal', 20), 20, 1, 100);
  const perUserLimit = boundedInt(setting('maxSessionsPerUser', 2), 2, 1, 10);
  const reservedForUser = state.reservations.get(ownerKey) || 0;
  if (state.sessions.size + state.pendingReservations >= totalLimit) throw new Error('Kapasitas sesi Code Lab sedang penuh. Coba beberapa saat lagi.');
  if (ownerSessionCounts(ownerKey) + reservedForUser >= perUserLimit) throw new Error(`Batas ${perUserLimit} sesi aktif per pengguna telah tercapai.`);

  // Reserve capacity before the first await. This prevents simultaneous WhatsApp
  // messages from passing the same quota check and oversubscribing the session pool.
  state.pendingReservations += 1;
  state.reservations.set(ownerKey, reservedForUser + 1);
  try {
    checkRateLimit(ownerKey);
    await ensureServer();
    const baseUrl = await startTunnel();
    if (state.closing) throw new Error('Code Lab sedang dihentikan.');

    const id = crypto.randomUUID();
    const token = crypto.randomBytes(SENSITIVE_TOKEN_BYTES).toString('base64url');
    const ttlMs = boundedInt(setting('ttlMs', 3_600_000), 3_600_000, 60_000, 3_600_000);
    const createdAt = new Date().toISOString();
    const session = {
      id, token, tokenHash: crypto.createHash('sha256').update(token).digest(), ownerKey,
      chatKey: crypto.createHash('sha256').update(String(chatId)).digest('hex').slice(0, 12),
      language: normalizedLanguage, source: code, status: normalizedLanguage === 'html' ? 'completed' : 'queued',
      stdout: '', stderr: '', exitCode: null, createdAt, expiresAt: Date.now() + ttlMs,
      directory: null, child: null, containerStarted: false, pendingInputs: [], containerName: `ocha-lab-${id.replaceAll('-', '').slice(0, 20)}`,
      expiryTimer: null, executionTimer: null, startedAt: null, lastOutputAt: Date.now(), lastInputAt: 0, inputCount: 0
    };
    state.sessions.set(id, session);
    session.expiryTimer = setTimeout(() => { void cleanupSession(id, 'expired'); }, ttlMs);
    session.expiryTimer.unref?.();

    try {
      await ensureWorkspace(session);
      if (normalizedLanguage === 'html') await runHtmlSession(session);
      else {
        // Source is persisted only in the isolated read-only workspace while the
        // container runs; keep it out of the long-lived in-memory session object.
        session.source = '';
        state.queue.push(session);
        scheduleWorkerPump();
      }
    } catch (error) {
      await cleanupSession(id, 'failed');
      throw error;
    }

    const previewUrl = `${baseUrl}/s/${id}/${token}`;
    logger.info({ sessionId: id, language: normalizedLanguage, ownerKey, expiresAt: new Date(session.expiresAt).toISOString() }, 'Code Lab session created');
    return {
      id, language: normalizedLanguage, status: session.status, previewUrl,
      expiresAt: new Date(session.expiresAt).toISOString(), ttlMs
    };
  } finally {
    state.pendingReservations = Math.max(0, state.pendingReservations - 1);
    const remaining = (state.reservations.get(ownerKey) || 1) - 1;
    if (remaining > 0) state.reservations.set(ownerKey, remaining);
    else state.reservations.delete(ownerKey);
  }
}

export async function stopCodeLab() {
  if (state.closing) return;
  state.closing = true;
  if (state.startPromise) {
    try { await state.startPromise; } catch {}
  }
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  for (const session of [...state.sessions.values()]) await cleanupSession(session.id, 'stopped');
  state.queue.length = 0;
  await stopTunnel();
  if (state.server) {
    await new Promise(resolve => state.server.close(() => resolve()));
    state.server = null;
  }
  if (state.shutdownPath) await fs.writeFile(state.shutdownPath, 'clean', { mode: 0o600 }).catch(() => {});
  if (state.watchdog?.pid) {
    try { process.kill(state.watchdog.pid, 'SIGTERM'); } catch {}
  }
  state.watchdog = null;
  if (state.heartbeatPath) await fs.rm(path.dirname(state.heartbeatPath), { recursive: true, force: true }).catch(() => {});
  state.instanceDir = null;
  state.tunnelPidPath = null;
  state.heartbeatPath = null;
  state.shutdownPath = null;
  logger.info('Code Lab gateway, workers, tunnel, and temporary sessions stopped');
}

export function getCodeLabStatus() {
  return {
    enabled: Boolean(setting('enabled', true)),
    aiExecutionEnabled: Boolean(setting('aiExecutionEnabled', true)),
    publicTunnelEnabled: Boolean(setting('publicTunnelEnabled', true)),
    gateway: state.server?.listening ? `127.0.0.1:${state.server.address()?.port}` : 'offline',
    tunnel: !setting('publicTunnelEnabled', true) ? 'OFF' : (state.tunnelUrl || (state.tunnelError ? 'error' : 'connecting/offline')),
    tunnelError: state.tunnelError?.message || null,
    cloudflaredVersion: state.prerequisites.cloudflared,
    runtimeReady: Boolean(state.prerequisites.runtime),
    runtimeError: state.prerequisites.runtimeError,
    activeSessions: state.sessions.size,
    pendingReservations: state.pendingReservations,
    maxSessionsTotal: boundedInt(setting('maxSessionsTotal', 20), 20, 1, 100),
    activeWorkers: state.activeWorkers,
    queued: state.queue.length,
    maxConcurrent: boundedInt(setting('maxConcurrent', 2), 2, 1, 4),
    ttlMs: boundedInt(setting('ttlMs', 3_600_000), 3_600_000, 60_000, 3_600_000),
    startedAt: state.startedAt
  };
}

export async function restartCodeLabTunnel() {
  await stopTunnel();
  if (!setting('enabled', true) || !setting('publicTunnelEnabled', true)) return getCodeLabStatus();
  const url = await startTunnel();
  return { ...getCodeLabStatus(), tunnel: url };
}
