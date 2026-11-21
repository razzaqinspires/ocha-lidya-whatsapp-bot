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
const QUICK_TUNNEL_LOCK_NAME = '.cloudflared-quick-tunnel.lock';
const QUICK_TUNNEL_MAX_IN_FLIGHT = 160;
const WATCHDOG_PROTOCOL_VERSION = 2;

const state = {
  server: null,
  serverPromise: null,
  tunnel: null,
  tunnelPromise: null,
  tunnelOperation: Promise.resolve(),
  tunnelUrl: null,
  tunnelLease: null,
  tunnelGeneration: 0,
  tunnelStartedAt: null,
  tunnelIdleTimer: null,
  tunnelRetryAfter: 0,
  activeHttpRequests: 0,
  tunnelError: null,
  watchdog: null,
  watchdogPromise: null,
  rootDir: null,
  instanceDir: null,
  heartbeatPath: null,
  shutdownPath: null,
  tunnelPidPath: null,
  tunnelLogPath: null,
  ownerPath: null,
  watchdogPidPath: null,
  instanceId: null,
  sessions: new Map(),
  reservations: new Map(),
  pendingReservations: 0,
  startPromise: null,
  rateHistory: new Map(),
  queue: [],
  activeWorkers: 0,
  tunnelFailures: 0,
  prerequisites: { cloudflared: null, runtime: null, runtimeError: null },
  runtimeName: null,
  startedAt: null,
  closing: false,
  handoffInProgress: false
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

// Reply messages can quote an AI response that was cut off by a provider token
// limit. Preserve that partial fenced block so the AI can finish it safely
// before the execution worker receives it.
export function extractCodeBlockCandidate(text) {
  const source = String(text || '');
  const pattern = /```([a-zA-Z0-9_+.-]*)[ \t]*\r?\n([\s\S]*?)(```|$)/g;
  const blocks = [];
  let match;
  while ((match = pattern.exec(source))) {
    const body = String(match[2] || '').trim();
    if (body) blocks.push({ language: match[1] || '', source: body, complete: match[3] === '```' });
    if (!match[3]) break;
  }
  return blocks.at(-1) || null;
}

export function isCodeGenerationIntent(text) {
  const value = String(text || '').toLowerCase();
  return value.length <= 1200 && /\b(buatkan|buat|tuliskan|implementasikan|implementasi|generate|create|build)\b/.test(value) &&
    /\b(kode|code|script|program|kalkulator|calculator|python|javascript|node\.js|html|aplikasi|fungsi|function)\b/.test(value);
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
  const match = pathname.match(/^\/s\/([a-f0-9-]{36})\/([A-Za-z0-9_-]{40,60})(?:\/(.*))?$/);
  if (!match) return null;
  let resourcePath = match[3] || '';
  try { resourcePath = decodeURIComponent(resourcePath); } catch { return null; }
  if (resourcePath.includes('\\') || resourcePath.includes('\0')) return null;
  const parts = resourcePath.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..' || part.startsWith('.'))) return null;
  return { id: match[1], token: match[2], resourcePath: parts.join('/') };
}

function websiteViewerHtml(session) {
  const target = `/project/${session.id}/${session.token}/index.html`;
  const title = String(session.title || 'Website Preview').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title} · Nexora Preview</title><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;font:13px system-ui;background:#0b1020;color:#e8eef9}.bar{height:34px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;background:#101a2d;border-bottom:1px solid #26334d}.brand{font-weight:700;letter-spacing:.04em}.badge{color:#a9c5ff}iframe{display:block;width:100%;height:calc(100% - 34px);border:0;background:white}</style></head><body><header class="bar"><span class="brand">NEXORA <span class="badge">WEBSITE PREVIEW</span></span><span>Temporary · ${Object.keys(session.files || {}).length} files</span></header><iframe title="${title}" src="${target}" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer"></iframe></body></html>`;
}

function websiteContentType(filePath) {
  const extension = path.posix.extname(filePath).toLowerCase();
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.xml': 'application/xml; charset=utf-8' })[extension] || 'application/octet-stream';
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

  const projectMatch = url.pathname.match(/^\/project\/([a-f0-9-]{36})\/([A-Za-z0-9_-]{40,60})\/(.*)$/);
  if (request.method === 'GET' && projectMatch) {
    let resourcePath;
    try { resourcePath = decodeURIComponent(projectMatch[3] || 'index.html'); } catch { return sendJson(response, 400, { error: 'Path resource tidak valid.' }); }
    const parts = resourcePath.replaceAll('\\', '/').split('/').filter(Boolean);
    if (!parts.length || parts.some(part => part === '.' || part === '..' || part.startsWith('.'))) return sendJson(response, 400, { error: 'Path resource tidak aman.' });
    const session = state.sessions.get(projectMatch[1]);
    const token = projectMatch[2];
    if (!session || session.language !== 'website' || !tokenMatches(session, token) || Date.now() >= session.expiresAt) return sendJson(response, 410, { error: 'Sesi website tidak ditemukan atau sudah kedaluwarsa.' });
    const filePath = parts.join('/');
    const content = session.files?.[filePath];
    if (typeof content !== 'string') return sendJson(response, 404, { error: 'File website tidak ditemukan.' });
    response.writeHead(200, {
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Type': websiteContentType(filePath),
      'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    });
    response.end(content);
    return;
  }

  const sessionPath = parseSessionPath(url.pathname);
  if (request.method === 'GET' && sessionPath) {
    const session = state.sessions.get(sessionPath.id);
    if (!session || !tokenMatches(session, sessionPath.token) || Date.now() >= session.expiresAt) {
      response.writeHead(410, responseHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
      response.end('<!doctype html><meta charset="utf-8"><title>Preview expired</title><main style="font:16px system-ui;padding:3rem">Sesi preview tidak tersedia atau sudah kedaluwarsa.</main>');
      return;
    }
    if (session.language === 'website') {
      if (sessionPath.resourcePath) return sendJson(response, 404, { error: 'Resource website tidak ditemukan.' });
      response.writeHead(200, responseHeaders({
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
      }));
      response.end(websiteViewerHtml(session));
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
      if (state.activeHttpRequests >= QUICK_TUNNEL_MAX_IN_FLIGHT) {
        response.writeHead(503, responseHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '2' }));
        response.end(JSON.stringify({ error: 'Preview sedang menerima banyak permintaan. Coba kembali dalam beberapa detik.' }));
        return;
      }
      state.activeHttpRequests += 1;
      void routeRequest(request, response).catch(error => {
        logger.warn({ code: error?.code, statusCode: error?.statusCode, message: error?.message }, 'Code Lab HTTP request failed');
        if (!response.headersSent) sendJson(response, error?.statusCode || 500, { error: error?.statusCode ? error.message : 'Permintaan preview gagal.' });
        else response.destroy();
      }).finally(() => {
        state.activeHttpRequests = Math.max(0, state.activeHttpRequests - 1);
      });
    });
    server.maxConnections = QUICK_TUNNEL_MAX_IN_FLIGHT;
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
  const preference = String(setting('containerRuntime', 'auto')).toLowerCase();
  const candidates = preference === 'podman'
    ? ['podman', 'docker']
    : preference === 'docker'
      ? ['docker', 'podman']
      : ['docker', 'podman'];
  const images = [String(setting('pythonImage', 'python:3.12-alpine')), String(setting('nodeImage', 'node:22-alpine'))];
  const failures = [];

  for (const runtime of candidates) {
    try {
      await probeCommand(runtime, ['info'], 15_000);
      for (const image of images) {
        try {
          await probeCommand(runtime, ['image', 'inspect', image], 15_000);
        } catch {
          // Startup bootstrap normally pre-pulls these. If the runtime became
          // available later, recover lazily instead of requiring manual repair.
          await probeCommand(runtime, ['pull', image], 5 * 60_000);
          await probeCommand(runtime, ['image', 'inspect', image], 20_000);
        }
      }
      await probeCommand(runtime, ['info'], 15_000);
      state.runtimeName = runtime;
      state.prerequisites.runtime = true;
      state.prerequisites.runtimeError = null;
      logger.info({ preferred: preference, selected: runtime, images }, 'Nexora container runtime validated');
      return runtime;
    } catch (error) {
      failures.push(`${runtime}: ${String(error.message || error).slice(0, 500)}`);
    }
  }

  state.runtimeName = null;
  state.prerequisites.runtime = null;
  const detail = failures.join(' | ').slice(0, 1800) || 'Tidak ada runtime yang dapat diverifikasi.';
  state.prerequisites.runtimeError = `Code Lab belum siap: Docker dan Podman belum dapat menjalankan container. Bootstrap sudah mencoba service manager yang sesuai, startup dockerd terkontrol saat root, dan fallback Podman. ${detail}`;
  throw new Error(state.prerequisites.runtimeError);
}

async function ensureRuntimePrerequisites({ force = false } = {}) {
  if (state.prerequisites.runtime && state.runtimeName) return state.runtimeName;
  if (runtimeProbePromise) return runtimeProbePromise;
  if (!force && runtimeProbeRetryAfter > Date.now()) {
    throw new Error(state.prerequisites.runtimeError || `Pemeriksaan runtime ditunda ${Math.ceil((runtimeProbeRetryAfter - Date.now()) / 1000)} detik untuk menghindari probe berulang.`);
  }
  runtimeProbePromise = verifyRuntimePrerequisites();
  try {
    const selected = await runtimeProbePromise;
    runtimeProbeRetryAfter = 0;
    return selected;
  } catch (error) {
    runtimeProbeRetryAfter = Date.now() + 15_000;
    throw error;
  } finally {
    runtimeProbePromise = null;
  }
}

function selectedRuntime(fallback = 'docker') {
  return state.runtimeName || (String(setting('containerRuntime', 'auto')) === 'podman' ? 'podman' : fallback);
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

function serializeTunnelOperation(operation) {
  const previous = state.tunnelOperation || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  state.tunnelOperation = current.catch(() => {});
  return current;
}

async function inspectLinuxProcess(pid) {
  if (!Number.isSafeInteger(Number(pid)) || Number(pid) <= 1) return { alive: false };
  const numericPid = Number(pid);
  if (process.platform !== 'linux') {
    try { process.kill(numericPid, 0); return { alive: true, startTicks: null, commandLine: '' }; }
    catch (error) { return { alive: error?.code === 'EPERM', startTicks: null, commandLine: '' }; }
  }
  try {
    const [stat, commandLine] = await Promise.all([
      fs.readFile(`/proc/${numericPid}/stat`, 'utf8'),
      fs.readFile(`/proc/${numericPid}/cmdline`, 'utf8')
    ]);
    const close = stat.lastIndexOf(')');
    const fields = close >= 0 ? stat.slice(close + 1).trim().split(/\s+/) : [];
    return { alive: !['Z', 'X'].includes(fields[0]), state: fields[0] || null, startTicks: fields[19] || null, commandLine: commandLine.replaceAll('\0', ' ').trim() };
  } catch (error) {
    return { alive: error?.code === 'EACCES' || error?.code === 'EPERM', startTicks: null, commandLine: '' };
  }
}

function processMatches(record, info, executable = '') {
  if (!info?.alive) return false;
  if (record?.startTicks && info.startTicks && String(record.startTicks) !== String(info.startTicks)) return false;
  if (process.platform !== 'linux') return false;
  const commandLine = String(info.commandLine || '');
  const expected = String(executable || record?.executable || 'cloudflared');
  return commandLine.includes(expected) && /\btunnel\b/.test(commandLine) && commandLine.includes('--url');
}

async function terminateVerifiedOrphan(record) {
  const pid = Number(record?.pid);
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  const info = await inspectLinuxProcess(pid);
  if (!info.alive) return;
  if (!processMatches(record, info)) {
    throw new Error(`PID ${pid} masih hidup tetapi identitas proses tidak cocok; lock Quick Tunnel dipertahankan demi keamanan.`);
  }
  try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error?.code !== 'ESRCH') throw error; }
  const wait = async milliseconds => {
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      const current = await inspectLinuxProcess(pid);
      if (!current.alive || (record.startTicks && current.startTicks && String(record.startTicks) !== String(current.startTicks))) return true;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  };
  if (await wait(1800)) return;
  const current = await inspectLinuxProcess(pid);
  if (current.alive && processMatches(record, current)) {
    try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error?.code !== 'ESRCH') throw error; }
  }
  if (!(await wait(1800))) throw new Error(`Proses cloudflared yatim PID ${pid} tidak berhenti setelah SIGKILL; tidak membuat tunnel pengganti.`);
}

async function readJsonFile(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch { return null; }
}

async function writeJsonAtomically(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, filePath);
}

async function acquireTunnelLease(binary) {
  if (state.tunnelLease) {
    const current = await readJsonFile(state.tunnelLease.path);
    if (current?.token === state.tunnelLease.token) return state.tunnelLease;
    state.tunnelLease = null;
  }
  if (!state.rootDir) throw new Error('Code Lab belum memiliki direktori runtime untuk lock tunnel.');
  await fs.mkdir(state.rootDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(state.rootDir, QUICK_TUNNEL_LOCK_NAME);
  const token = crypto.randomBytes(24).toString('base64url');
  const ownerInfo = await inspectLinuxProcess(process.pid);
  const baseRecord = {
    token,
    instanceId: state.instanceId,
    ownerPid: process.pid,
    ownerStartTicks: ownerInfo.startTicks || null,
    pid: null,
    startTicks: null,
    executable: path.basename(binary),
    createdAt: new Date().toISOString()
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let handle;
    try {
      handle = await fs.open(lockPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(baseRecord));
      await handle.sync().catch(() => {});
      await handle.close();
      state.tunnelLease = { path: lockPath, token, instanceId: state.instanceId };
      return state.tunnelLease;
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code !== 'EEXIST') throw error;
      const raw = await fs.readFile(lockPath, 'utf8').catch(() => '');
      const existing = (() => { try { return JSON.parse(raw); } catch { return null; } })();
      if (!existing) {
        const stat = await fs.stat(lockPath).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs < 5000) throw new Error('Lock Quick Tunnel sedang dibuat proses lain; coba kembali sebentar lagi.');
        await fs.rm(lockPath, { force: true }).catch(() => {});
        continue;
      }

      const owner = await inspectLinuxProcess(Number(existing.ownerPid));
      const ownerMatches = owner.alive && (!existing.ownerStartTicks || !owner.startTicks || String(existing.ownerStartTicks) === String(owner.startTicks));
      const tunnelInfo = existing.pid ? await inspectLinuxProcess(Number(existing.pid)) : null;
      const tunnelAlive = Boolean(tunnelInfo?.alive);
      const tunnelMatches = tunnelAlive && processMatches(existing, tunnelInfo);

      // A live, verified child belongs to a healthy owner and blocks a second
      // tunnel. If its owner PID/start-time is stale, reap that verified orphan
      // before replacing the lease; never kill an unverified PID.
      if (tunnelAlive && tunnelMatches && ownerMatches) {
        throw new Error(`Quick Tunnel masih aktif pada PID ${existing.pid} (owner PID ${existing.ownerPid}, instance ${existing.instanceId || 'unknown'}). Proses kedua diblokir.`);
      }
      if (tunnelAlive && tunnelMatches && !ownerMatches) await terminateVerifiedOrphan(existing);
      if (tunnelAlive && !tunnelMatches) {
        throw new Error(`PID ${existing.pid} masih hidup tetapi bukan proses cloudflared yang dapat diverifikasi; lock dipertahankan demi keamanan.`);
      }
      // pid:null means another process may be between acquiring the lease and
      // publishing the child PID. Keep that short startup window exclusive.
      if (!existing.pid && ownerMatches) {
        throw new Error(`Quick Tunnel sedang disiapkan instance Ocha lain (owner PID ${existing.ownerPid}, instance ${existing.instanceId || 'unknown'}). Proses kedua diblokir.`);
      }

      // A recorded child that no longer exists is a stale lease even when the
      // Ocha parent is still alive (for example, cloudflared exited unexpectedly).
      // The old owner must reacquire the lock before creating another child.
      const latest = await fs.readFile(lockPath, 'utf8').catch(() => '');
      if (latest !== raw) continue;
      await fs.rm(lockPath, { force: true });
    }
  }
  throw new Error('Tidak dapat memperoleh lock eksklusif Quick Tunnel setelah beberapa percobaan.');
}

async function updateTunnelLease(child, binary, generation) {
  const lease = state.tunnelLease;
  if (!lease) return;
  const identity = child.pid ? await inspectLinuxProcess(child.pid) : { startTicks: null };
  const current = await readJsonFile(lease.path);
  if (!current || current.token !== lease.token) throw new Error('Kepemilikan lock Quick Tunnel berubah sebelum proses siap.');
  const updated = {
    ...current,
    pid: child.pid || null,
    startTicks: identity.startTicks || null,
    executable: path.basename(binary),
    generation,
    updatedAt: new Date().toISOString()
  };
  await writeJsonAtomically(lease.path, updated);
  if (state.tunnelPidPath) await writeJsonAtomically(state.tunnelPidPath, updated);
}

async function releaseTunnelLease(expectedToken = null) {
  const lease = state.tunnelLease;
  if (!lease || (expectedToken && lease.token !== expectedToken)) return;
  // Detach local ownership before awaiting I/O. The tunnel operation queue
  // prevents a replacement from starting until this removal is complete.
  if (state.tunnelLease?.token === lease.token) state.tunnelLease = null;
  const current = await readJsonFile(lease.path);
  if (current?.token === lease.token) await fs.rm(lease.path, { force: true }).catch(() => {});
}

function waitForChildClose(child, timeoutMs) {
  return new Promise(resolve => {
    // `exitCode` is set on the `exit` event, which can precede `close` while
    // stdio handles are still draining. Wait for `close` before lease release.
    if (child.__ochaClosed) return resolve(true);
    let settled = false;
    const finish = closed => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('close', onClose);
      resolve(closed);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('close', onClose);
  });
}

async function stopTunnelProcess(child) {
  if (!child) return;
  if (child.__ochaExternal) {
    child.__ochaIntentionalStop = true;
    const record = child.__ochaRecord || await readTunnelRecord();
    if (record && Number(record.pid) === Number(child.pid)) await terminateVerifiedOrphan(record);
    child.__ochaClosed = true;
    if (state.tunnelPidPath) await fs.rm(state.tunnelPidPath, { force: true }).catch(() => {});
    await releaseTunnelLease(child.__ochaLeaseToken);
    if (state.tunnel === child) state.tunnel = null;
    return;
  }
  if (!child.__ochaClosed && child.exitCode === null && child.signalCode === null) child.__ochaIntentionalStop = true;
  if (!(await waitForChildClose(child, 0))) {
    try { child.kill('SIGTERM'); } catch {}
    if (!(await waitForChildClose(child, 2200))) {
      try { child.kill('SIGKILL'); } catch {}
      if (!(await waitForChildClose(child, 2200))) {
        throw new Error(`cloudflared PID ${child.pid || 'unknown'} tidak mengonfirmasi proses close; proses pengganti tidak akan dibuat.`);
      }
    }
  }
  if (child.__ochaExitCleanup) await child.__ochaExitCleanup;
  if (state.tunnel === child) state.tunnel = null;
  if (state.tunnelPidPath) {
    const record = await readJsonFile(state.tunnelPidPath);
    if (record?.token === child.__ochaLeaseToken && Number(record.pid) === Number(child.pid) && Number(record.generation) === Number(child.__ochaGeneration)) {
      await fs.rm(state.tunnelPidPath, { force: true }).catch(() => {});
    }
  }
  await releaseTunnelLease(child.__ochaLeaseToken);
}

function clearTunnelIdleTimer() {
  if (state.tunnelIdleTimer) clearTimeout(state.tunnelIdleTimer);
  state.tunnelIdleTimer = null;
}

function scheduleTunnelIdleStop() {
  clearTunnelIdleTimer();
  const idleMs = boundedInt(setting('tunnelIdleMs', 300_000), 300_000, 0, 3_600_000);
  if (idleMs === 0 || !state.tunnel || state.closing || state.sessions.size || state.pendingReservations) return;
  state.tunnelIdleTimer = setTimeout(() => {
    state.tunnelIdleTimer = null;
    void serializeTunnelOperation(async () => {
      if (state.closing || state.sessions.size || state.pendingReservations) return;
      await stopTunnelInternal();
      logger.info({ idleMs }, 'Quick Tunnel stopped after preview sessions became idle');
    }).catch(error => logger.warn({ message: error.message }, 'Quick Tunnel idle shutdown failed'));
  }, idleMs);
  state.tunnelIdleTimer.unref?.();
}

function recordTunnelFailure(error) {
  state.tunnelError = error instanceof Error ? error : new Error(String(error));
  state.tunnelFailures = Math.min(10, state.tunnelFailures + 1);
  const delay = Math.min(60_000, 2000 * (2 ** Math.min(state.tunnelFailures - 1, 5)));
  state.tunnelRetryAfter = Date.now() + delay;
  return state.tunnelError;
}

async function handleUnexpectedTunnelExit(child, code, signal) {
  if (state.closing || child.__ochaIntentionalStop) return;
  if (state.tunnel === child) {
    state.tunnel = null;
    state.tunnelUrl = null;
    state.tunnelPromise = null;
    state.tunnelStartedAt = null;
  }
  const error = recordTunnelFailure(new Error(`TryCloudflare berhenti (exit ${code ?? signal}).`));
  logger.error({ pid: child.pid, generation: child.__ochaGeneration, code, signal, retryAfter: state.tunnelRetryAfter }, 'Quick Tunnel process stopped unexpectedly');
  for (const session of [...state.sessions.values()]) await cleanupSession(session.id, 'tunnel-lost');
  // The next real preview request performs one fresh start. Never keep an
  // otherwise-unused Quick Tunnel running in the background after a failure.
}

async function readTunnelRecord() {
  if (!state.tunnelPidPath) return null;
  return readJsonFile(state.tunnelPidPath);
}

async function persistTunnelRecord(patch = {}) {
  const lease = state.tunnelLease;
  if (!lease) return null;
  const current = await readJsonFile(lease.path);
  if (!current || current.token !== lease.token) throw new Error('Kepemilikan Quick Tunnel berubah; record tidak ditimpa.');
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await writeJsonAtomically(lease.path, next);
  if (state.tunnelPidPath) await writeJsonAtomically(state.tunnelPidPath, next);
  return next;
}

async function isTunnelRecordAlive(record) {
  if (!record?.pid || !record?.url) return false;
  const info = await inspectLinuxProcess(Number(record.pid));
  return processMatches(record, info, record.executable);
}

async function adoptExistingTunnel() {
  const lockPath = state.rootDir ? path.join(state.rootDir, QUICK_TUNNEL_LOCK_NAME) : null;
  if (!lockPath || !state.tunnelPidPath) return false;
  let record = await readJsonFile(lockPath);
  const pidRecord = await readTunnelRecord();
  if (!record || !pidRecord || record.token !== pidRecord.token) return false;
  if (record.instanceId !== state.instanceId || !record.url) return false;

  const expectedOwner = Number(record.ownerPid);
  if (expectedOwner !== process.pid) {
    const handoffFrom = Number(process.env.OCHA_HANDOFF_FROM_PID || 0);
    if (!handoffFrom || expectedOwner !== handoffFrom) return false;
    const ownerInfo = await inspectLinuxProcess(expectedOwner);
    if (ownerInfo.alive) return false;
    record = await persistExternalOwner(lockPath, record, process.pid);
  }
  if (!(await isTunnelRecordAlive(record))) return false;

  state.tunnelLease = { path: lockPath, token: record.token, instanceId: state.instanceId };
  state.tunnel = {
    pid: Number(record.pid),
    exitCode: null,
    signalCode: null,
    __ochaClosed: false,
    __ochaExternal: true,
    __ochaIntentionalStop: false,
    __ochaLeaseToken: record.token,
    __ochaGeneration: Number(record.generation) || 0,
    __ochaRecord: record
  };
  state.tunnelUrl = String(record.url);
  state.tunnelStartedAt = record.startedAt || record.createdAt || null;
  state.tunnelGeneration = Math.max(state.tunnelGeneration, Number(record.generation) || 0);
  state.tunnelError = null;
  state.tunnelFailures = 0;
  state.tunnelRetryAfter = 0;
  logger.info({ tunnel: new URL(state.tunnelUrl).host, pid: record.pid, generation: record.generation, adopted: true }, 'Existing healthy TryCloudflare tunnel adopted; no replacement process started');
  return true;
}

async function persistExternalOwner(lockPath, record, ownerPid) {
  const ownerInfo = await inspectLinuxProcess(ownerPid);
  const latest = await readJsonFile(lockPath);
  if (!latest || latest.token !== record.token || Number(latest.pid) !== Number(record.pid)) {
    throw new Error('Quick Tunnel lease berubah selama controlled handoff.');
  }
  const next = { ...latest, ownerPid, ownerStartTicks: ownerInfo.startTicks || null, handoffAt: new Date().toISOString() };
  await writeJsonAtomically(lockPath, next);
  if (state.tunnelPidPath) await writeJsonAtomically(state.tunnelPidPath, next);
  return next;
}

async function waitForHandoffLease() {
  if (!process.env.OCHA_HANDOFF_FROM_PID || !state.rootDir) return false;
  const lockPath = path.join(state.rootDir, QUICK_TUNNEL_LOCK_NAME);
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const record = await readJsonFile(lockPath);
    if (record?.instanceId === state.instanceId && Number(record.ownerPid) === process.pid && record.url) return true;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return false;
}

async function startTunnelInternal() {
  if (state.closing) throw new Error('Code Lab sedang dihentikan.');
  if (!setting('publicTunnelEnabled', true)) throw new Error('Public TryCloudflare tunnel dinonaktifkan oleh owner.');
  if (state.tunnelUrl && state.tunnel && state.tunnel.exitCode === null && state.tunnel.signalCode === null) {
    if (!state.tunnel.__ochaExternal || await isTunnelRecordAlive(state.tunnel.__ochaRecord)) return state.tunnelUrl;
    state.tunnel.__ochaClosed = true;
    state.tunnel = null;
    state.tunnelUrl = null;
    state.tunnelStartedAt = null;
    state.tunnelLease = null;
  }
  if (state.tunnel) await stopTunnelProcess(state.tunnel);

  if (state.tunnelRetryAfter > Date.now()) {
    const seconds = Math.ceil((state.tunnelRetryAfter - Date.now()) / 1000);
    throw new Error(`Quick Tunnel sedang dalam jeda pemulihan. Coba kembali dalam ${seconds} detik.`);
  }
  if (!state.prerequisites.cloudflared) {
    try { await verifyTunnelPrerequisites(); }
    catch (error) { recordTunnelFailure(error); throw error; }
  }

  const binary = String(setting('cloudflaredBin', 'cloudflared'));
  const port = state.server?.address()?.port || boundedInt(setting('port', 8787), 8787, 1024, 65535);
  await acquireTunnelLease(binary);
  const generation = ++state.tunnelGeneration;
  let child;
  const logPath = state.tunnelLogPath || path.join(state.instanceDir, 'cloudflared.log');
  state.tunnelLogPath = logPath;
  await fs.mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
  await fs.truncate(logPath, 0).catch(() => {});
  let logHandle;
  try {
    logHandle = await fs.open(logPath, 'a', 0o600);
    child = spawn(binary, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
      stdio: ['ignore', logHandle.fd, logHandle.fd], windowsHide: true, detached: true,
      env: { PATH: process.env.PATH || '', HOME: process.env.HOME || os.tmpdir(), NO_COLOR: '1' }
    });
    child.unref();
  } catch (error) {
    await logHandle?.close().catch(() => {});
    await releaseTunnelLease(state.tunnelLease?.token);
    const failure = new Error(`cloudflared tidak dapat dijalankan (${error.code || error.message}). Periksa instalasi cloudflared.`);
    recordTunnelFailure(failure);
    throw failure;
  }
  await logHandle?.close().catch(() => {});

  child.__ochaGeneration = generation;
  child.__ochaLeaseToken = state.tunnelLease?.token || null;
  child.__ochaClosed = false;
  child.__ochaIntentionalStop = false;
  child.__ochaLogPath = logPath;
  state.tunnel = child;
  state.tunnelStartedAt = new Date().toISOString();
  const pidWritePromise = updateTunnelLease(child, binary, generation).catch(async error => {
    logger.error({ pid: child.pid, message: error.message }, 'Failed to persist Quick Tunnel process identity');
    try { child.kill('SIGTERM'); } catch {}
  });

  let timer;
  let pollTimer;
  let settled = false;
  let output = '';
  const readyPromise = new Promise((resolve, reject) => {
    const cleanupTimers = () => { clearTimeout(timer); clearInterval(pollTimer); };
    const fail = error => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      state.tunnelPromise = null;
      reject(error);
    };
    const inspect = async () => {
      try { output = (await fs.readFile(logPath, 'utf8')).slice(-16_000); }
      catch {}
      const match = output.match(URL_PATTERN);
      if (match && !settled && state.tunnel === child && !child.__ochaIntentionalStop) {
        settled = true;
        cleanupTimers();
        state.tunnelUrl = match[0].replace(/\/$/, '');
        state.tunnelError = null;
        state.tunnelFailures = 0;
        state.tunnelRetryAfter = 0;
        state.tunnelPromise = null;
        try { await persistTunnelRecord({ url: state.tunnelUrl, startedAt: state.tunnelStartedAt }); }
        catch (error) { logger.warn({ message: error.message }, 'Could not persist public tunnel URL for controlled handoff'); }
        logger.info({ tunnel: new URL(state.tunnelUrl).host, pid: child.pid, generation, mode: 'on-demand' }, 'Shared on-demand TryCloudflare tunnel ready');
        resolve(state.tunnelUrl);
        return;
      }
      if (child.exitCode !== null || child.signalCode !== null) fail(new Error(`Quick Tunnel berhenti sebelum URL siap (exit ${child.exitCode ?? child.signalCode}). ${output.slice(-900)}`));
    };
    pollTimer = setInterval(() => { void inspect(); }, 200);
    pollTimer.unref?.();
    child.once('error', error => fail(new Error(`cloudflared tidak dapat dijalankan (${error.code || error.message}). Periksa binary dan permission.`)));
    child.once('close', (code, signal) => {
      child.__ochaClosed = true;
      cleanupTimers();
      const wasCurrent = state.tunnel === child;
      const wasReady = settled && Boolean(state.tunnelUrl);
      if (!settled) fail(new Error(`Quick Tunnel berhenti sebelum URL siap (exit ${code ?? signal}). ${output.slice(-900)}`));
      child.__ochaExitCleanup = (async () => {
        await pidWritePromise;
        if (state.tunnelPidPath) {
          const record = await readJsonFile(state.tunnelPidPath);
          if (record?.token === child.__ochaLeaseToken && Number(record.pid) === Number(child.pid) && Number(record.generation) === generation) {
            await fs.rm(state.tunnelPidPath, { force: true }).catch(() => {});
          }
        }
        await releaseTunnelLease(child.__ochaLeaseToken);
        if (state.tunnel === child) {
          state.tunnel = null;
          state.tunnelUrl = null;
          state.tunnelPromise = null;
          state.tunnelStartedAt = null;
        }
        if (wasCurrent && wasReady && !state.closing && !child.__ochaIntentionalStop) {
          await handleUnexpectedTunnelExit(child, code, signal);
        } else {
          logger.info({ pid: child.pid, generation, code, signal, intentional: child.__ochaIntentionalStop }, 'Quick Tunnel process closed');
        }
      })().catch(error => {
        logger.error({ pid: child.pid, generation, message: error.message }, 'Quick Tunnel exit cleanup failed; replacement is blocked until lock recovery');
        throw error;
      });
      child.__ochaExitCleanup.catch(() => {});
    });
    timer = setTimeout(() => {
      fail(new Error(`TryCloudflare belum memberikan URL dalam 25 detik. ${output.slice(-900)}`));
      try { child.kill('SIGTERM'); } catch {}
    }, 25_000);
    timer.unref?.();
    void inspect();
  });
  state.tunnelPromise = readyPromise;
  await pidWritePromise;
  try {
    const url = await readyPromise;
    if (state.tunnel !== child || child.__ochaClosed || child.exitCode !== null || state.tunnelUrl !== url) {
      throw new Error('Quick Tunnel terputus sebelum sesi preview selesai disiapkan. Coba ulang setelah jeda pemulihan.');
    }
    return url;
  } catch (error) {
    recordTunnelFailure(error);
    throw error;
  }
}

async function stopTunnelInternal() {
  clearTunnelIdleTimer();
  const child = state.tunnel;
  state.tunnelUrl = null;
  state.tunnelPromise = null;
  if (child) await stopTunnelProcess(child);
  else {
    if (state.tunnelPidPath) await fs.rm(state.tunnelPidPath, { force: true }).catch(() => {});
    await releaseTunnelLease();
  }
  state.tunnelStartedAt = null;
}

function startTunnel() {
  clearTunnelIdleTimer();
  return serializeTunnelOperation(async () => {
    if (!setting('publicTunnelEnabled', true)) throw new Error('Public TryCloudflare tunnel dinonaktifkan oleh owner.');
    if (state.tunnelUrl && state.tunnel && !state.tunnel.__ochaClosed && state.tunnel.exitCode === null && state.tunnel.signalCode === null) {
      if (!state.tunnel.__ochaExternal || await isTunnelRecordAlive(state.tunnel.__ochaRecord)) return state.tunnelUrl;
      state.tunnel.__ochaClosed = true;
      state.tunnel = null;
      state.tunnelUrl = null;
      state.tunnelLease = null;
    }
    return startTunnelInternal();
  }).catch(error => {
    if (setting('publicTunnelEnabled', true) && !state.tunnelUrl) state.tunnelError = error;
    throw error;
  });
}

function stopTunnel() {
  return serializeTunnelOperation(stopTunnelInternal);
}

function validateWebsiteFiles(files) {
  const entries = Object.entries(files || {});
  const allowedExtensions = new Set(['.html', '.css', '.js', '.mjs', '.svg', '.json', '.txt', '.webmanifest', '.xml']);
  if (!entries.length || entries.length > 80 || !Object.hasOwn(files || {}, 'index.html')) throw new Error('Proyek website tidak valid atau tidak memiliki index.html.');
  let totalBytes = 0;
  const safeFiles = Object.create(null);
  for (const [filePath, content] of entries) {
    const extension = path.posix.extname(filePath).toLowerCase();
    if (typeof content !== 'string' || filePath.length > 180 || filePath.startsWith('/') || filePath.includes('\\') || filePath.includes('\0') || !allowedExtensions.has(extension) || filePath.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.') || ['node_modules', 'sessions', 'data'].includes(part.toLowerCase()))) throw new Error(`Path/konten website tidak aman: ${filePath}`);
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > 512 * 1024) throw new Error(`File ${filePath} melewati batas 512 KB.`);
    totalBytes += bytes;
    if (totalBytes > 4 * 1024 * 1024) throw new Error('Total ukuran website melewati batas 4 MB.');
    safeFiles[filePath] = content;
  }
  return { entries, totalBytes, safeFiles };
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
  const runtime = selectedRuntime();
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
  session.runtime = runtime;
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
  const runtime = session.runtime || selectedRuntime();
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
  if (session.files) session.files = Object.create(null);
  logger.info({ sessionId: id, reason }, 'Code Lab session destroyed');
  scheduleTunnelIdleStop();
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
  if (state.watchdog) return state.watchdog;
  if (state.watchdogPromise) return state.watchdogPromise;
  if (state.closing) throw new Error('Code Lab sedang dihentikan; watchdog tidak boleh dibuat.');
  state.watchdogPromise = (async () => {
    const instanceDir = state.instanceDir;
    state.heartbeatPath = path.join(instanceDir, 'heartbeat');
    state.shutdownPath = path.join(instanceDir, 'shutdown');
    state.tunnelPidPath = path.join(instanceDir, 'cloudflared.pid');
    state.ownerPath = path.join(instanceDir, 'owner.json');
    state.watchdogPidPath = path.join(instanceDir, 'watchdog.json');
    await fs.mkdir(instanceDir, { recursive: true, mode: 0o700 });
    await fs.rm(state.shutdownPath, { force: true }).catch(() => {});
    const ownerInfo = await inspectLinuxProcess(process.pid);
    await writeJsonAtomically(state.ownerPath, { pid: process.pid, startTicks: ownerInfo.startTicks || null, updatedAt: new Date().toISOString() });
    await fs.writeFile(state.heartbeatPath, String(Date.now()), { mode: 0o600 });

    const existing = await readJsonFile(state.watchdogPidPath);
    if (existing?.pid) {
      const info = await inspectLinuxProcess(Number(existing.pid));
      const isWatchdog = info.alive && info.commandLine.includes(path.basename(WATCHDOG_FILE));
      if (isWatchdog && Number(existing.protocolVersion) >= WATCHDOG_PROTOCOL_VERSION) {
        state.watchdog = {
          pid: Number(existing.pid),
          kill(signal = 'SIGTERM') { try { process.kill(Number(existing.pid), signal); } catch {} }
        };
        logger.debug({ pid: existing.pid, protocolVersion: existing.protocolVersion }, 'Existing Code Lab watchdog adopted');
        return state.watchdog;
      }
      if (info.alive && !isWatchdog) {
        throw new Error(`PID watchdog ${existing.pid} hidup tetapi identitas proses tidak cocok; tidak akan menimpa lock worker.`);
      }
      if (isWatchdog) {
        // Replace only a verified legacy watchdog. Older workers pin the
        // original parent PID and cannot follow an atomic runtime handoff.
        try { process.kill(Number(existing.pid), 'SIGTERM'); } catch (error) { if (error?.code !== 'ESRCH') throw error; }
        const deadline = Date.now() + 1800;
        while (Date.now() < deadline) {
          const current = await inspectLinuxProcess(Number(existing.pid));
          if (!current.alive) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        const current = await inspectLinuxProcess(Number(existing.pid));
        if (current.alive) throw new Error(`Legacy Code Lab watchdog PID ${existing.pid} tidak berhenti; tidak membuat worker duplikat.`);
      }
      await fs.rm(state.watchdogPidPath, { force: true }).catch(() => {});
    }

    const child = spawn(process.execPath, [WATCHDOG_FILE, String(process.pid), state.instanceId, instanceDir, String(state.runtimeName || selectedRuntime())], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: { PATH: process.env.PATH || '', HOME: process.env.HOME || os.tmpdir() }
    });
    state.watchdog = child;
    child.unref();
    if (child.pid) await writeJsonAtomically(state.watchdogPidPath, { pid: child.pid, protocolVersion: WATCHDOG_PROTOCOL_VERSION, startedAt: new Date().toISOString() });
    child.once('error', error => {
      if (state.watchdog === child) state.watchdog = null;
      logger.warn({ code: error.code, message: error.message }, 'Code Lab orphan watchdog failed to start');
    });
    child.once('exit', () => { if (state.watchdog === child) state.watchdog = null; });
    return child;
  })();
  try { return await state.watchdogPromise; }
  finally { state.watchdogPromise = null; }
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
let runtimeProbePromise;
let runtimeProbeRetryAfter = 0;

export async function startCodeLab() {
  if (!setting('enabled', true)) return { enabled: false, reason: 'disabled' };
  if (state.startPromise) return state.startPromise;
  state.startPromise = (async () => {
    state.closing = false;
    // Direct Code Lab consumers (tests/embedded usage) still get a one-time
    // runtime probe. The main application sets this marker after its central
    // host preflight so a source hot reload never probes Docker/Podman again.
    if (process.env.OCHA_HOST_PREFLIGHT_COMPLETED !== '1' && !state.prerequisites.runtime) {
      try { await ensureRuntimePrerequisites(); }
      catch (error) { logger.warn({ message: error.message }, 'Code Lab runtime remains unavailable after startup preflight; execution stays fail-closed'); }
    }
    if (!state.startedAt) state.startedAt = new Date().toISOString();
    if (!state.rootDir) state.rootDir = path.resolve(String(setting('tempDir', path.join(os.tmpdir(), 'ocha-code-lab'))));
    if (!state.instanceId) state.instanceId = `main-${crypto.createHash('sha256').update(`${path.resolve(process.cwd())}:${state.rootDir}`).digest('hex').slice(0, 14)}`;
    if (!state.instanceDir) state.instanceDir = path.join(state.rootDir, `instance-${state.instanceId}`);
    await fs.mkdir(state.instanceDir, { recursive: true, mode: 0o700 });
    state.heartbeatPath = path.join(state.instanceDir, 'heartbeat');
    state.shutdownPath = path.join(state.instanceDir, 'shutdown');
    state.tunnelPidPath = path.join(state.instanceDir, 'cloudflared.pid');
    state.ownerPath = path.join(state.instanceDir, 'owner.json');
    state.watchdogPidPath = path.join(state.instanceDir, 'watchdog.json');
    state.tunnelLogPath = path.join(state.instanceDir, 'cloudflared.log');
    await fs.rm(state.shutdownPath, { force: true }).catch(() => {});

    // Runtime provisioning has already been attempted by the host bootstrap.
    // Do not re-run Docker/Podman startup on every JS hot reload. The runtime
    // is revalidated lazily on the first Python/Node execution request.
    await ensureServer();
    if (process.env.OCHA_HANDOFF_FROM_PID) await waitForHandoffLease();
    if (await adoptExistingTunnel()) {
      await ensureWatchdog();
      if (!heartbeatTimer) heartbeatTimer = startHeartbeat();
    }

    logger.info({ mode: 'on-demand', gateway: `127.0.0.1:${state.server.address()?.port}`, tunnelAdopted: Boolean(state.tunnelUrl), tunnel: state.tunnelUrl || null }, 'Code Lab initialized');
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
    try { await ensureRuntimePrerequisites(); }
    catch (error) {
      throw new Error(`${state.prerequisites.runtimeError || 'Container runtime belum lolos pemeriksaan.'} Pemeriksaan otomatis akan dicoba lagi pada permintaan eksekusi setelah cooldown. Detail: ${error.message}`);
    }
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
    await ensureWatchdog();
    if (!heartbeatTimer) heartbeatTimer = startHeartbeat();
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

    if (!state.sessions.has(id) || state.tunnelUrl !== baseUrl || !state.tunnel || state.tunnel.__ochaClosed || state.tunnel.exitCode !== null) {
      await cleanupSession(id, 'tunnel-lost');
      throw new Error('Quick Tunnel terputus saat sesi disiapkan. Minta Ocha membuat preview baru.');
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
    scheduleTunnelIdleStop();
  }
}

export async function createWebsiteSession({ ownerId, chatId = '', title = 'Website Preview', summary = '', files = {} }) {
  if (!setting('enabled', true) || !setting('websiteBuilderEnabled', true)) throw new Error('Nexora Website Builder sedang dinonaktifkan oleh owner.');
  if (!setting('aiExecutionEnabled', true)) throw new Error('Auto-run Nexora sedang dinonaktifkan oleh owner.');
  if (!setting('publicTunnelEnabled', true)) throw new Error('Preview publik sedang dinonaktifkan oleh owner.');
  if (state.closing) throw new Error('Code Lab sedang dihentikan.');
  if (!state.server?.listening) await startCodeLab();
  const { entries, totalBytes, safeFiles } = validateWebsiteFiles(files);
  const ownerKey = crypto.createHash('sha256').update(String(ownerId || 'anonymous')).digest('hex').slice(0, 16);
  const totalLimit = boundedInt(setting('maxSessionsTotal', 20), 20, 1, 100);
  const perUserLimit = boundedInt(setting('maxSessionsPerUser', 2), 2, 1, 10);
  const reservedForUser = state.reservations.get(ownerKey) || 0;
  if (state.sessions.size + state.pendingReservations >= totalLimit) throw new Error('Kapasitas sesi Code Lab sedang penuh. Coba lagi nanti.');
  if (ownerSessionCounts(ownerKey) + reservedForUser >= perUserLimit) throw new Error(`Batas ${perUserLimit} sesi aktif per pengguna telah tercapai.`);
  state.pendingReservations += 1;
  state.reservations.set(ownerKey, reservedForUser + 1);
  try {
    checkRateLimit(ownerKey);
    await ensureServer();
    await ensureWatchdog();
    if (!heartbeatTimer) heartbeatTimer = startHeartbeat();
    const baseUrl = await startTunnel();
    if (state.closing) throw new Error('Code Lab sedang dihentikan.');
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(SENSITIVE_TOKEN_BYTES).toString('base64url');
    const ttlMs = boundedInt(setting('ttlMs', 3_600_000), 3_600_000, 60_000, 3_600_000);
    const createdAt = new Date().toISOString();
    const session = {
      id, token, tokenHash: crypto.createHash('sha256').update(token).digest(), ownerKey,
      chatKey: crypto.createHash('sha256').update(String(chatId)).digest('hex').slice(0, 12),
      language: 'website', title: String(title || 'Website Preview').slice(0, 80), summary: String(summary || '').slice(0, 240),
      files: safeFiles, projectVersion: 1, status: 'completed', stdout: `Website siap dipratinjau (${entries.length} file, ${totalBytes} byte).`, stderr: '', exitCode: 0,
      createdAt, expiresAt: Date.now() + ttlMs, child: null, containerStarted: false, pendingInputs: [],
      expiryTimer: null, executionTimer: null, startedAt: createdAt, lastOutputAt: Date.now(), lastInputAt: 0, inputCount: 0
    };
    state.sessions.set(id, session);
    session.expiryTimer = setTimeout(() => { void cleanupSession(id, 'expired'); }, ttlMs);
    session.expiryTimer.unref?.();
    if (!state.sessions.has(id) || state.tunnelUrl !== baseUrl || !state.tunnel || state.tunnel.__ochaClosed || state.tunnel.exitCode !== null) {
      await cleanupSession(id, 'tunnel-lost');
      throw new Error('Quick Tunnel terputus saat website preview disiapkan. Minta Ocha membuat preview baru.');
    }
    const previewUrl = `${baseUrl}/s/${id}/${token}`;
    logger.info({ sessionId: id, ownerKey, fileCount: entries.length, totalBytes, expiresAt: new Date(session.expiresAt).toISOString() }, 'Nexora website project published');
    return { id, language: 'website', title: session.title, summary: session.summary, fileCount: entries.length, totalBytes, version: session.projectVersion, status: session.status, previewUrl, expiresAt: new Date(session.expiresAt).toISOString(), ttlMs };
  } finally {
    state.pendingReservations = Math.max(0, state.pendingReservations - 1);
    const remaining = (state.reservations.get(ownerKey) || 1) - 1;
    if (remaining > 0) state.reservations.set(ownerKey, remaining);
    else state.reservations.delete(ownerKey);
    scheduleTunnelIdleStop();
  }
}

export function getLatestWebsiteProject({ ownerId, chatId = '' }) {
  const ownerKey = crypto.createHash('sha256').update(String(ownerId || 'anonymous')).digest('hex').slice(0, 16);
  const chatKey = crypto.createHash('sha256').update(String(chatId)).digest('hex').slice(0, 12);
  const session = [...state.sessions.values()]
    .filter(item => item.language === 'website' && item.ownerKey === ownerKey && item.chatKey === chatKey && Date.now() < item.expiresAt)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (!session) return null;
  return { id: session.id, title: session.title, summary: session.summary, files: { ...session.files }, version: session.projectVersion, expiresAt: new Date(session.expiresAt).toISOString() };
}

export async function updateWebsiteSession({ ownerId, chatId = '', sessionId, title, summary, files }) {
  if (!setting('enabled', true) || !setting('websiteBuilderEnabled', true) || !setting('aiExecutionEnabled', true) || !setting('publicTunnelEnabled', true)) throw new Error('Website Builder, auto-run, atau tunnel sedang dinonaktifkan oleh owner.');
  const session = state.sessions.get(String(sessionId || ''));
  const ownerKey = crypto.createHash('sha256').update(String(ownerId || 'anonymous')).digest('hex').slice(0, 16);
  const chatKey = crypto.createHash('sha256').update(String(chatId)).digest('hex').slice(0, 12);
  if (!session || session.language !== 'website' || session.ownerKey !== ownerKey || session.chatKey !== chatKey || Date.now() >= session.expiresAt) throw new Error('Proyek website aktif tidak ditemukan atau bukan milik percakapan ini.');
  if (!state.tunnelUrl || !state.tunnel || state.tunnel.__ochaClosed || state.tunnel.exitCode !== null) throw new Error('Quick Tunnel sedang tidak tersedia. Buat preview baru untuk menerbitkan URL publik yang aktif.');
  const { entries, totalBytes, safeFiles } = validateWebsiteFiles(files);
  // Swap the complete manifest in one synchronous operation; in-flight requests
  // see either the previous complete version or the new complete version.
  session.files = safeFiles;
  session.title = String(title || session.title || 'Website Preview').slice(0, 80);
  session.summary = String(summary || '').slice(0, 240);
  session.projectVersion = (Number(session.projectVersion) || 1) + 1;
  session.stdout = `Website diperbarui ke versi ${session.projectVersion} (${entries.length} file, ${totalBytes} byte).`;
  session.lastOutputAt = Date.now();
  const previewUrl = `${state.tunnelUrl}/s/${session.id}/${session.token}`;
  logger.info({ sessionId: session.id, ownerKey, projectVersion: session.projectVersion, fileCount: entries.length, totalBytes }, 'Nexora website project updated');
  return { id: session.id, language: 'website', title: session.title, summary: session.summary, fileCount: entries.length, totalBytes, version: session.projectVersion, status: session.status, previewUrl, expiresAt: new Date(session.expiresAt).toISOString(), ttlMs: session.expiresAt - Date.now(), updated: true };
}

export async function prepareCodeLabHandoff(nextPid) {
  if (state.handoffInProgress) return { preserved: Boolean(state.tunnelUrl), instanceId: state.instanceId };
  const replacementPid = Number(nextPid);
  if (!Number.isSafeInteger(replacementPid) || replacementPid <= 1) throw new Error('PID proses pengganti tidak valid; handoff tidak dimulai.');
  const nextOwner = await inspectLinuxProcess(replacementPid);
  if (!nextOwner.alive || (process.platform === 'linux' && !nextOwner.startTicks)) {
    throw new Error(`Proses pengganti PID ${replacementPid} belum hidup atau identitas prosesnya tidak dapat diverifikasi; handoff tidak dimulai.`);
  }
  state.handoffInProgress = true;
  state.closing = true;
  clearTunnelIdleTimer();
  if (state.startPromise) { try { await state.startPromise; } catch {} }
  if (runtimeProbePromise) { try { await runtimeProbePromise; } catch {} }
  if (state.sessions.size) {
    for (const session of [...state.sessions.values()]) await cleanupSession(session.id, 'source-handoff');
  }
  state.queue.length = 0;
  if (state.server) {
    const server = state.server;
    await new Promise(resolve => {
      let settled = false;
      const finish = () => { if (settled) return; settled = true; clearTimeout(forceTimer); resolve(); };
      const forceTimer = setTimeout(() => {
        try { server.closeAllConnections?.(); } catch {}
        finish();
      }, 1800);
      server.close(finish);
    });
    state.server = null;
  }

  const previousTunnelPid = Number(state.tunnel?.pid) || null;
  let preserved = false;
  if (state.tunnel && state.tunnelUrl && state.tunnelLease) {
    const record = await readJsonFile(state.tunnelLease.path);
    if (record?.token === state.tunnelLease.token && await isTunnelRecordAlive(record)) {
      const next = { ...record, ownerPid: replacementPid, ownerStartTicks: nextOwner.startTicks || null, handoffAt: new Date().toISOString() };
      await writeJsonAtomically(state.tunnelLease.path, next);
      if (state.tunnelPidPath) await writeJsonAtomically(state.tunnelPidPath, next);
      preserved = true;
      logger.info({ tunnelPid: record.pid, nextOwnerPid: replacementPid, url: record.url }, 'Healthy TryCloudflare tunnel ownership transferred to replacement process');
    }
  }

  if (!preserved) await stopTunnel();

  // The watchdog is a separate process. V2 reads owner.json on every check,
  // so it can survive a parent PID handoff without being restarted. A legacy
  // worker pins the old parent PID; replace that worker only, never the tunnel.
  if (state.ownerPath) await writeJsonAtomically(state.ownerPath, { pid: replacementPid, startTicks: nextOwner.startTicks || null, updatedAt: new Date().toISOString() });
  if (state.heartbeatPath) await fs.writeFile(state.heartbeatPath, String(Date.now()), { mode: 0o600 });

  const watchdogRecord = state.watchdogPidPath ? await readJsonFile(state.watchdogPidPath) : null;
  const watchdogPid = Number(watchdogRecord?.pid || state.watchdog?.pid) || null;
  const watchdogProtocol = Number(watchdogRecord?.protocolVersion || (state.watchdog ? WATCHDOG_PROTOCOL_VERSION : 0));
  let watchdogPreserved = false;
  if (watchdogPid && watchdogProtocol >= WATCHDOG_PROTOCOL_VERSION) {
    const watchdogInfo = await inspectLinuxProcess(watchdogPid);
    watchdogPreserved = watchdogInfo.alive && watchdogInfo.commandLine.includes(path.basename(WATCHDOG_FILE));
  }

  if (!watchdogPreserved && watchdogPid) {
    const watchdogInfo = await inspectLinuxProcess(watchdogPid);
    if (watchdogInfo.alive) {
      if (!watchdogInfo.commandLine.includes(path.basename(WATCHDOG_FILE))) {
        throw new Error(`PID ${watchdogPid} tidak dapat diverifikasi sebagai Code Lab watchdog; handoff dibatalkan.`);
      }
      try { process.kill(watchdogPid, 'SIGTERM'); }
      catch (error) { if (error?.code !== 'ESRCH') throw error; }
      const deadline = Date.now() + 1800;
      while (Date.now() < deadline) {
        const current = await inspectLinuxProcess(watchdogPid);
        if (!current.alive) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const current = await inspectLinuxProcess(watchdogPid);
      if (current.alive) {
        try { process.kill(watchdogPid, 'SIGKILL'); } catch (error) { if (error?.code !== 'ESRCH') throw error; }
        const killDeadline = Date.now() + 1200;
        while (Date.now() < killDeadline) {
          const latest = await inspectLinuxProcess(watchdogPid);
          if (!latest.alive) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if ((await inspectLinuxProcess(watchdogPid)).alive) {
          throw new Error(`Code Lab watchdog PID ${watchdogPid} tidak berhenti; proses pengganti tidak boleh mengambil alih worker yang belum selesai.`);
        }
      }
    }
    await fs.rm(state.watchdogPidPath, { force: true }).catch(() => {});
  }

  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  if (preserved) {
    state.tunnel = null;
    state.tunnelLease = null;
    state.tunnelUrl = null;
    state.tunnelPromise = null;
  }
  state.watchdog = null;
  state.watchdogPromise = null;

  const result = {
    preserved,
    watchdogPreserved,
    instanceId: state.instanceId,
    instanceDir: state.instanceDir,
    tunnelPid: preserved ? previousTunnelPid : null
  };
  logger.info({ tunnelPreserved: preserved, watchdogPreserved, nextPid: replacementPid }, 'Code Lab runtime handoff prepared without duplicate tunnel/watchdog processes');
  return result;
}

export async function cancelCodeLabHandoff() {
  // A failed replacement must leave the current runtime usable. The main
  // process retains its instance lock until this rollback completes.
  state.handoffInProgress = false;
  state.closing = false;
  clearTunnelIdleTimer();

  if (state.instanceDir) {
    state.heartbeatPath ||= path.join(state.instanceDir, 'heartbeat');
    state.shutdownPath ||= path.join(state.instanceDir, 'shutdown');
    state.tunnelPidPath ||= path.join(state.instanceDir, 'cloudflared.pid');
    state.ownerPath ||= path.join(state.instanceDir, 'owner.json');
    state.watchdogPidPath ||= path.join(state.instanceDir, 'watchdog.json');
    await fs.rm(state.shutdownPath, { force: true }).catch(() => {});

    const ownerInfo = await inspectLinuxProcess(process.pid);
    await writeJsonAtomically(state.ownerPath, {
      pid: process.pid,
      startTicks: ownerInfo.startTicks || null,
      updatedAt: new Date().toISOString(),
      rollbackAt: new Date().toISOString()
    });

    const lockPath = state.rootDir ? path.join(state.rootDir, QUICK_TUNNEL_LOCK_NAME) : null;
    let record = state.tunnelLease?.path ? await readJsonFile(state.tunnelLease.path) : null;
    if (!record && lockPath) record = await readJsonFile(lockPath);
    if (record?.instanceId === state.instanceId && await isTunnelRecordAlive(record)) {
      const currentOwnerPid = Number(record.ownerPid) || 0;
      if (currentOwnerPid !== process.pid) {
        const currentOwner = await inspectLinuxProcess(currentOwnerPid);
        if (currentOwner.alive) {
          throw new Error(`Rollback Code Lab ditunda: owner tunnel PID ${currentOwnerPid} masih hidup; tidak mengambil alih proses yang belum berhenti.`);
        }
        record = {
          ...record,
          ownerPid: process.pid,
          ownerStartTicks: ownerInfo.startTicks || null,
          handoffRollbackAt: new Date().toISOString()
        };
        await writeJsonAtomically(lockPath || state.tunnelLease.path, record);
        await writeJsonAtomically(state.tunnelPidPath, record);
      }
      state.tunnelLease = { path: lockPath || state.tunnelLease?.path, token: record.token, instanceId: state.instanceId };
      if (!state.tunnel || state.tunnel.__ochaClosed) {
        state.tunnel = {
          pid: Number(record.pid),
          exitCode: null,
          signalCode: null,
          __ochaClosed: false,
          __ochaExternal: true,
          __ochaIntentionalStop: false,
          __ochaLeaseToken: record.token,
          __ochaGeneration: Number(record.generation) || 0,
          __ochaRecord: record
        };
      }
      state.tunnelUrl = String(record.url);
      state.tunnelStartedAt = record.startedAt || record.createdAt || null;
      state.tunnelGeneration = Math.max(state.tunnelGeneration, Number(record.generation) || 0);
    }

    await ensureServer();
    if (state.tunnel && state.tunnelUrl) {
      const watchdogRecord = await readJsonFile(state.watchdogPidPath);
      if (watchdogRecord?.pid || state.watchdog) await ensureWatchdog();
      if (!heartbeatTimer) heartbeatTimer = startHeartbeat();
    }
  }

  logger.warn({ pid: process.pid, tunnelRestored: Boolean(state.tunnelUrl), gatewayListening: Boolean(state.server?.listening) }, 'Failed source handoff rolled back; previous Code Lab runtime restored');
  return { restored: true, tunnelPreserved: Boolean(state.tunnelUrl), gatewayListening: Boolean(state.server?.listening) };
}

export async function stopCodeLab() {
  if (state.closing) return;
  state.closing = true;
  clearTunnelIdleTimer();
  if (state.startPromise) {
    try { await state.startPromise; } catch {}
  }
  if (runtimeProbePromise) {
    try { await runtimeProbePromise; } catch {}
  }
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  for (const session of [...state.sessions.values()]) await cleanupSession(session.id, 'stopped');
  state.queue.length = 0;
  await stopTunnel();
  if (state.server) {
    await new Promise(resolve => state.server.close(() => resolve()));
    state.server = null;
  }
  if (state.shutdownPath) await fs.writeFile(state.shutdownPath, 'clean', { mode: 0o600 }).catch(() => {});
  const watchdog = state.watchdog;
  if (watchdog) {
    if (typeof watchdog.once === 'function') {
      try { watchdog.kill('SIGTERM'); } catch {}
      if (!(await waitForChildClose(watchdog, 1200))) {
        try { watchdog.kill('SIGKILL'); } catch {}
        await waitForChildClose(watchdog, 800);
      }
    } else if (Number(watchdog.pid) > 1) {
      try { process.kill(Number(watchdog.pid), 'SIGTERM'); } catch {}
      const deadline = Date.now() + 1200;
      while (Date.now() < deadline) {
        const info = await inspectLinuxProcess(watchdog.pid);
        if (!info.alive) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const info = await inspectLinuxProcess(watchdog.pid);
      if (info.alive) { try { process.kill(Number(watchdog.pid), 'SIGKILL'); } catch {} }
    }
  }
  if (state.watchdogPidPath) await fs.rm(state.watchdogPidPath, { force: true }).catch(() => {});
  state.watchdog = null;
  state.watchdogPromise = null;
  if (state.instanceDir) await fs.rm(state.instanceDir, { recursive: true, force: true }).catch(() => {});
  state.instanceDir = null;
  state.instanceId = null;
  state.tunnelPidPath = null;
  state.tunnelLogPath = null;
  state.ownerPath = null;
  state.watchdogPidPath = null;
  state.heartbeatPath = null;
  state.shutdownPath = null;
  state.startedAt = null;
  state.runtimeName = null;
  state.prerequisites.runtime = null;
  state.prerequisites.runtimeError = null;
  runtimeProbeRetryAfter = 0;
  logger.info('Code Lab gateway, workers, tunnel, and temporary sessions stopped');
}

export function applyHostPreflightResult(result = {}) {
  const record = result.cached || result;
  if (!record || typeof record !== 'object') return getCodeLabStatus();
  const selected = String(record.runtimeSelected || record.runtime || '');
  if (selected === 'docker' || selected === 'podman') {
    state.runtimeName = selected;
    state.prerequisites.runtime = true;
    state.prerequisites.runtimeError = null;
    runtimeProbeRetryAfter = 0;
  } else if (selected === 'none') {
    state.runtimeName = null;
    state.prerequisites.runtime = null;
    const detail = String(record.lastOutputTail || '').trim().slice(-1200);
    state.prerequisites.runtimeError = `Host preflight belum menemukan Docker/Podman yang dapat digunakan.${detail ? ` ${detail}` : ''}`;
    runtimeProbeRetryAfter = Date.now() + 15_000;
  }
  if (record.cloudflared === 'available') state.prerequisites.cloudflared = 'available (host preflight)';
  else if (record.cloudflared === 'unavailable-or-unknown') state.prerequisites.cloudflared = null;
  return getCodeLabStatus();
}

export function getCodeLabStatus() {
  return {
    enabled: Boolean(setting('enabled', true)),
    aiExecutionEnabled: Boolean(setting('aiExecutionEnabled', true)),
    publicTunnelEnabled: Boolean(setting('publicTunnelEnabled', true)),
    gateway: state.server?.listening ? `127.0.0.1:${state.server.address()?.port}` : 'offline',
    tunnel: !setting('publicTunnelEnabled', true) ? 'OFF' : (state.tunnelUrl || (state.tunnelError ? 'error' : (state.tunnel ? 'starting' : 'idle/on-demand'))),
    tunnelMode: 'on-demand-shared',
    tunnelPid: state.tunnel?.pid || null,
    tunnelGeneration: state.tunnelGeneration,
    tunnelStartedAt: state.tunnelStartedAt,
    tunnelIdleMs: boundedInt(setting('tunnelIdleMs', 300_000), 300_000, 0, 3_600_000),
    tunnelRetryAfter: state.tunnelRetryAfter > Date.now() ? state.tunnelRetryAfter : null,
    activeHttpRequests: state.activeHttpRequests,
    maxInFlightRequests: QUICK_TUNNEL_MAX_IN_FLIGHT,
    tunnelRetryInSeconds: state.tunnelRetryAfter > Date.now() ? Math.ceil((state.tunnelRetryAfter - Date.now()) / 1000) : 0,
    tunnelError: state.tunnelError?.message || null,
    cloudflaredVersion: state.prerequisites.cloudflared,
    runtimeReady: Boolean(state.prerequisites.runtime),
    runtime: state.runtimeName || 'none',
    runtimePreference: String(setting('containerRuntime', 'auto')),
    runtimeError: state.prerequisites.runtimeError,
    runtimeRetryInSeconds: runtimeProbeRetryAfter > Date.now() ? Math.ceil((runtimeProbeRetryAfter - Date.now()) / 1000) : 0,
    activeSessions: state.sessions.size,
    activeWebsiteSessions: [...state.sessions.values()].filter(session => session.language === 'website').length,
    pendingReservations: state.pendingReservations,
    maxSessionsTotal: boundedInt(setting('maxSessionsTotal', 20), 20, 1, 100),
    activeWorkers: state.activeWorkers,
    queued: state.queue.length,
    maxConcurrent: boundedInt(setting('maxConcurrent', 2), 2, 1, 4),
    ttlMs: boundedInt(setting('ttlMs', 3_600_000), 3_600_000, 60_000, 3_600_000),
    startedAt: state.startedAt
  };
}

let tunnelRestartPromise = null;

export async function restartCodeLabTunnel() {
  if (tunnelRestartPromise) return tunnelRestartPromise;
  tunnelRestartPromise = serializeTunnelOperation(async () => {
    await stopTunnelInternal();
    if (!setting('enabled', true) || !setting('publicTunnelEnabled', true)) return getCodeLabStatus();
    const url = await startTunnelInternal();
    return { ...getCodeLabStatus(), tunnel: url };
  });
  try { return await tunnelRestartPromise; }
  finally { tunnelRestartPromise = null; }
}
