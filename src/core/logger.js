import { inspect } from 'node:util';

const LEVELS = Object.freeze({ trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: 99 });
const ANSI = Object.freeze({
  reset: '\u001b[0m', dim: '\u001b[2m', bold: '\u001b[1m',
  cyan: '\u001b[36m', blue: '\u001b[34m', green: '\u001b[32m',
  yellow: '\u001b[33m', red: '\u001b[31m', white: '\u001b[97m',
  magenta: '\u001b[35m', bgRed: '\u001b[41m'
});

const levelColor = {
  trace: ANSI.dim, debug: ANSI.cyan, info: ANSI.green,
  warn: ANSI.yellow, error: ANSI.red, fatal: `${ANSI.bgRed}${ANSI.white}${ANSI.bold}`
};
const SECRET_FIELD = /(?:priv(?:ate)?key|rootkey|chainkey|identitykey|remoteidentitykey|ephemeralkeypair|lastremoteephemeralkey|signedprekey|advsecretkey|noise key|authstate|creds|password|token|secret|api.?key)/i;
const REDACTED = '[REDACTED]';
let settings = { level: 'info', color: 'auto', timeZone: 'Asia/Jakarta' };

export function sanitizeLogValue(value, key = '', seen = new WeakSet(), depth = 0) {
  if (SECRET_FIELD.test(String(key))) return REDACTED;
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (depth > 7) return '[MaxDepth]';
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (value instanceof Error) return { name: value.name, message: value.message, code: value.code, stack: value.stack };
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeLogValue(item, '', seen, depth + 1));
  const output = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 150)) {
    output[childKey] = sanitizeLogValue(childValue, childKey, seen, depth + 1);
  }
  return output;
}

const colorEnabled = () => {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return settings.color === 'always' ||
    (settings.color === 'auto' && Boolean(process.stdout.isTTY) && process.env.TERM !== 'dumb');
};
const paint = (value, code) => colorEnabled() ? `${code}${value}${ANSI.reset}` : String(value);

function formatTimestamp(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('id-ID', {
      timeZone: settings.timeZone,
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).format(date);
    return `${parts} ${settings.timeZone === 'Asia/Jakarta' ? 'WIB' : settings.timeZone}`;
  } catch {
    return date.toISOString();
  }
}

function normalizeArgs(args) {
  const values = [...args];
  let fields = {};
  let message = '';
  if (typeof values[0] === 'string') message = values.shift();
  else if (values[0] && typeof values[0] === 'object') {
    fields = values.shift();
    message = typeof values[0] === 'string' ? values.shift() : '';
  }
  if (!message && values.length) message = values.map(String).join(' ');
  return { fields, message };
}

function createLogger(bindings = {}) {
  const api = {};
  for (const level of Object.keys(LEVELS)) {
    api[level] = (...args) => {
      if (LEVELS[level] < LEVELS[settings.level] || level === 'silent') return;
      const { fields, message } = normalizeArgs(args);
      const merged = sanitizeLogValue({ ...bindings, ...fields });
      const scope = merged.component || merged.scope || 'OCHA LIDYA';
      delete merged.component;
      delete merged.scope;
      const hasDetails = Object.keys(merged).length > 0;
      const label = level.toUpperCase().padEnd(5, ' ');
      const safeMessage = String(message || '(no message)').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
      const line = `${paint(`[${formatTimestamp()}]`, ANSI.dim)} ${paint(label, levelColor[level])} ${paint(`[${scope}]`, ANSI.magenta)} ${paint(safeMessage, ANSI.white)}`;
      const output = hasDetails
        ? `${line} ${paint(inspect(merged, { colors: colorEnabled(), depth: 5, compact: true, breakLength: 120, maxArrayLength: 30 }), ANSI.dim)}`
        : line;
      const stream = level === 'error' || level === 'fatal' ? process.stderr : process.stdout;
      stream.write(`${output}\n`);
    };
  }
  api.child = childBindings => createLogger({ ...bindings, ...(childBindings || {}) });
  Object.defineProperty(api, 'level', { get: () => settings.level });
  return api;
}

export function configureLogger(next = {}) {
  settings = {
    ...settings,
    ...(next || {}),
    level: LEVELS[next?.level] !== undefined ? next.level : settings.level
  };
}

/** Identify the known libsignal diagnostic that prints private session internals. */
export function isSensitiveSessionDump(args = []) {
  const text = args.filter(value => typeof value === 'string').join(' ');
  return /Closing session:\s*SessionEntry|SessionEntry\s*\{/i.test(text);
}

/** Suppress libsignal's raw SessionEntry dump and redact sensitive console objects. */
export function installConsoleLogGuard() {
  const marker = Symbol.for('ocha.console.log.guard');
  if (console[marker]) return false;
  Object.defineProperty(console, marker, { value: true, configurable: false });
  for (const method of ['log', 'info', 'debug', 'warn', 'error']) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      if (isSensitiveSessionDump(args)) return;
      original(...args.map(value => sanitizeLogValue(value)));
    };
  }
  return true;
}

export const logger = createLogger();
installConsoleLogGuard();
const noop = () => {};
const silentBaileysLogger = {
  level: 'silent', trace: noop, debug: noop, info: noop, warn: noop,
  error: noop, fatal: noop,
  child() { return silentBaileysLogger; },
  isLevelEnabled() { return false; }
};
export const baileysLogger = silentBaileysLogger;
export default logger;
