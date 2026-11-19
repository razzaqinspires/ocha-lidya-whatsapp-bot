import { getConfig, updateConfig } from './config.js';
export function getPrefixes() {
  const p = getConfig().prefix;
  if (p.mode === 'none') return [];
  if (p.mode === 'single') return [p.single];
  return [...new Set(p.list || [])].sort((a,b) => b.length - a.length);
}
export function parseCommand(body) {
  const text = String(body || '').trim();
  if (!text) return null;
  const prefixes = getPrefixes();
  const prefix = prefixes.find(p => text.startsWith(p));
  if (!prefix) {
    if (getConfig().prefix.mode !== 'none') return null;
    return parseBody(text, '');
  }
  return parseBody(text.slice(prefix.length), prefix);
}
function parseBody(raw, prefix) {
  const input = raw.trim();
  if (!input) return null;
  const [command = '', ...rest] = input.split(/\s+/);
  return { prefix, command: command.toLowerCase(), args: rest, text: rest.join(' '), raw: input };
}
export async function setPrefixMode(mode) {
  if (!['single','multi','none'].includes(mode)) throw new Error('Mode harus single, multi, atau none.');
  await updateConfig(c => { c.prefix.mode = mode; }, { reason: `prefix mode: ${mode}` });
}
export async function setSinglePrefix(prefix) {
  if (!prefix || /\s/.test(prefix) || prefix.length > 4) throw new Error('Prefix tidak valid (1-4 karakter tanpa spasi).');
  await updateConfig(c => { c.prefix.single = prefix; c.prefix.mode = 'single'; }, { reason: `single prefix: ${prefix}` });
}
export async function addPrefix(prefix) {
  if (!prefix || /\s/.test(prefix) || prefix.length > 4) throw new Error('Prefix tidak valid.');
  await updateConfig(c => { c.prefix.list = [...new Set([...(c.prefix.list || []), prefix])]; c.prefix.mode = 'multi'; }, { reason: `add prefix: ${prefix}` });
}
export async function removePrefix(prefix) {
  await updateConfig(c => { c.prefix.list = (c.prefix.list || []).filter(p => p !== prefix); }, { reason: `remove prefix: ${prefix}` });
}
