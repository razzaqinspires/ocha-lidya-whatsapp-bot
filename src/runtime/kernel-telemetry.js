import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_FILE = path.resolve(process.env.OCHA_KERNEL_TELEMETRY_FILE || path.join(process.cwd(), 'data', 'kernel', 'telemetry.json'));
const MAX_EVENTS = 48;
const MAX_LATENCY_SAMPLES = 512;
const MAX_HOURLY_BUCKETS = 24 * 14;

function emptyData() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    firstSeenAt: now,
    updatedAt: now,
    counters: {
      incomingMessages: 0,
      incomingGroupMessages: 0,
      incomingPrivateMessages: 0,
      botOutputMessages: 0,
      botRespondingTurns: 0,
      groupRespondingTurns: 0,
      privateRespondingTurns: 0,
      aiRequests: 0,
      aiResponses: 0,
      aiFailures: 0,
      aiCommandIntents: 0,
      responseCharacters: 0
    },
    providerCounts: {},
    latencySamplesMs: [],
    hourly: {},
    recentEvents: []
  };
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function normalizeData(value) {
  const base = emptyData();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  const counters = value.counters && typeof value.counters === 'object' ? value.counters : {};
  for (const key of Object.keys(base.counters)) base.counters[key] = finiteCount(counters[key]);
  const providers = value.providerCounts && typeof value.providerCounts === 'object' ? value.providerCounts : {};
  base.providerCounts = Object.fromEntries(Object.entries(providers)
    .filter(([key]) => /^[a-z0-9_-]{1,32}$/i.test(key))
    .map(([key, count]) => [key, finiteCount(count)]));
  base.firstSeenAt = typeof value.firstSeenAt === 'string' ? value.firstSeenAt : base.firstSeenAt;
  base.updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : base.updatedAt;
  base.latencySamplesMs = Array.isArray(value.latencySamplesMs)
    ? value.latencySamplesMs.map(Number).filter(number => Number.isFinite(number) && number >= 0).slice(-MAX_LATENCY_SAMPLES)
    : [];
  base.hourly = value.hourly && typeof value.hourly === 'object' ? Object.fromEntries(
    Object.entries(value.hourly)
      .filter(([key, bucket]) => /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(key) && bucket && typeof bucket === 'object')
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-MAX_HOURLY_BUCKETS)
      .map(([key, bucket]) => [key, {
        inbound: finiteCount(bucket.inbound),
        responses: finiteCount(bucket.responses),
        failures: finiteCount(bucket.failures)
      }])
  ) : {};
  base.recentEvents = Array.isArray(value.recentEvents) ? value.recentEvents.slice(-MAX_EVENTS).filter(item =>
    item && typeof item === 'object' && typeof item.ts === 'string' && typeof item.kind === 'string'
  ).map(item => ({
    ts: item.ts,
    kind: String(item.kind).slice(0, 32),
    channel: item.channel === 'group' ? 'group' : item.channel === 'private' ? 'private' : 'system',
    ...(typeof item.provider === 'string' ? { provider: item.provider.slice(0, 32) } : {}),
    ...(Number.isFinite(Number(item.latencyMs)) ? { latencyMs: Math.max(0, Number(item.latencyMs)) } : {})
  })) : [];
  return base;
}

let data = emptyData();
let initialized = false;
let persistTimer = null;
let persistQueue = Promise.resolve();
let activeAiRequests = 0;
let connection = { status: 'unknown', since: null, reconnects: 0 };

function hourKey(date = new Date()) { return date.toISOString().slice(0, 13); }

function ensureBucket(ts = new Date()) {
  const key = hourKey(ts);
  if (!data.hourly[key]) data.hourly[key] = { inbound: 0, responses: 0, failures: 0 };
  const keys = Object.keys(data.hourly).sort();
  while (keys.length > MAX_HOURLY_BUCKETS) delete data.hourly[keys.shift()];
  return data.hourly[key];
}

function pushEvent(kind, channel = 'system', extra = {}) {
  const event = {
    ts: new Date().toISOString(),
    kind: String(kind).slice(0, 32),
    channel: ['group', 'private'].includes(channel) ? channel : 'system',
    ...(extra.provider ? { provider: String(extra.provider).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) } : {}),
    ...(Number.isFinite(Number(extra.latencyMs)) ? { latencyMs: Math.max(0, Number(extra.latencyMs)) } : {})
  };
  data.recentEvents.push(event);
  if (data.recentEvents.length > MAX_EVENTS) data.recentEvents.splice(0, data.recentEvents.length - MAX_EVENTS);
}

function schedulePersist() {
  if (!initialized || persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const snapshot = JSON.stringify(data, null, 2);
    persistQueue = persistQueue.then(async () => {
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true, mode: 0o700 });
      const temporary = `${DATA_FILE}.${process.pid}.tmp`;
      await fs.writeFile(temporary, snapshot, { mode: 0o600 });
      await fs.rename(temporary, DATA_FILE);
    }).catch(error => {
      // Telemetry must never interrupt message processing.
      try { process.stderr.write(`[KERNEL TELEMETRY] persistence unavailable: ${String(error.message || error).slice(0, 180)}\n`); } catch {}
    });
  }, 350);
  persistTimer.unref?.();
}

export async function initializeKernelTelemetry() {
  if (initialized) return getKernelTelemetrySnapshot();
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    data = normalizeData(JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      // Keep a malformed archive untouched for inspection and start a fresh
      // telemetry segment instead of risking the core WhatsApp runtime.
      const quarantine = `${DATA_FILE}.invalid-${Date.now()}`;
      await fs.rename(DATA_FILE, quarantine).catch(() => {});
    }
    data = emptyData();
  }
  initialized = true;
  schedulePersist();
  return getKernelTelemetrySnapshot();
}

function mutate(callback) {
  if (!initialized) {
    // This module is also safe for unit tests and import paths that do not run
    // the full application bootstrap.
    initialized = true;
  }
  callback();
  data.updatedAt = new Date().toISOString();
  schedulePersist();
}

export function recordIncomingMessage({ isGroup = false } = {}) {
  const channel = isGroup ? 'group' : 'private';
  mutate(() => {
    data.counters.incomingMessages += 1;
    data.counters[isGroup ? 'incomingGroupMessages' : 'incomingPrivateMessages'] += 1;
    ensureBucket().inbound += 1;
    pushEvent('message.inbound', channel);
  });
}

export function recordBotOutputMessage({ isGroup = false, isReplyTurn = false } = {}) {
  const channel = isGroup ? 'group' : 'private';
  mutate(() => {
    data.counters.botOutputMessages += 1;
    if (isReplyTurn) {
      data.counters.botRespondingTurns += 1;
      data.counters[isGroup ? 'groupRespondingTurns' : 'privateRespondingTurns'] += 1;
    }
    pushEvent(isReplyTurn ? 'bot.reply_sent' : 'bot.message_sent', channel);
  });
}

export function beginAIRequest({ isGroup = false } = {}) {
  activeAiRequests += 1;
  mutate(() => {
    data.counters.aiRequests += 1;
    pushEvent('ai.request_started', isGroup ? 'group' : 'private');
  });
}

export function finishAIRequest({
  outcome = 'failure', isGroup = false, latencyMs = null,
  provider = null, outputChars = 0
} = {}) {
  activeAiRequests = Math.max(0, activeAiRequests - 1);
  const channel = isGroup ? 'group' : 'private';
  const normalizedLatency = Number(latencyMs);
  const hasLatency = Number.isFinite(normalizedLatency) && normalizedLatency >= 0;
  const cleanProvider = String(provider || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  mutate(() => {
    if (outcome === 'response') {
      data.counters.aiResponses += 1;
      data.counters.responseCharacters += finiteCount(outputChars);
      ensureBucket().responses += 1;
      if (hasLatency) {
        data.latencySamplesMs.push(Math.round(normalizedLatency * 100) / 100);
        if (data.latencySamplesMs.length > MAX_LATENCY_SAMPLES) data.latencySamplesMs.splice(0, data.latencySamplesMs.length - MAX_LATENCY_SAMPLES);
      }
      if (cleanProvider) data.providerCounts[cleanProvider] = finiteCount(data.providerCounts[cleanProvider]) + 1;
      pushEvent('ai.response_delivered', channel, { provider: cleanProvider, latencyMs: hasLatency ? normalizedLatency : undefined });
    } else if (outcome === 'command') {
      data.counters.aiCommandIntents += 1;
      pushEvent('ai.command_routed', channel);
    } else if (outcome === 'failure') {
      data.counters.aiFailures += 1;
      ensureBucket().failures += 1;
      pushEvent('ai.request_failed', channel, { latencyMs: hasLatency ? normalizedLatency : undefined });
    } else {
      pushEvent('ai.non_generation_reply', channel);
    }
  });
}

export function setWhatsAppConnection(status) {
  const next = String(status || 'unknown').toLowerCase();
  if (!['open', 'connecting', 'close', 'unknown'].includes(next)) return;
  if (next === connection.status) return;
  if (next === 'connecting' && ['open', 'close'].includes(connection.status)) connection.reconnects += 1;
  connection = { ...connection, status: next, since: new Date().toISOString() };
  mutate(() => pushEvent(`whatsapp.${next}`, 'system'));
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1))];
}

export function getKernelTelemetrySnapshot() {
  const counters = { ...data.counters };
  const samples = data.latencySamplesMs;
  const averageLatencyMs = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null;
  const completed = counters.aiResponses + counters.aiFailures;
  const successRate = completed ? counters.aiResponses / completed * 100 : null;
  const now = new Date();
  const hourly = Array.from({ length: 24 }, (_, index) => {
    const date = new Date(now.getTime() - (23 - index) * 60 * 60 * 1000);
    return { hour: hourKey(date), ...(data.hourly[hourKey(date)] || { inbound: 0, responses: 0, failures: 0 }) };
  });
  return {
    counters,
    activeAiRequests,
    connection: { ...connection },
    latency: {
      sampleCount: samples.length,
      averageMs: averageLatencyMs === null ? null : Math.round(averageLatencyMs * 100) / 100,
      p95Ms: percentile(samples, 0.95),
      minMs: samples.length ? Math.min(...samples) : null,
      maxMs: samples.length ? Math.max(...samples) : null
    },
    providerCounts: { ...data.providerCounts },
    hourly,
    recentEvents: [...data.recentEvents].reverse(),
    firstSeenAt: data.firstSeenAt,
    updatedAt: data.updatedAt
  };
}

export async function flushKernelTelemetry() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
    const snapshot = JSON.stringify(data, null, 2);
    persistQueue = persistQueue.then(async () => {
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true, mode: 0o700 });
      const temporary = `${DATA_FILE}.${process.pid}.tmp`;
      await fs.writeFile(temporary, snapshot, { mode: 0o600 });
      await fs.rename(temporary, DATA_FILE);
    });
  }
  await persistQueue;
}
