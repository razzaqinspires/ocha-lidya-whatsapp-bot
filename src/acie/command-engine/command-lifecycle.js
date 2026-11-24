import path from 'node:path';
import fs from 'node:fs/promises';
import { getACIEPaths } from '../core/paths.js';
import { readJson, writeJsonAtomic, acquireExclusiveFileLock } from '../core/fs-safe.js';
import { getProvider } from '../registry/provider-registry.js';
import { canActivateProvider } from '../security/policy.js';
import { appendACIEAudit } from '../telemetry/audit-log.js';
import { writeGeneratedCommandCatalog } from './command-catalog.js';

async function updateStores(commandId, updater, { root = process.cwd(), actor = 'owner' } = {}) {
  const paths = getACIEPaths(root);
  await fs.mkdir(paths.generatedCommands, { recursive: true, mode: 0o700 });
  await fs.mkdir(paths.registry, { recursive: true, mode: 0o700 });
  const releaseCommandLock = await acquireExclusiveFileLock(path.join(paths.generatedCommands, '.commands.lock'), 'ACIE command lifecycle update is already running.');
  let releaseRegistryLock = null;
  try {
    releaseRegistryLock = await acquireExclusiveFileLock(path.join(paths.registry, '.registry.lock'), 'ACIE registry update is already running.');
    const generatedFile = path.join(paths.generatedCommands, 'index.json');
    const registryFile = path.join(paths.registry, 'commands.json');
    const generated = await readJson(generatedFile, { schemaVersion: 1, commands: [] });
    const registry = await readJson(registryFile, { schemaVersion: 1, commands: [] });
    let item = generated.commands.find(entry => entry.commandId === commandId);
    if (!item) {
      item = registry.commands.find(entry => entry.commandId === commandId);
      if (item) generated.commands.push(structuredClone(item));
    }
    if (!item) throw new Error(`Command draft tidak ditemukan: ${commandId}`);
    const result = await updater(item);
    for (const store of [generated, registry]) {
      const index = store.commands.findIndex(entry => entry.commandId === commandId);
      if (index >= 0) store.commands[index] = structuredClone(item);
      else store.commands.push(structuredClone(item));
      store.updatedAt = new Date().toISOString();
    }
    await writeJsonAtomic(generatedFile, generated);
    await writeJsonAtomic(registryFile, registry);
    await writeGeneratedCommandCatalog(paths.generatedCommands, generated.commands);
    await appendACIEAudit('command.lifecycle.updated', { commandId, command: item.command, status: item.status, actor }, { root });
    return result || item;
  } finally { await releaseRegistryLock?.(); await releaseCommandLock(); }
}

export async function approveCommandDraft(commandId, { root = process.cwd(), actor = 'owner', permission = 'owner' } = {}) {
  if (!['owner', 'public'].includes(permission)) throw new Error('Permission harus owner atau public.');
  const result = await updateStores(commandId, async item => {
    if (item.status === 'blocked-collision' || (item.collision?.detected && !item.collision?.resolved)) throw new Error('Command masih memiliki konflik nama yang belum diselesaikan.');
    if (!['draft-pending-validation', 'draft-pending-review'].includes(item.status)) throw new Error(`Command tidak dapat diaktifkan dari status ${item.status}.`);
    const provider = await getProvider(item.providerMapping, { root });
    if (!provider || provider.status !== 'active') throw new Error('Provider harus aktif terlebih dahulu.');
    const gate = canActivateProvider(provider, { root });
    if (!gate.allowed) throw new Error(`Provider belum memenuhi security gate: ${gate.missing.join(', ')}`);
    if (!provider.capabilities?.includes(item.capability)) throw new Error('Capability tidak cocok dengan provider.');
    item.permission = permission;
    item.status = 'active';
    item.approval = { actor: String(actor).slice(0, 100), at: new Date().toISOString(), permission };
    item.activation = { registeredInPluginLoader: true, visibleInUserMenu: true, ownerApprovalRequired: false };
    return item;
  }, { root, actor });
  const loader = await import('../../core/plugin-loader.js');
  const sync = root === process.cwd() ? await loader.refreshGeneratedCommandPlugins() : { loaded: 0, skipped: 0, reasons: ['runtime-registry-refresh-requires-project-root'] };
  await appendACIEAudit('command.activated', { commandId, command: result.command, permission, loaded: sync.loaded, skipped: sync.skipped }, { root });
  return { command: result, sync };
}

export async function rejectCommandDraft(commandId, { root = process.cwd(), actor = 'owner', reason = 'rejected-by-owner' } = {}) {
  const result = await updateStores(commandId, item => {
    if (item.status === 'active') throw new Error('Command aktif harus dinonaktifkan/dicabut sebelum ditolak.');
    item.status = 'rejected';
    item.rejection = { actor: String(actor).slice(0, 100), reason: String(reason).slice(0, 200), at: new Date().toISOString() };
    item.activation = { registeredInPluginLoader: false, visibleInUserMenu: false, ownerApprovalRequired: false };
    return item;
  }, { root, actor });
  return result;
}

export async function revokeGeneratedCommand(commandId, { root = process.cwd(), actor = 'owner', reason = 'revoked-by-owner' } = {}) {
  const result = await updateStores(commandId, item => {
    item.status = 'revoked';
    item.revocation = { actor: String(actor).slice(0, 100), reason: String(reason).slice(0, 200), at: new Date().toISOString() };
    item.activation = { registeredInPluginLoader: false, visibleInUserMenu: false, ownerApprovalRequired: false };
    return item;
  }, { root, actor });
  const loader = await import('../../core/plugin-loader.js');
  const sync = root === process.cwd() ? await loader.refreshGeneratedCommandPlugins() : { loaded: 0, skipped: 0, reasons: ['runtime-registry-refresh-requires-project-root'] };
  return { command: result, sync };
}

export async function synchronizeCommandRegistries({ root = process.cwd() } = {}) {
  const paths = getACIEPaths(root);
  await fs.mkdir(paths.generatedCommands, { recursive: true, mode: 0o700 });
  await fs.mkdir(paths.registry, { recursive: true, mode: 0o700 });
  const releaseCommandLock = await acquireExclusiveFileLock(path.join(paths.generatedCommands, '.commands.lock'), 'ACIE command registry sync is already running.');
  let releaseRegistryLock = null;
  try {
    releaseRegistryLock = await acquireExclusiveFileLock(path.join(paths.registry, '.registry.lock'), 'ACIE registry sync is already running.');
    const generatedFile = path.join(paths.generatedCommands, 'index.json');
    const registryFile = path.join(paths.registry, 'commands.json');
    let generated = await readJson(generatedFile, null);
    const registry = await readJson(registryFile, { schemaVersion: 1, commands: [] });
    if (!generated || !Array.isArray(generated.commands)) {
      generated = { schemaVersion: 1, commands: structuredClone(registry.commands || []), updatedAt: new Date().toISOString() };
      await writeJsonAtomic(generatedFile, generated);
    }
    for (const item of generated.commands) {
      const index = registry.commands.findIndex(entry => entry.commandId === item.commandId);
      if (index >= 0) registry.commands[index] = structuredClone(item);
      else registry.commands.push(structuredClone(item));
    }
    registry.updatedAt = generated.updatedAt || new Date().toISOString();
    await writeJsonAtomic(registryFile, registry);
    const catalogPath = await writeGeneratedCommandCatalog(paths.generatedCommands, generated.commands);
    return { canonicalCount: generated.commands.length, compatibilityCount: registry.commands.length, catalogPath };
  } finally { await releaseRegistryLock?.(); await releaseCommandLock(); }
}

