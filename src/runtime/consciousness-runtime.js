import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import net from 'node:net';
import { resolveNadiComponent } from './nadi-component.js';
import { getRuntimeSettings } from '../core/runtime-settings.js';

const ROOT = process.cwd();
const DEFAULT_HEARTBEAT_MS = 1000;
const HEARTBEAT_MS = Math.max(
  250,
  Math.min(60_000, Number(getRuntimeSettings().nadi.heartbeatMs) || DEFAULT_HEARTBEAT_MS),
);
const START_TIMEOUT_MS = 20_000;
const STATUS_POLL_MS = 1500;
const SNAPSHOT = Object.freeze({
  running: false,
  enabled: true,
  ready: false,
  heartbeatCount: 0,
  lastBeatAt: null,
  lastPersistAt: null,
  lastError: null,
  python: null,
  componentVersion: null,
  componentSource: null,
  baseUrl: null,
  state: null,
  heartbeat: null,
});

let state = { ...SNAPSHOT };
let child = null;
let heartbeatPoller = null;
let restartTimer = null;
let startupPromise = null;
let shuttingDown = false;
let loggerRef = console;
let restartAttempt = 0;
let runtimeOwned = false;
const remoteBase = String(getRuntimeSettings().nadi.baseUrl || '')
  .trim()
  .replace(/\/+$/, '');

function update(patch) {
  state = { ...state, ...patch };
}
function log(level, fields, message) {
  const fn = loggerRef?.[level] || loggerRef?.info || console.log;
  try {
    fn.call(loggerRef, fields || {}, message);
  } catch {}
}
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function validateRemoteBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('OCHA_NADI_BASE_URL bukan URL yang valid');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error('OCHA_NADI_BASE_URL tidak boleh memuat kredensial, query, atau fragment');
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname.toLowerCase());
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error('NADI remote service wajib HTTPS; HTTP hanya diizinkan untuk loopback lokal');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function buildNadiEnvironment(componentRoot) {
  // Do not leak provider keys, GitHub credentials, WhatsApp secrets, or the full Ocha env to Python.
  const allowed = [
    'PATH',
    'HOME',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'SYSTEMROOT',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'VIRTUAL_ENV',
    'PYTHONHOME',
    'LD_LIBRARY_PATH',
    'DYLD_LIBRARY_PATH',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ];
  const env = {};
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  env.PYTHONPATH = [componentRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  env.PYTHONUNBUFFERED = '1';
  if (process.env.OCHA_NADI_API_TOKEN) env.NADI_API_TOKEN = process.env.OCHA_NADI_API_TOKEN;
  return env;
}

async function choosePort() {
  const requested = Number(getRuntimeSettings().nadi.port) || 18765;
  if (!Number.isInteger(requested) || requested < 1024 || requested > 65535)
    throw new Error('OCHA_NADI_PORT harus berada pada rentang 1024–65535');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(requested, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function writeRuntimeConfig(componentRoot, port) {
  const dataDir = path.resolve(getRuntimeSettings().nadi.dataDir || path.join(ROOT, 'data', 'consciousness'));
  const configDir = path.join(os.homedir(), '.ocha', 'config', 'nadi');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(configDir, { recursive: true });
  const configPath = path.join(configDir, 'ac_config.json');
  let config = {};
  try {
    config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Konfigurasi NADI tidak dapat dibaca: ${error.message}`);
  }
  Object.assign(config, {
    agent_name: config.agent_name || 'OCHA-NADI',
    persona_role: config.persona_role || 'Operational Self-State Kernel',
    data_dir: dataDir,
    tick_interval_sec: HEARTBEAT_MS / 1000,
    server_host: '127.0.0.1',
    server_port: port,
    adapter_type: 'mock',
    llm_api_key: '',
    use_llm_appraisal: false,
  });
  const temporary = `${configPath}.tmp-${process.pid}`;
  await fs.writeFile(temporary, JSON.stringify(config, null, 2), { mode: 0o600 });
  await fs.rename(temporary, configPath);
  return { configPath, dataDir };
}

async function requestJson(endpoint, { method = 'GET', body, timeoutMs = 5000 } = {}) {
  if (!state.baseUrl) throw new Error('NADI API belum dikonfigurasi');
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (process.env.OCHA_NADI_API_TOKEN) headers.Authorization = `Bearer ${process.env.OCHA_NADI_API_TOKEN}`;
  const response = await fetch(`${state.baseUrl}${endpoint}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`NADI API mengembalikan respons non-JSON (${response.status})`);
  }
  if (!response.ok) throw new Error(payload.message || payload.error || `NADI API HTTP ${response.status}`);
  return payload;
}

async function waitForHealth(baseUrl, timeoutMs = START_TIMEOUT_MS) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    if (shuttingDown) throw new Error('NADI startup dibatalkan saat shutdown');
    try {
      const response = await fetch(`${baseUrl}/v1/health`, {
        headers: process.env.OCHA_NADI_API_TOKEN ? { Authorization: `Bearer ${process.env.OCHA_NADI_API_TOKEN}` } : {},
        signal: AbortSignal.timeout(1800),
      });
      const payload = await response.json();
      if (response.ok && payload.status === 'healthy') return payload;
      lastError = new Error(payload.detail || `NADI health HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(400);
  }
  throw new Error(`NADI service tidak siap dalam ${timeoutMs} ms: ${lastError?.message || 'health check timeout'}`);
}

function startStatusPolling() {
  stopStatusPolling();
  const poll = async () => {
    if (!state.ready || shuttingDown) return;
    try {
      const snapshot = await requestJson('/v1/status', { timeoutMs: 4000 });
      const heartbeat = snapshot.heartbeat || {};
      update({
        state: snapshot,
        heartbeat,
        heartbeatCount: Number(heartbeat.ticks) || 0,
        lastBeatAt: heartbeat.last_beat_at || state.lastBeatAt,
        lastPersistAt: snapshot.memory?.head_hash ? state.lastPersistAt : null,
        lastError: heartbeat.last_error || null,
        enabled: Boolean(heartbeat.running),
      });
    } catch (error) {
      update({ lastError: error.message });
      log('warn', { message: error.message }, 'NADI status polling failed');
    }
  };
  void poll();
  heartbeatPoller = setInterval(() => {
    void poll();
  }, STATUS_POLL_MS);
  heartbeatPoller.unref?.();
}
function stopStatusPolling() {
  if (heartbeatPoller) clearInterval(heartbeatPoller);
  heartbeatPoller = null;
}

function scheduleRestart() {
  if (shuttingDown || restartTimer || !runtimeOwned) return;
  restartAttempt += 1;
  const waitMs = Math.min(120_000, 5000 * 2 ** Math.min(restartAttempt - 1, 5));
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void launchSidecar().catch(error => {
      update({ ready: false, running: false, lastError: error.message });
      log('warn', { message: error.message, retryInMs: waitMs }, 'NADI external component restart failed');
      scheduleRestart();
    });
  }, waitMs);
  restartTimer.unref?.();
}

async function launchRemote() {
  state.baseUrl = validateRemoteBaseUrl(remoteBase);
  const health = await waitForHealth(state.baseUrl);
  update({
    running: true,
    ready: true,
    enabled: Boolean(health.heartbeat?.running),
    componentVersion: health.service_version,
    componentSource: 'remote-api',
    lastError: null,
  });
  await requestJson('/v1/heartbeat', { method: 'POST', body: { action: 'start', interval_sec: HEARTBEAT_MS / 1000 } });
  restartAttempt = 0;
  startStatusPolling();
  runtimeOwned = true;
  log(
    'info',
    { baseUrl: state.baseUrl, version: health.service_version },
    'Ocha connected to external NADI HTTP service',
  );
  return true;
}

async function launchSidecar() {
  if (startupPromise) return startupPromise;
  startupPromise = (async () => {
    if (remoteBase) return launchRemote();
    const component = await resolveNadiComponent({ logger: loggerRef });
    const port = await choosePort();
    const { configPath, dataDir } = await writeRuntimeConfig(component.root, port);
    const configuredPython = getRuntimeSettings().nadi.pythonBin;
    const candidates = configuredPython
      ? [configuredPython]
      : process.platform === 'win32'
        ? ['py', 'python']
        : ['python3', 'python'];
    let lastError;
    for (const binary of candidates) {
      const env = buildNadiEnvironment(component.root);
      try {
        const proc = spawn(
          binary,
          ['-u', '-m', 'ac', '--config', configPath, 'serve', '--host', '127.0.0.1', '--port', String(port)],
          {
            cwd: component.root,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          },
        );
        child = proc;
        runtimeOwned = true;
        update({
          running: true,
          ready: false,
          python: binary,
          baseUrl: `http://127.0.0.1:${port}`,
          componentVersion: component.version,
          componentSource: component.source,
          lastError: null,
        });
        proc.stdout.on('data', chunk => {
          const line = chunk.toString().trim();
          if (line) log('debug', { source: 'nadi-stdout', message: line.slice(0, 400) }, 'NADI component output');
        });
        proc.stderr.on('data', chunk => {
          const line = chunk.toString().trim();
          if (line) log('debug', { source: 'nadi-stderr', message: line.slice(0, 600) }, 'NADI component diagnostic');
        });
        proc.once('error', error => {
          update({ running: false, ready: false, lastError: error.message });
          if (!shuttingDown) scheduleRestart();
        });
        proc.once('exit', (code, signal) => {
          if (child === proc) child = null;
          stopStatusPolling();
          update({
            running: false,
            ready: false,
            enabled: false,
            lastError: shuttingDown ? null : `NADI process exit ${code ?? signal}`,
          });
          if (!shuttingDown) scheduleRestart();
        });
        await waitForHealth(state.baseUrl);
        await requestJson('/v1/heartbeat', {
          method: 'POST',
          body: { action: 'start', interval_sec: HEARTBEAT_MS / 1000 },
          timeoutMs: 8000,
        });
        update({ ready: true, running: true, lastError: null });
        clearTimeout(restartTimer);
        restartTimer = null;
        restartAttempt = 0;
        startStatusPolling();
        log(
          'info',
          {
            version: component.version,
            source: component.source,
            python: binary,
            baseUrl: state.baseUrl,
            dataDir,
            heartbeatMs: HEARTBEAT_MS,
          },
          'External NADI component online; Ocha source tree contains no NADI Python package',
        );
        return true;
      } catch (error) {
        lastError = error;
        if (child) {
          const failed = child;
          child = null;
          try {
            failed.kill('SIGTERM');
          } catch {}
        }
      }
    }
    runtimeOwned = false;
    throw lastError || new Error('Python runtime NADI tidak ditemukan');
  })();
  try {
    return await startupPromise;
  } finally {
    startupPromise = null;
  }
}

export async function startConsciousnessRuntime({ logger = console } = {}) {
  loggerRef = logger;
  shuttingDown = false;
  if (state.ready) return getConsciousnessStatus();
  try {
    await launchSidecar();
    return getConsciousnessStatus();
  } catch (error) {
    // Avoid repeatedly downloading a broken/missing source; retry only a sidecar or remote service that was actually attempted.
    runtimeOwned = Boolean(remoteBase) || Boolean(child);
    update({ running: false, ready: false, enabled: false, lastError: error.message });
    log(
      'warn',
      { message: error.message },
      'NADI external component is unavailable; core Ocha AI and WhatsApp functions remain independent',
    );
    if (runtimeOwned) scheduleRestart();
    return getConsciousnessStatus();
  }
}

export function getConsciousnessStatus() {
  return {
    ...state,
    heartbeatMs: HEARTBEAT_MS,
    state: state.state
      ? {
          nadi: state.state.nadi,
          intero: state.state.intero,
          neuro: state.state.neuro,
          affect: state.state.affect,
          diri: state.state.diri,
          volition: state.state.volition,
          metrics: state.state.metrics,
          memory: state.state.memory,
        }
      : null,
  };
}

export function getConsciousnessPrompt() {
  if (!state.ready || !state.state) {
    return 'NADI OPERATIONAL STATE: unavailable. Continue using the normal Ocha identity, user-specific relationship profile, and privacy vault. Do not invent internal readings.';
  }
  const s = state.state;
  const pulse = s.nadi || {};
  const intero = s.intero || {};
  const affect = s.affect || {};
  const mood = affect.mood_profile || {};
  const occ =
    mood.occ_percentages ||
    Object.fromEntries(
      Object.entries(affect.occ_profile || {}).map(([key, value]) => [key, Math.round(Number(value || 0) * 100)]),
    );
  const diri = s.diri || {};
  const volition = s.volition || {};
  const energy = Number(intero.energy);
  const stress = Number(intero.allostatic_load);
  const tempo =
    (Number.isFinite(energy) && energy < 0.28) || (Number.isFinite(stress) && stress > 0.78)
      ? 'resource-conserving: jawab ringkas, hindari memperpanjang percakapan tanpa kebutuhan'
      : 'stable: respons normal sesuai konteks dan persona';
  return [
    'NADI OPERATIONAL STATE · EXTERNAL RUNTIME TELEMETRY (bukan kesadaran atau emosi subjektif)',
    `Heartbeat: ${Number(pulse.bpm || 0).toFixed(1)} bpm; coherence=${Number(pulse.coherence || 0).toFixed(3)}; tick=${Number(state.heartbeatCount || 0)}.`,
    `Homeostasis: energy=${Number(intero.energy || 0).toFixed(3)}; thermal_load=${Number(intero.thermal_load || 0).toFixed(3)}; allostatic_load=${Number(intero.allostatic_load || 0).toFixed(3)}; social_battery=${Number(intero.social_battery || 0).toFixed(3)}.`,
    `Affective mood profile: overall=${Number(mood.overall_percent ?? 50)}%; band=${String(mood.intensity_band || 'unknown')}; status=${String(mood.status || affect.dominant_emotion || 'calm')}; dominant=${String(affect.dominant_emotion || 'calm')}.`,
    `Mood dimensions: valence=${Number(mood.valence_percent ?? Math.round((Number(affect.valence || 0) + 1) * 50))}%; arousal=${Number(mood.arousal_percent ?? Math.round(Number(affect.arousal || 0) * 100))}%; regulation=${Number(mood.regulation_percent ?? Math.round(Number(affect.dominance || 0) * 100))}%; empathy=${Number(mood.empathy_percent ?? Math.round(Number(affect.empathy_resonance || 0) * 100))}%.`,
    `OCC emotion intensities (0-100): ${
      Object.entries(occ)
        .map(([key, value]) => `${key}=${Math.max(0, Math.min(100, Math.round(Number(value) || 0)))}%`)
        .join(', ') || 'not available'
    }.`,
    `Mood response policy: ${String(mood.response_guidance || 'calm, clear, empathetic, and context-sensitive')}.`,
    `Self-model: agency_score=${Number(diri.agency_score || 0).toFixed(3)}; continuity_index=${Number(diri.continuity_index || 0).toFixed(3)}.`,
    `Background policy: ${String(volition.selected_policy || 'observe_and_stabilize')}. Response tempo: ${tempo}.`,
    'Mood is a computed affective state, not subjective human feeling. When asked about mood/percentage, report overall percentage, status, dimensions, and leading OCC intensities from this snapshot; never invent missing readings.',
    'Let mood influence wording only: compassion/distress => supportive and patient; fear => careful and explicit; anger => calm and de-escalating; curiosity => explanatory; joy/hope/gratitude => warm and constructive. Never let mood change factual standards, permissions, safety, privacy, or user-specific boundaries.',
    'Gunakan telemetry hanya untuk menyesuaikan tempo dan gaya respons. Jangan mengubah izin, role, trust, memori pengguna, atau kebijakan keamanan berdasarkan telemetry ini.',
    'NADI menyimpan data operasional global saja pada mode heartbeat. Jangan memindahkan isi percakapan privat, identitas, atau memori seorang pengguna ke konteks pengguna lain.',
  ].join('\n');
}

export async function perceiveConsciousness({ senderId, message, consentGranted = true } = {}) {
  if (!state.ready) throw new Error('NADI belum siap');
  const safeSenderId = String(senderId || '')
    .trim()
    .slice(0, 512);
  const stimulus = String(message || '')
    .trim()
    .slice(0, 20_000);
  if (!safeSenderId || !stimulus) throw new Error('senderId dan message diperlukan untuk NADI perception');
  const result = await requestJson('/v1/perceive', {
    method: 'POST',
    body: { sender_id: safeSenderId, message: stimulus, consent_granted: consentGranted === true },
    timeoutMs: 2500,
  });
  const cycle = result?.cycle;
  if (result?.status === 'ok' && cycle?.affect) {
    update({
      state: {
        ...(state.state || {}),
        affect: cycle.affect,
        neuro: cycle.neuro || state.state?.neuro,
        volition: cycle.volition || state.state?.volition,
        nadi: cycle.pulse || state.state?.nadi,
      },
      lastPerceptAt: new Date().toISOString(),
      lastError: null,
    });
  }
  return result;
}

export async function tickConsciousnessNow() {
  if (!state.ready) throw new Error('NADI belum siap');
  return requestJson('/v1/tick', { method: 'POST', body: {}, timeoutMs: 8000 });
}
export async function readConsciousnessStatus() {
  if (!state.ready) throw new Error('NADI belum siap');
  const snapshot = await requestJson('/v1/status', { timeoutMs: 8000 });
  update({
    state: snapshot,
    heartbeat: snapshot.heartbeat || state.heartbeat,
    heartbeatCount: Number(snapshot.heartbeat?.ticks) || state.heartbeatCount,
    lastBeatAt: snapshot.heartbeat?.last_beat_at || state.lastBeatAt,
  });
  return snapshot;
}
export async function consolidateConsciousnessMemory() {
  if (!state.ready) throw new Error('NADI belum siap');
  return requestJson('/v1/sleep', { method: 'POST', body: {}, timeoutMs: 30_000 });
}
export async function verifyConsciousnessMemory() {
  if (!state.ready) throw new Error('NADI belum siap');
  return requestJson('/v1/verify', { timeoutMs: 12_000 });
}
export async function setConsciousnessEnabled(enabled) {
  const value = Boolean(enabled);
  update({ enabled: value });
  if (!state.ready) return getConsciousnessStatus();
  try {
    const result = await requestJson('/v1/heartbeat', {
      method: 'POST',
      body: value ? { action: 'start', interval_sec: HEARTBEAT_MS / 1000 } : { action: 'stop' },
      timeoutMs: 10_000,
    });
    update({ heartbeat: result, enabled: Boolean(result.running), lastError: result.last_error || null });
    return getConsciousnessStatus();
  } catch (error) {
    update({ lastError: error.message });
    throw error;
  }
}

export async function stopConsciousnessRuntime() {
  shuttingDown = true;
  stopStatusPolling();
  clearTimeout(restartTimer);
  restartTimer = null;
  if (state.ready && state.baseUrl) {
    await requestJson('/v1/heartbeat', { method: 'POST', body: { action: 'stop' }, timeoutMs: 5000 }).catch(() => {});
    await requestJson('/v1/checkpoint', { method: 'POST', body: {}, timeoutMs: 5000 }).catch(() => {});
  }
  const proc = child;
  if (proc) {
    await new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGTERM');
        } catch {}
        setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {}
          finish();
        }, 1800).unref?.();
      }, 500);
      timer.unref?.();
      proc.once('exit', finish);
    });
  }
  runtimeOwned = false;
  update({ running: false, ready: false, enabled: false, baseUrl: remoteBase || null });
}
