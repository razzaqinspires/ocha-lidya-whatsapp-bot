import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { getConsciousnessStatus } from './consciousness-runtime.js';
import { OCHA_IDENTITY_MANIFEST } from '../ai/identity-kernel.js';
import { getKernelTelemetrySnapshot } from './kernel-telemetry.js';
import { getPublicGatewayUrl, registerKernelDashboardRouteHandler } from './code-lab.js';

const DATA_DIR = path.resolve(process.env.OCHA_KERNEL_DASHBOARD_DIR || path.join(process.cwd(), 'data', 'kernel'));
const TOKEN_FILE = path.join(DATA_DIR, 'public-dashboard-token');
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,80}$/;
let dashboardToken = null;
let dashboardTokenHash = null;
const requestBuckets = new Map();

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pickNumbers(source, fields) {
  const value = source && typeof source === 'object' ? source : {};
  return Object.fromEntries(fields.map(field => [field, safeNumber(value[field])]));
}

function safeHashPrefix(value) {
  const hash = String(value || '');
  return /^[a-f0-9]{64}$/i.test(hash) ? hash.slice(0, 12) : null;
}

async function loadDashboardToken() {
  if (dashboardToken) return dashboardToken;
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  try {
    const existing = (await fs.readFile(TOKEN_FILE, 'utf8')).trim();
    if (TOKEN_PATTERN.test(existing)) {
      dashboardToken = existing;
      dashboardTokenHash = crypto.createHash('sha256').update(existing).digest();
      await fs.chmod(TOKEN_FILE, 0o600).catch(() => {});
      return dashboardToken;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Token dashboard tidak dapat dibaca: ${error.message}`);
  }
  const created = crypto.randomBytes(32).toString('base64url');
  const temporary = `${TOKEN_FILE}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temporary, `${created}\n`, { mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, TOKEN_FILE);
  dashboardToken = created;
  dashboardTokenHash = crypto.createHash('sha256').update(created).digest();
  return dashboardToken;
}

function calculatePercent(value) {
  if (value === null || value === undefined) return null;
  const number = safeNumber(value);
  return number === null ? null : Math.max(0, Math.min(100, number * 100));
}

export function buildPublicKernelSnapshot() {
  const telemetry = getKernelTelemetrySnapshot();
  const status = getConsciousnessStatus();
  const state = status.state || {};
  const metrics = state.metrics || {};
  const memory = state.memory || {};
  const mem = process.memoryUsage();
  const phase = safeNumber(state.nadi?.phase);
  const pulseWave = phase === null ? null : Math.round((0.5 * (1 + Math.sin(phase))) * 10_000) / 10_000;
  const evaluations = Array.isArray(state.volition?.evaluations)
    ? state.volition.evaluations.slice(0, 8).map(item => ({
      policy: String(item.policy || '').slice(0, 48),
      risk: safeNumber(item.risk),
      ambiguity: safeNumber(item.ambiguity),
      epistemicValue: safeNumber(item.epistemic_value),
      expectedFreeEnergy: safeNumber(item.expected_free_energy)
    })) : [];

  return {
    generatedAt: new Date().toISOString(),
    identity: {
      name: OCHA_IDENTITY_MANIFEST.name,
      version: OCHA_IDENTITY_MANIFEST.version,
      platform: OCHA_IDENTITY_MANIFEST.platform,
      intelligenceLayer: OCHA_IDENTITY_MANIFEST.intelligenceLayer,
      organization: OCHA_IDENTITY_MANIFEST.organization,
      identityType: OCHA_IDENTITY_MANIFEST.identityType,
      nature: OCHA_IDENTITY_MANIFEST.nature
    },
    connection: {
      whatsapp: telemetry.connection,
      nadi: {
        running: Boolean(status.running),
        ready: Boolean(status.ready),
        heartbeatEnabled: Boolean(status.enabled),
        componentVersion: status.componentVersion || null,
        componentSource: status.componentSource === 'remote-api' ? 'remote-api' : status.componentSource ? 'github-pinned' : null,
        intervalMs: safeNumber(status.heartbeatMs),
        ticks: safeNumber(status.heartbeatCount),
        lastBeatAt: status.lastBeatAt || status.heartbeat?.last_beat_at || null,
        error: status.lastError ? 'NADI membutuhkan pemeriksaan operasional; detail internal disembunyikan.' : null
      }
    },
    totals: telemetry.counters,
    ai: {
      activeRequests: telemetry.activeAiRequests,
      latency: telemetry.latency,
      successRatePercent: calculatePercent((telemetry.counters.aiResponses + telemetry.counters.aiFailures)
        ? telemetry.counters.aiResponses / (telemetry.counters.aiResponses + telemetry.counters.aiFailures)
        : null),
      providerCounts: telemetry.providerCounts
    },
    runtime: {
      uptimeSeconds: Math.max(0, Math.floor(process.uptime())),
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpuCount: os.cpus()?.length || null,
      loadAverage: process.platform === 'win32' ? null : os.loadavg().map(value => Math.round(value * 100) / 100),
      memory: {
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        externalBytes: mem.external,
        arrayBuffersBytes: mem.arrayBuffers
      }
    },
    circuits: {
      pulse: { ...pickNumbers(state.nadi, ['bpm', 'phase', 'coherence', 'beat_count']), pulse_wave: pulseWave },
      homeostasis: pickNumbers(state.intero, ['energy', 'thermal_load', 'memory_pressure', 'social_battery', 'allostatic_load']),
      neuromodulators: pickNumbers(state.neuro, ['dopamine', 'serotonin', 'norepinephrine', 'acetylcholine', 'cortisol', 'oxytocin']),
      syntheticAffect: {
        valence: safeNumber(state.affect?.valence),
        arousal: safeNumber(state.affect?.arousal),
        dominance: safeNumber(state.affect?.dominance),
        empathyResonance: safeNumber(state.affect?.empathy_resonance),
        dominantLabel: typeof state.affect?.dominant_emotion === 'string' ? state.affect.dominant_emotion.slice(0, 32) : null,
        occProfile: state.affect?.occ_profile && typeof state.affect.occ_profile === 'object'
          ? Object.fromEntries(Object.entries(state.affect.occ_profile).slice(0, 12).map(([key, value]) => [String(key).slice(0, 24), safeNumber(value)]))
          : {}
      },
      predictiveSelfModel: {
        agencyScore: safeNumber(state.diri?.agency_score),
        continuityIndex: safeNumber(state.diri?.continuity_index),
        coreValues: Array.isArray(state.diri?.core_values) ? state.diri.core_values.slice(0, 12).map(value => String(value).slice(0, 48)) : []
      },
      deliberation: {
        selectedPolicy: typeof state.volition?.selected_policy === 'string' ? state.volition.selected_policy.slice(0, 64) : null,
        policyEvaluations: evaluations
      },
      integration: {
        integrationPhiProxy: safeNumber(metrics.integration_phi),
        workspaceEntropy: safeNumber(metrics.workspace_entropy),
        averageTickMs: safeNumber(metrics.avg_tick_ms),
        lastTickMs: safeNumber(metrics.last_tick_ms),
        totalPercepts: safeNumber(metrics.total_percepts),
        totalActions: safeNumber(metrics.total_actions),
        totalSleepCycles: safeNumber(metrics.total_sleep_cycles),
        blockedActions: safeNumber(metrics.blocked_actions)
      },
      memoryLedger: {
        chainLength: safeNumber(memory.total_blocks),
        headHashPrefix: safeHashPrefix(memory.head_hash),
        integrityState: status.ready && memory.chain_valid === true ? 'valid' : status.ready && memory.chain_valid === false ? 'invalid' : 'unavailable'
      }
    },
    activity: {
      hourly: telemetry.hourly,
      recentEvents: telemetry.recentEvents,
      firstTelemetryAt: telemetry.firstSeenAt,
      lastTelemetryAt: telemetry.updatedAt
    },
    definitions: {
      responseSuccessRate: 'AI answer deliveries divided by completed AI requests (answers + failures).',
      responseLatency: 'End-to-end time from the start of an AI request to the completed runtime result; rolling sample of up to 512 answers.',
      integrationPhi: 'Synthetic functional-integration proxy implemented by NADI; not a measurement of phenomenal consciousness or IIT Phi.',
      workspaceEntropy: 'Normalized Shannon entropy proxy over positive epistemic values in the current EFE policy evaluations.',
      pulse: 'Software oscillator rate calculated by the NADI model, not a biological heartbeat.',
      energy: 'Normalized computational homeostasis variable, not physical energy.'
    }
  };
}

function safeJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="dark"><title>Ocha Lidya · Kernel Telemetry</title>
<style>
:root{color-scheme:dark;--bg:#080c14;--panel:#101827;--panel2:#131e30;--line:#24334a;--text:#edf3fc;--muted:#96a8c0;--mint:#75e0b4;--blue:#8bb8ff;--amber:#e9bd74;--red:#ff8790;--violet:#c3a2ff}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 50% -15%,#1a2c47 0,#080c14 58%);color:var(--text);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh}main{max-width:1280px;margin:0 auto;padding:28px 20px 56px}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:22px}.brand{font-size:12px;letter-spacing:.2em;font-weight:800;color:var(--blue)}h1{font-size:clamp(25px,4vw,38px);line-height:1.1;letter-spacing:-.04em;margin:8px 0}.sub{color:var(--muted);font-size:13px}.state{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);padding:7px 11px;border-radius:99px;color:var(--muted);font-size:12px;white-space:nowrap}.dot{width:7px;height:7px;border-radius:50%;background:var(--amber)}.state.online .dot{background:var(--mint);box-shadow:0 0 12px #75e0b477}.state.offline .dot{background:var(--red)}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric,.panel{background:linear-gradient(145deg,rgba(19,30,48,.96),rgba(13,21,34,.96));border:1px solid var(--line);border-radius:16px}.metric{padding:16px}.metric .label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.metric .value{font-size:clamp(23px,3vw,32px);letter-spacing:-.04em;font-weight:750;margin-top:7px;font-variant-numeric:tabular-nums}.metric .hint{font-size:11px;color:var(--muted);margin-top:2px}.panel{padding:18px;margin-top:14px}.head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:15px}.head h2{margin:0;font-size:13px;letter-spacing:.1em;text-transform:uppercase}.chip{font-size:10px;color:var(--blue);border:1px solid #314969;padding:4px 8px;border-radius:99px}.two{display:grid;grid-template-columns:1.35fr 1fr;gap:14px}.bar-chart{height:145px;display:flex;align-items:flex-end;gap:4px;padding:12px 1px 0;border-bottom:1px solid var(--line)}.hour{flex:1;display:flex;align-items:flex-end;justify-content:center;gap:2px;height:100%;min-width:0}.bar{width:44%;min-width:2px;border-radius:4px 4px 0 0;background:var(--blue);opacity:.85}.bar.response{background:var(--mint)}.axis{display:flex;justify-content:space-between;color:var(--muted);font-size:10px;margin-top:8px}.legend{display:flex;gap:14px;font-size:11px;color:var(--muted);margin-top:9px}.legend i{display:inline-block;width:7px;height:7px;border-radius:2px;margin-right:5px;background:var(--blue)}.legend .mint{background:var(--mint)}.kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.kvitem{background:#0a1220;border:1px solid #1d2b40;border-radius:11px;padding:11px}.kvitem span{display:block;color:var(--muted);font-size:11px}.kvitem strong{display:block;font-size:18px;margin-top:3px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.circuits{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.circuit{background:#0a1220;border:1px solid #1d2b40;border-radius:13px;padding:13px}.circuit h3{font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin:0 0 10px;color:var(--blue)}.reading{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid #172337;font-size:12px}.reading:last-child{border:0}.reading span{color:var(--muted)}.reading b{font-variant-numeric:tabular-nums;text-align:right}.events{list-style:none;padding:0;margin:0;display:grid;gap:8px}.events li{display:flex;justify-content:space-between;gap:12px;padding:9px 11px;background:#0a1220;border:1px solid #1d2b40;border-radius:10px;font-size:12px}.events small{color:var(--muted);white-space:nowrap}.formula{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.pipeline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.pipeline span{padding:8px 10px;border:1px solid #263a55;background:#0a1220;border-radius:9px;font-size:11px;color:#dbe8fb}.pipeline i{color:var(--blue);font-style:normal;font-size:13px}.formula div{border-left:2px solid #405a7c;padding:7px 11px;background:#0b1422;border-radius:0 8px 8px 0}.formula b{display:block;font-size:12px}.formula span{display:block;color:var(--muted);font-size:11px;margin-top:3px}.equation{display:block;color:#dce8f8;background:#070d17;border:1px solid #21314a;border-radius:7px;padding:8px;margin-top:7px;font:11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:normal;overflow-wrap:anywhere}.privacy{color:#b5c4d9;font-size:12px;line-height:1.6}.footer{color:var(--muted);font-size:11px;margin-top:18px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.dim{color:var(--muted)}.warn{color:var(--amber)}.good{color:var(--mint)}
@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.two{grid-template-columns:1fr}.circuits{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){main{padding:20px 12px 40px}.top{flex-direction:column}.grid{gap:8px}.metric{padding:12px}.panel{padding:13px}.circuits{grid-template-columns:1fr}.formula{grid-template-columns:1fr}.kvitem strong{font-size:16px}}
</style></head><body><main>
<header class="top"><div><div class="brand">RAZZAQ VENTURES / NEXORA</div><h1>Ocha Lidya · Kernel Status</h1><div class="sub">Live operational telemetry · AC-Kernel NADI</div></div><div id="liveState" class="state"><i class="dot"></i><span id="liveText">Menghubungkan…</span></div></header>
<section class="grid">
 <article class="metric"><div class="label">Pesan masuk</div><div class="value" id="incoming">—</div><div class="hint" id="incomingSplit">DM — · Grup —</div></article>
 <article class="metric"><div class="label">Giliran dibalas bot</div><div class="value" id="replied">—</div><div class="hint" id="replySplit">DM — · Grup —</div></article>
 <article class="metric"><div class="label">Jawaban AI berhasil</div><div class="value" id="aiResponses">—</div><div class="hint" id="aiSuccess">Keberhasilan —</div></article>
 <article class="metric"><div class="label">Total output bot</div><div class="value" id="botOutputs">—</div><div class="hint">Semua pesan keluar, termasuk command dan notifikasi</div></article>
 <article class="metric"><div class="label">NADI heartbeat ticks</div><div class="value" id="ticks">—</div><div class="hint" id="pulseHint">Pulse — bpm</div></article>
</section>
<section class="panel"><div class="head"><h2>Alur Sirkuit Kernel</h2><span class="chip">Per tick · computational pipeline</span></div><div class="pipeline"><span>01 · Input</span><i>→</i><span>02 · Sapa Gate</span><i>→</i><span>03 · Nadi + Homeostasis</span><i>→</i><span>04 · Rasa / OCC</span><i>→</i><span>05 · NeuroField</span><i>→</i><span>06 · Memory Recall / Commit</span><i>→</i><span>07 · Global Workspace</span><i>→</i><span>08 · Kehendak / EFE</span><i>→</i><span>09 · Action Consent</span><i>→</i><span>10 · Diri + Integrity</span><i>→</i><span>11 · Metrics / Snapshot</span></div></section>
<div class="two"><section class="panel"><div class="head"><h2>Aktivitas 24 Jam</h2><span class="chip">Hourly aggregate</span></div><div id="chart" class="bar-chart"></div><div class="axis"><span>24 jam lalu</span><span>12 jam</span><span>sekarang</span></div><div class="legend"><span><i></i>Pesan masuk</span><span><i class="mint"></i>Jawaban AI</span></div></section>
<section class="panel"><div class="head"><h2>Respons AI & Latensi</h2><span class="chip">Rolling sample ≤ 512</span></div><div class="kv">
<div class="kvitem"><span>Permintaan AI</span><strong id="aiRequests">—</strong></div><div class="kvitem"><span>Permintaan aktif</span><strong id="activeAi">—</strong></div><div class="kvitem"><span>Rata-rata latensi</span><strong id="avgLatency">—</strong></div><div class="kvitem"><span>P95 latensi</span><strong id="p95Latency">—</strong></div><div class="kvitem"><span>Latensi minimum</span><strong id="minLatency">—</strong></div><div class="kvitem"><span>Latensi maksimum</span><strong id="maxLatency">—</strong></div><div class="kvitem"><span>Intent command dari AI</span><strong id="aiCommands">—</strong></div><div class="kvitem"><span>Total karakter jawaban AI</span><strong id="responseChars">—</strong></div></div><div class="sub" id="providerCounts" style="margin-top:12px">Provider: —</div></section></div>
<section class="panel"><div class="head"><h2>Sirkuit Operasional NADI</h2><span class="chip">Synthetic computational state · bukan biologi</span></div><div class="circuits">
 <article class="circuit"><h3>01 · Nadi / Oscillator</h3><div class="reading"><span>Rate</span><b id="bpm">—</b></div><div class="reading"><span>Phase</span><b id="phase">—</b></div><div class="reading"><span>Pulse wave</span><b id="pulseWave">—</b></div><div class="reading"><span>Coherence</span><b id="coherence">—</b></div><div class="reading"><span>Beat count</span><b id="beatCount">—</b></div></article>
 <article class="circuit"><h3>02 · Homeostasis</h3><div class="reading"><span>Energy reserve</span><b id="energy">—</b></div><div class="reading"><span>Thermal load</span><b id="thermal">—</b></div><div class="reading"><span>Memory pressure</span><b id="memoryPressure">—</b></div><div class="reading"><span>Social battery</span><b id="socialBattery">—</b></div><div class="reading"><span>Allostatic load</span><b id="allostatic">—</b></div></article>
 <article class="circuit"><h3>03 · Neuromodulator</h3><div class="reading"><span>Dopamine (DA)</span><b id="dopamine">—</b></div><div class="reading"><span>Serotonin (5-HT)</span><b id="serotonin">—</b></div><div class="reading"><span>Norepinephrine (NE)</span><b id="norepinephrine">—</b></div><div class="reading"><span>Acetylcholine (ACh)</span><b id="acetylcholine">—</b></div><div class="reading"><span>Cortisol model</span><b id="cortisol">—</b></div><div class="reading"><span>Oxytocin model</span><b id="oxytocin">—</b></div></article>
 <article class="circuit"><h3>04 · Synthetic Affect</h3><div class="reading"><span>Dominant label</span><b id="affectLabel">—</b></div><div class="reading"><span>Valence</span><b id="valence">—</b></div><div class="reading"><span>Arousal</span><b id="arousal">—</b></div><div class="reading"><span>Dominance</span><b id="dominance">—</b></div><div class="reading"><span>Empathy resonance</span><b id="empathy">—</b></div><div id="occProfile" class="sub" style="margin-top:8px">OCC appraisal —</div></article>
 <article class="circuit"><h3>05 · Predictive Self-Model</h3><div class="reading"><span>Agency score</span><b id="agency">—</b></div><div class="reading"><span>Continuity index</span><b id="continuity">—</b></div><div class="reading"><span>Kernel version</span><b id="kernelVersion">—</b></div><div class="reading"><span>Identity version</span><b id="identityVersion">—</b></div><div class="reading"><span>Core principles</span><b id="coreValues">—</b></div></article>
 <article class="circuit"><h3>06 · Integration / Workspace</h3><div class="reading"><span>Integration Φ proxy</span><b id="phi">—</b></div><div class="reading"><span>Workspace entropy</span><b id="entropy">—</b></div><div class="reading"><span>Average tick time</span><b id="avgTick">—</b></div><div class="reading"><span>Last tick time</span><b id="lastTick">—</b></div><div class="reading"><span>Total percept cycles</span><b id="percepts">—</b></div><div class="reading"><span>Total actions</span><b id="actions">—</b></div><div class="reading"><span>Sleep cycles</span><b id="sleepCycles">—</b></div><div class="reading"><span>Blocked actions</span><b id="blockedActions">—</b></div></article>
 <article class="circuit"><h3>07 · Deliberation / EFE</h3><div class="reading"><span>Selected policy</span><b id="selectedPolicy">—</b></div><div id="policyRows" class="sub" style="margin-top:8px">Policy evaluation —</div></article>
 <article class="circuit"><h3>08 · Memory Ledger</h3><div class="reading"><span>Chain length</span><b id="chainLength">—</b></div><div class="reading"><span>Head hash prefix</span><b id="hashPrefix">—</b></div><div class="reading"><span>Integrity check</span><b id="chainIntegrity">—</b></div><div class="reading"><span>Last heartbeat</span><b id="lastBeat">—</b></div></article>
 <article class="circuit"><h3>09 · WhatsApp / Runtime</h3><div class="reading"><span>WhatsApp socket</span><b id="waStatus">—</b></div><div class="reading"><span>Reconnect count</span><b id="reconnects">—</b></div><div class="reading"><span>Process uptime</span><b id="uptime">—</b></div><div class="reading"><span>Node version</span><b id="nodeVersion">—</b></div><div class="reading"><span>RSS memory</span><b id="rss">—</b></div><div class="reading"><span>Heap used / total</span><b id="heap">—</b></div><div class="reading"><span>CPU cores</span><b id="cpuCount">—</b></div></article>
</div><div class="sub" id="kernelStatus" style="margin-top:13px">NADI runtime —</div></section>
<div class="two"><section class="panel"><div class="head"><h2>Jejak Aktivitas Terkini</h2><span class="chip">No message content / no IDs</span></div><ul id="events" class="events"><li>Menunggu event runtime…</li></ul></section><section class="panel"><div class="head"><h2>Definisi & Rumus</h2><span class="chip">Metric methodology</span></div><div class="formula">
<div><b>AI response success</b><span>Proporsi permintaan AI yang menghasilkan jawaban ter-deliver. Command biasa dan respons non-generatif tidak masuk penyebut.</span><code class="equation">success = AI_responses / (AI_responses + AI_failures) × 100%</code></div>
<div><b>Response latency</b><span>Durasi dari pemanggilan engine sampai hasil dipulangkan. Rata-rata, minimum, maksimum dan P95 dihitung dari 512 sampel jawaban terakhir.</span><code class="equation">latency = t_finish − t_start ; P95 = percentile(samples, 0.95)</code></div>
<div><b>Integration Φ proxy</b><span>x adalah lima sinyal: coherence, energy, 1−allostatic load, serotonin, dan agency. Ini proxy internal, bukan Φ IIT atau ukuran kesadaran fenomenal.</span><code class="equation">μ = Σxᵢ/5 ; σ = √(Σ(xᵢ−μ)²/5) ; C = 1−min(1,1.5σ) ; Φproxy = clamp(0.6μ+0.4C)</code></div>
<div><b>Workspace / policy entropy</b><span>Nama field kernel adalah workspace_entropy, tetapi input aktualnya epistemic_value dari evaluasi kebijakan EFE. Nilai nol bila paling banyak satu nilai positif.</span><code class="equation">pᵢ = eᵢ/Σe ; Hnorm = −Σ(pᵢ log₂ pᵢ) / log₂(n) ; eᵢ = max(0, epistemicValueᵢ)</code></div>
<div><b>NADI oscillator</b><span>Osilator perangkat lunak. A = affect arousal; S = interoceptive allostatic load; φ adalah fase dalam radian.</span><code class="equation">BPM* = clamp(60 + 45A + 30S,48,165) ; BPMₜ = BPMₜ₋₁ + 0.2(BPM*−BPMₜ₋₁) ; φₜ = (φₜ₋₁ + 2π·(BPMₜ/60)·Δt) mod 2π ; pulse = 0.5(1+sinφ) ; coherence = clamp(0.92−0.35S+0.05·pulse)</code></div>
<div><b>Homeostasis & allostatic strain</b><span>E = energy; T = thermal load; M = memory pressure; B = social battery. Semua nilai adalah variabel komputasional ternormalisasi, bukan fisiologi.</span><code class="equation">Eₜ=clamp(E+0.005(E*−E)Δt−0.00015·effort·Δt) ; Tₜ=clamp(T+0.003·effort·Δt−0.04(T−T*)Δt) ; M=clamp(min(1,memoryCount/2500)) ; Bₜ=clamp(B+0.03·interaction−0.005(B−B*)Δt) ; strain=clamp(0.45|E*−E|+0.35max(0,T−T*)+0.20max(0,M−0.65)) ; Lₜ=clamp(L+0.10(strain−L)Δt)</code></div>
<div><b>Homeostatic drives & sleep recovery</b><span>Drive memilih kecenderungan istirahat, pendinginan, konsolidasi atau keterlibatan. Sleep memulihkan sejumlah state sintetis berdasarkan kualitas q.</span><code class="equation">rest=clamp(0.7(1−E)+0.3L) ; cool=clamp(1.4max(0,T−T*)) ; consolidate=clamp(0.8M+0.2L) ; engage=clamp(0.6E+0.4(1−L)) ; E'=clamp(E+0.28q) ; T'=clamp(T(1−0.35q)) ; L'=clamp(L(1−0.45q))</code></div>
<div><b>Synthetic affect appraisal</b><span>V = raw valence; A = raw arousal; N = novelty; W = social warmth; positive/negative/urgent hits dihitung dari lexicon appraisal. Bukan emosi yang dirasakan.</span><code class="equation">V=clamp(0.28(posHits−negHits),−1,1) ; A=clamp(0.25+0.22·urgentHits+0.15(posHits+negHits)+0.15N) ; W=clamp(0.20+0.25·empathicHits+0.20·OXT) ; valenceₜ=clamp(0.55·valenceₜ₋₁+0.45V) ; arousalₜ=clamp(0.50·arousalₜ₋₁+0.50A)</code></div>
<div><b>OCC / empathy appraisal</b><span>Empathy gain memodulasi compassion dan anger yang teratur; profil OCC berasal dari sinyal leksikal, novelty, pertanyaan, energi dan oxytocin.</span><code class="equation">g=clamp(0.45+0.35·OXT+0.20W) ; joy=clamp(0.85max(0,V)+0.10) ; distress=clamp(0.70max(0,−V)) ; hope=clamp(0.25+0.40max(0,V)+0.20E) ; fear=clamp(0.20·urgentHits+0.35max(0,−V)(1−E)) ; curiosity=clamp(0.25+0.45N+0.25·isQuestion) ; anger=clamp(|V|(1−g)·0.5) jika V&lt;−0.15, selain itu 0.02 ; compassion=clamp(0.35+|V|·g·0.75) bila V&lt;−0.15, selain itu clamp(0.25+0.35W) ; gratitude=0.45 bila ada token terima kasih, selain itu 0.12 ; dominance=clamp(0.60E+0.25(1−fear)+0.15·valenceₜ)</code></div>
<div><b>Neuromodulator dynamics & appraisal impulses</b><span>Nilai bergerak ke target dengan rate terbatas; appraisal input menambahkan impuls langsung sebelum relaksasi pada tick.</span><code class="equation">DA*=clamp(0.55+0.15(A−0.4)−0.20S) ; 5HT*=clamp(0.62−0.25S+0.10·OXT) ; NE*=clamp(0.35+0.45A+0.20S) ; ACh*=clamp(0.50+0.30A−0.15S) ; CORT*=clamp(0.20+0.65S−0.15·5HT) ; OXT*=clamp(0.50−0.20S) ; xₜ=clamp(x+r(x*−x)) ; r=clamp(0.08Δt,0.01,0.5) ; DA+=0.18V+0.14N ; 5HT+=0.15V−0.10max(0,−V) ; NE+=0.22A ; ACh+=0.20N ; CORT+=0.22|V| jika V&lt;0, selain itu −0.08V ; OXT+=0.20W</code></div>
<div><b>Predictive self-model</b><span>Prediction error berasal dari ambiguity kebijakan terpilih. Continuity mengikuti coherence jika ledger aktif valid, atau coherence × 0.25 jika tidak valid.</span><code class="equation">agencyₜ=clamp(0.85·agencyₜ₋₁+0.15·(1−predictionError)) ; continuity=clamp(coherence·(1 jika chainValid, selain itu 0.25))</code></div>
<div><b>Deliberation / Expected Free Energy</b><span>Kernel menilai policy respond_empathetically, clarify_and_explore, encode_and_conserve atau idle policy observe_and_stabilize / consolidate_sleep_cycle. Bobot berasal dari konfigurasi.</span><code class="equation">G(π)=wᵣ·Risk(π)+wₐ·Ambiguity(π)−wₑ·EpistemicValue(π) ; pilih argminπ G(π) ; pada input: RiskResp=clamp(0.20+0.35·rest+0.15 bila V&lt;−0.3), AmbResp=0.25(1−N), EpiResp=clamp(0.45+0.35·DA+0.20·engage) ; pada idle: RiskObserve=clamp(0.18+0.20·rest), RiskSleep=clamp(0.45−0.40max(rest,consolidate))</code></div>
<div><b>Workspace attention score</b><span>Skor kompetisi kandidat dihitung dari salience, urgensi, bobot afektif, dan presisi perhatian (acetylcholine).</span><code class="equation">weight=0.45·salience+0.30·urgency+0.25·emotionWeight ; score=clamp(weight·(0.75+0.5·attentionPrecision))</code></div>
<div><b>Tick timing & plasticity</b><span>Rata-rata tick memakai exponential moving average. Plasticity gain menggabungkan ACh, DA dan NE.</span><code class="equation">avgₜ=0.85·avgₜ₋₁+0.15·lastTickₜ ; plasticity=clamp(0.40·ACh+0.35·DA+0.25·NE)</code></div>
<div><b>Memory hash-chain</b><span>Setiap blok menyertakan hash blok sebelumnya dan payload kanonis, lalu disegel dengan SHA-256. Publik hanya melihat jumlah blok dan prefix hash.</span><code class="equation">hᵢ=SHA256(canonical(index,time,kind,content,salience,valence,tags,hᵢ₋₁,embedding)) ; h₀.previous=00…00</code></div>
<div><b>Memory novelty & recall ranking</b><span>Novelty membandingkan input dengan maksimum cosine similarity dari hingga 25 blok terbaru. Recall memakai similarity, salience, recency dan bonus kind.</span><code class="equation">novelty=clamp(1−max(0,maxCosineSimilarityRecent25)) ; recency=(index+1)/totalBlocks ; rank=0.62·similarity+0.22·salience+0.16·recency+0.08·kindBonus</code></div>
<div><b>Safety / consent gate</b><span>Input melewati blocked-topic dan destructive-memory checks. External side-effect policy memerlukan consent bila konfigurasi mengaktifkannya; aksi yang tertolak menambah blocked_actions.</span><code class="equation">allowInput = noBlockedTopic ∧ noUnconfirmedDestructiveIntent ; allowAction = ¬(externalSideEffect ∧ requireConsent ∧ ¬consentGranted)</code></div>
<div><b>Pulse coherence</b><span>Koherensi osilator disesuaikan dengan stress dan pulse wave pada rentang terbatasi.</span><code class="equation">coherence = clamp(0.92 − 0.35·stress + 0.05·pulseWave)</code></div>
</div></section></div>
<section class="panel"><div class="head"><h2>Batas Publikasi & Privasi</h2><span class="chip">Read-only public view</span></div><p class="privacy">Dashboard ini hanya menampilkan agregat operasional: jumlah pesan, giliran balasan, hasil AI, latensi, status koneksi, heartbeat, dan variabel matematis sintetis NADI. Isi pesan, nomor WhatsApp, JID, nama pengguna, profil relasi, riwayat chat, serta memori privat tidak dipublikasikan. Angka neuromodulator, affect, agency, coherence, dan continuity adalah variabel model komputasional; nilainya tidak membuktikan pengalaman subjektif, kesadaran biologis, atau kehendak mandiri.</p></section>
<footer class="footer"><span>OCHA LIDYA · NEXORA · RAZZAQ VENTURES</span><span>Refresh 2.5 detik · <span id="updatedAt">—</span></span></footer>
</main><script>
const $=id=>document.getElementById(id);const valid=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));const num=(v,d=3)=>valid(v)?Number(v).toFixed(d):'—';const count=v=>valid(v)?Number(v).toLocaleString('id-ID'):'—';const pct=v=>valid(v)?(Number(v)*100).toFixed(1)+'%':'—';const ms=v=>valid(v)?num(v,1)+' ms':'—';const mb=v=>valid(v)?(Number(v)/1048576).toFixed(1)+' MB':'—';const put=(id,v)=>{const el=$(id);if(el)el.textContent=v??'—'};const time=v=>v?new Date(v).toLocaleString('id-ID',{timeZone:'Asia/Jakarta',hour12:false}):'—';const duration=s=>{if(!Number.isFinite(Number(s)))return'—';let n=Math.floor(Number(s));const d=Math.floor(n/86400);n%=86400;const h=Math.floor(n/3600);n%=3600;const m=Math.floor(n/60);const sec=n%60;return[d?d+'h':'',h?String(h).padStart(2,'0')+'j':'',String(m).padStart(2,'0')+'m',String(sec).padStart(2,'0')+'s'].filter(Boolean).join(' ')};
const labelMap={'message.inbound':'Pesan masuk','bot.reply_sent':'Bot membalas pesan','bot.message_sent':'Pesan bot terkirim','ai.request_started':'AI memulai pemrosesan','ai.response_delivered':'Jawaban AI selesai','ai.request_failed':'Permintaan AI gagal','ai.command_routed':'Intent command diarahkan','ai.non_generation_reply':'Respons non-generatif','whatsapp.open':'WhatsApp tersambung','whatsapp.close':'WhatsApp terputus','whatsapp.connecting':'WhatsApp menghubungkan'};
function renderChart(rows){const root=$('chart');root.replaceChildren();const max=Math.max(1,...rows.flatMap(x=>[Number(x.inbound)||0,Number(x.responses)||0]));for(const item of rows){const wrap=document.createElement('div');wrap.className='hour';const a=document.createElement('div');a.className='bar';a.style.height=Math.max(2,(Number(item.inbound)||0)/max*100)+'%';a.title='Pesan masuk: '+count(item.inbound);const b=document.createElement('div');b.className='bar response';b.style.height=Math.max(2,(Number(item.responses)||0)/max*100)+'%';b.title='Jawaban AI: '+count(item.responses);wrap.append(a,b);root.append(wrap);}}
function renderEvents(events){const root=$('events');root.replaceChildren();const items=Array.isArray(events)?events.slice(0,12):[];if(!items.length){const li=document.createElement('li');li.textContent='Belum ada event tercatat.';root.append(li);return;}for(const event of items){const li=document.createElement('li');const name=document.createElement('span');name.textContent=labelMap[event.kind]||'Event runtime';const detail=document.createElement('small');detail.textContent=[event.channel==='group'?'Grup':event.channel==='private'?'DM':'Sistem',event.provider||'',Number.isFinite(Number(event.latencyMs))?ms(event.latencyMs):'',time(event.ts)].filter(Boolean).join(' · ');li.append(name,detail);root.append(li);}}
function renderPolicy(rows){const root=$('policyRows');root.replaceChildren();for(const item of rows||[]){const div=document.createElement('div');div.className='reading';const a=document.createElement('span');a.textContent=item.policy||'Policy';const b=document.createElement('b');b.textContent='G '+num(item.expectedFreeEnergy,3)+' · risk '+num(item.risk,2);div.append(a,b);root.append(div);}if(!root.children.length)root.textContent='Policy evaluation belum tersedia.';}
function renderOccProfile(profile){const root=$('occProfile');const entries=Object.entries(profile||{}).filter(([,v])=>Number.isFinite(Number(v))).slice(0,8);root.textContent=entries.length?'OCC model: '+entries.map(([k,v])=>k+' '+num(v,2)).join(' · '):'OCC appraisal —';}
async function refresh(){try{const apiPath=location.pathname.replace(/\/+$/,'')+'/api';const response=await fetch(apiPath,{cache:'no-store',headers:{Accept:'application/json'}});if(!response.ok)throw new Error('HTTP '+response.status);const d=await response.json();const c=d.totals||{},a=d.ai||{},r=d.runtime||{},cir=d.circuits||{},pulse=cir.pulse||{},home=cir.homeostasis||{},neuro=cir.neuromodulators||{},aff=cir.syntheticAffect||{},self=cir.predictiveSelfModel||{},int=cir.integration||{},mem=cir.memoryLedger||{},conn=d.connection||{},wa=conn.whatsapp||{},nadi=conn.nadi||{};
put('incoming',count(c.incomingMessages));put('botOutputs',count(c.botOutputMessages));put('incomingSplit','DM '+count(c.incomingPrivateMessages)+' · Grup '+count(c.incomingGroupMessages));put('replied',count(c.botRespondingTurns));put('replySplit','DM '+count(c.privateRespondingTurns)+' · Grup '+count(c.groupRespondingTurns));put('aiResponses',count(c.aiResponses));put('aiSuccess',a.successRatePercent===null?'Keberhasilan —': 'Keberhasilan '+num(a.successRatePercent,1)+'% · gagal '+count(c.aiFailures));put('ticks',count(nadi.ticks??pulse.beat_count));put('pulseHint','Pulse '+num(pulse.bpm,1)+' bpm · '+(nadi.ready?'online':'offline'));
put('aiRequests',count(c.aiRequests));put('activeAi',count(a.activeRequests));put('avgLatency',ms(a.latency?.averageMs));put('p95Latency',ms(a.latency?.p95Ms));put('minLatency',ms(a.latency?.minMs));put('maxLatency',ms(a.latency?.maxMs));put('aiCommands',count(c.aiCommandIntents));put('responseChars',count(c.responseCharacters));put('providerCounts','Provider: '+Object.entries(a.providerCounts||{}).map(([k,v])=>k+' '+count(v)).join(' · '));renderChart(d.activity?.hourly||[]);renderEvents(d.activity?.recentEvents||[]);
put('bpm',num(pulse.bpm,2)+' bpm');put('phase',num(pulse.phase,4));put('pulseWave',num(pulse.pulse_wave,4));put('coherence',num(pulse.coherence,4));put('beatCount',count(pulse.beat_count));put('energy',pct(home.energy));put('thermal',pct(home.thermal_load));put('memoryPressure',pct(home.memory_pressure));put('socialBattery',pct(home.social_battery));put('allostatic',pct(home.allostatic_load));put('dopamine',pct(neuro.dopamine));put('serotonin',pct(neuro.serotonin));put('norepinephrine',pct(neuro.norepinephrine));put('acetylcholine',pct(neuro.acetylcholine));put('cortisol',pct(neuro.cortisol));put('oxytocin',pct(neuro.oxytocin));put('affectLabel',aff.dominantLabel||'—');put('valence',num(aff.valence,4));put('arousal',pct(aff.arousal));put('dominance',pct(aff.dominance));put('empathy',pct(aff.empathyResonance));renderOccProfile(aff.occProfile);put('agency',pct(self.agencyScore));put('continuity',pct(self.continuityIndex));put('kernelVersion',nadi.componentVersion||'—');put('identityVersion',d.identity?.version||'—');put('coreValues',count((self.coreValues||[]).length));put('phi',num(int.integrationPhiProxy,4));put('entropy',num(int.workspaceEntropy,4));put('avgTick',ms(int.averageTickMs));put('lastTick',ms(int.lastTickMs));put('percepts',count(int.totalPercepts));put('actions',count(int.totalActions));put('sleepCycles',count(int.totalSleepCycles));put('blockedActions',count(int.blockedActions));put('selectedPolicy',cir.deliberation?.selectedPolicy||'—');renderPolicy(cir.deliberation?.policyEvaluations||[]);put('chainLength',count(mem.chainLength));put('hashPrefix',mem.headHashPrefix||'—');put('chainIntegrity',mem.integrityState||'—');put('lastBeat',time(nadi.lastBeatAt));put('waStatus',wa.status||'unknown');put('reconnects',count(wa.reconnects));put('uptime',duration(r.uptimeSeconds));put('nodeVersion',r.nodeVersion||'—');put('rss',mb(r.memory?.rssBytes));put('heap',mb(r.memory?.heapUsedBytes)+' / '+mb(r.memory?.heapTotalBytes));put('cpuCount',count(r.cpuCount));put('kernelStatus','NADI: '+(nadi.ready?'READY':nadi.running?'STARTING':'OFFLINE')+' · Heartbeat: '+(nadi.heartbeatEnabled?'ON':'OFF')+' · '+count(nadi.intervalMs)+' ms · Source: '+(nadi.componentSource||'—')+' · Total output bot: '+count(c.botOutputMessages)+' · Total AI chars: '+count(c.responseCharacters));
const live=nadi.ready&&wa.status==='open';$('liveState').className='state '+(live?'online':'offline');put('liveText',live?'LIVE · WHATSAPP & NADI ONLINE':nadi.ready?'NADI ONLINE · WHATSAPP '+String(wa.status||'UNKNOWN').toUpperCase(): 'RUNTIME PARTIAL / OFFLINE');put('updatedAt',time(d.generatedAt));
}catch(error){$('liveState').className='state offline';put('liveText','DATA CONNECTION ERROR');put('updatedAt',error.message||'gagal memuat');}}
refresh();setInterval(refresh,2500);
</script></body></html>`;
}

function writeResponse(response, statusCode, contentType, body, extra = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': String(payload.length),
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...extra
  });
  response.end(payload);
}

function rateAllowed(request) {
  const forwarded = String(request.headers?.['cf-connecting-ip'] || '').trim();
  const remote = String(request.socket?.remoteAddress || 'unknown').trim();
  const address = (net.isIP(forwarded) ? forwarded : remote).slice(0, 64);
  const now = Date.now();
  const current = (requestBuckets.get(address) || []).filter(timestamp => now - timestamp < 60_000);
  if (current.length >= 300) return false;
  current.push(now);
  requestBuckets.set(address, current);
  if (requestBuckets.size > 1500) {
    for (const [key, values] of requestBuckets) {
      if (!values.some(timestamp => now - timestamp < 60_000)) requestBuckets.delete(key);
      if (requestBuckets.size <= 1200) break;
    }
  }
  return true;
}

export async function handleKernelDashboardRoute({ request, response, url }) {
  await loadDashboardToken();
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'kernel' || !parts[1]) return false;
  const suppliedHash = crypto.createHash('sha256').update(String(parts[1])).digest();
  if (!dashboardTokenHash || suppliedHash.length !== dashboardTokenHash.length || !crypto.timingSafeEqual(suppliedHash, dashboardTokenHash)) {
    writeResponse(response, 404, 'text/plain; charset=utf-8', 'Dashboard tidak ditemukan.');
    return true;
  }
  if (!rateAllowed(request)) {
    writeResponse(response, 429, 'application/json; charset=utf-8', JSON.stringify({ error: 'rate_limited' }), { 'Retry-After': '60' });
    return true;
  }
  const suffix = parts.slice(2).join('/');
  if (request.method !== 'GET') {
    writeResponse(response, 405, 'application/json; charset=utf-8', JSON.stringify({ error: 'method_not_allowed' }), { Allow: 'GET' });
    return true;
  }
  if (!suffix) {
    writeResponse(response, 200, 'text/html; charset=utf-8', dashboardHtml(), {
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    });
    return true;
  }
  if (suffix === 'api') {
    writeResponse(response, 200, 'application/json; charset=utf-8', safeJson(buildPublicKernelSnapshot()));
    return true;
  }
  writeResponse(response, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'not_found' }));
  return true;
}

registerKernelDashboardRouteHandler(handleKernelDashboardRoute);

export async function publishKernelDashboard() {
  const token = await loadDashboardToken();
  const gateway = await getPublicGatewayUrl();
  const url = new URL(`/kernel/${token}`, gateway).toString();
  return {
    url,
    created: true,
    public: true,
    privacy: 'Aggregate operational telemetry only; no chat text, phone numbers, JIDs, or private memory.'
  };
}
