import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { getACIEPaths } from '../core/paths.js';
import { writeJsonAtomic, readJson, acquireExclusiveFileLock } from '../core/fs-safe.js';
import { writeGeneratedCommandCatalog } from './command-catalog.js';

const SHORT = Object.freeze({ 'image-canvas': 'timg', pinterest: 'pin', tiktok: 'tt', instagram: 'ig', youtube: 'yt', facebook: 'fb', twitter: 'x', reddit: 'rd', soundcloud: 'sc' });

function commandForCapability(capability) {
  const platform = String(capability?.platform || '').toLowerCase();
  const action = String(capability?.action || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(platform)) return null;
  const short = SHORT[platform] || platform;
  const specs = {
    'render.text': ['textimage', `${short}`, 'Membuat gambar teks menggunakan template Canvas kontribusi yang telah disetujui.'],
    metadata: ['info', `${short}info`, 'Ambil metadata dari URL yang didukung.'],
    search: ['search', `${short}search`, 'Cari konten melalui provider yang mendukung pencarian.'],
    'download.video': ['video', `${short}video`, 'Proses pengambilan video melalui provider yang disetujui.'],
    'download.audio': ['audio', `${short}audio`, 'Proses pengambilan audio melalui provider yang disetujui.'],
    'download.image': ['image', `${short}image`, 'Proses pengambilan gambar melalui provider yang disetujui.'],
    download: ['download', `${short}dl`, 'Proses pengunduhan melalui provider yang disetujui.']
  };
  const spec = specs[action];
  if (!spec) return null;
  const fixedCanvas = platform === 'image-canvas' && action === 'render.text';
  return { preferredName: fixedCanvas ? 'textimage' : `${platform}-${spec[0]}`, preferredAliases: fixedCanvas ? ['timg'] : [spec[1]], description: spec[2], category: fixedCanvas ? 'image' : 'downloader', inputMode: fixedCanvas ? 'none' : 'text' };
}

function reserveUniqueName(preferredName, preferredAliases, occupied) {
  const conflictNames = [preferredName, ...preferredAliases].filter(name => occupied.has(name));
  let command = preferredName;
  if (occupied.has(command)) {
    let suffix = 1;
    command = `acie-${preferredName}`;
    while (occupied.has(command) && suffix <= 1000) command = `acie-${preferredName}-${++suffix}`;
    if (occupied.has(command)) return { command: preferredName, aliases: [], conflictNames, resolved: false, resolution: null };
  }
  const aliases = preferredAliases.filter(alias => !occupied.has(alias) && alias !== command);
  occupied.set(command, `ACIE:${preferredName}`);
  for (const alias of aliases) occupied.set(alias, command);
  return {
    command, aliases, conflictNames, resolved: true,
    resolution: command !== preferredName ? `namespaced-as-${command}` : conflictNames.length ? 'dropped-conflicting-aliases' : null
  };
}

export async function scanExistingPluginCommands({ root = process.cwd() } = {}) {
  const pluginRoot = path.join(root, 'src', 'plugins');
  const files = [];
  async function walk(directory) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
    }
  }
  await walk(pluginRoot);
  const commands = [];
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const exportIndex = text.lastIndexOf('export default');
    if (exportIndex < 0) continue;
    const descriptor = text.slice(exportIndex);
    const nameMatch = descriptor.match(/\bname\s*:\s*(['"])([a-z0-9_-]+)\1/i);
    if (!nameMatch) continue;
    const aliasesMatch = descriptor.match(/\baliases\s*:\s*\[([\s\S]*?)\]/i);
    const aliases = aliasesMatch ? [...aliasesMatch[1].matchAll(/['"]([a-z0-9_-]+)['"]/gi)].map(match => match[1].toLowerCase()) : [];
    commands.push({ name: nameMatch[2].toLowerCase(), aliases, file: path.relative(root, file).split(path.sep).join('/') });
  }
  const generated = await readJson(path.join(getACIEPaths(root).generatedCommands, 'index.json'), { commands: [] });
  for (const item of generated.commands || []) {
    if (['rejected', 'revoked'].includes(item.status)) continue;
    commands.push({ name: String(item.command || '').toLowerCase(), aliases: (item.aliases || []).map(value => String(value).toLowerCase()), generated: true });
  }
  return commands;
}

export function buildCommandDrafts({ contributionId, providerId, capabilities = [], existingPlugins = [] } = {}) {
  const occupied = new Map();
  for (const plugin of existingPlugins) {
    const names = [plugin.name, ...(plugin.aliases || [])].map(value => String(value || '').toLowerCase());
    for (const name of names) if (name) occupied.set(name, plugin.name || 'existing-command');
  }
  const result = [];
  const seen = new Set();
  for (const capability of capabilities) {
    const generated = commandForCapability(capability);
    if (!generated || seen.has(capability.id)) continue;
    seen.add(capability.id);
    const reserved = reserveUniqueName(generated.preferredName, generated.preferredAliases, occupied);
    const collision = {
      detected: reserved.conflictNames.length > 0,
      resolved: reserved.resolved,
      originalNames: reserved.conflictNames,
      resolution: reserved.resolution
    };
    result.push({
      commandId: `ACIE-CMD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      command: reserved.command, preferredCommand: generated.preferredName, aliases: reserved.aliases,
      category: generated.category, description: generated.description,
      help: `${generated.description} Capability: ${capability.id}.`,
      syntax: generated.inputMode === 'none' ? `.${reserved.command}` : `.${reserved.command} <input>`,
      parameters: generated.inputMode === 'none' ? [] : [{ name: 'input', required: true, description: 'Input yang diterima oleh kontrak adapter; format final harus diuji.' }],
      examples: [generated.inputMode === 'none' ? `.${reserved.command}` : `.${reserved.command} <URL yang didukung provider>`], inputMode: generated.inputMode || 'text', permission: 'pending-review', cooldownMs: 15000,
      rateLimit: { max: 5, windowMs: 60000 }, providerMapping: providerId,
      capability: capability.id, expectedOutput: 'unverified',
      outputContract: capability.adapterProtocol || 'acie-json-stdio-v1',
      errorResponse: 'normalized-by-ACIE-after-contract-validation',
      collision,
      status: reserved.resolved ? 'draft-pending-validation' : 'blocked-collision',
      activation: { registeredInPluginLoader: false, visibleInUserMenu: false, ownerApprovalRequired: true },
      contributionId, generatedAt: new Date().toISOString()
    });
  }
  return result;
}

export async function persistCommandDrafts(drafts, { root = process.cwd() } = {}) {
  const paths = getACIEPaths(root);
  const directory = paths.generatedCommands;
  const file = path.join(directory, 'index.json');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const releaseLock = await acquireExclusiveFileLock(path.join(directory, '.commands.lock'), 'ACIE command registry update is already running.');
  let releaseRegistryLock = null;
  try {
    const store = await readJson(file, { schemaVersion: 1, commands: [] });
    const known = new Set(store.commands.map(item => `${item.contributionId}:${item.capability}`));
    const added = drafts.filter(item => !known.has(`${item.contributionId}:${item.capability}`));
    store.commands.push(...added);
    store.updatedAt = new Date().toISOString();
    await writeJsonAtomic(file, store);
    await fs.mkdir(paths.registry, { recursive: true, mode: 0o700 });
    releaseRegistryLock = await acquireExclusiveFileLock(path.join(paths.registry, '.registry.lock'), 'ACIE registry update is already running.');
    const registryFile = path.join(paths.registry, 'commands.json');
    const registry = await readJson(registryFile, { schemaVersion: 1, commands: [] });
    const registryKnown = new Set(registry.commands.map(item => item.commandId));
    registry.commands.push(...store.commands.filter(item => !registryKnown.has(item.commandId)));
    registry.updatedAt = store.updatedAt;
    await writeJsonAtomic(registryFile, registry);
    await writeGeneratedCommandCatalog(directory, store.commands);
    return store.commands;
  } finally { await releaseRegistryLock?.(); await releaseLock(); }
}
