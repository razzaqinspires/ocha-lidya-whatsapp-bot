import {
  getACIEOverview, listProviders, listCapabilities, listCommandDrafts,
  listContributions, listContributionVersions, findContribution, verifyContribution, readACIEAudit,
  inspectRuntimeHost, probeSandboxRuntime, listWorkers, getRoutingStats, selectProviders,
  inspectProvider, setProviderEnabled, reviewProviderStage, testProviderAdapter,
  approveCommandDraft, rejectCommandDraft, revokeGeneratedCommand, synchronizeCommandRegistries
} from '../../acie/index.js';
import { readJson } from '../../acie/core/fs-safe.js';
import { writeGeneratedCommandCatalog } from '../../acie/command-engine/command-catalog.js';
import { getACIEPaths } from '../../acie/core/paths.js';

const clip = (value, max = 3500) => String(value ?? '').slice(0, max);
const fmt = value => JSON.stringify(value, null, 2);
const usage = `ACIE · AUTONOMOUS CONTRIBUTION INTELLIGENCE\n\n.acie status | overview | statistics\n.acie contribution list\n.acie contribution inspect <contribution-id|contributor/name>\n.acie contribution verify <contribution-id>\n.acie contribution history <contribution-id>\n.acie contribution provenance <contribution-id>\n.acie capabilities | languages\n.acie provider list | inspect <provider-id> | review <provider-id> license|attribution|sandbox|authorization\n.acie provider test <provider-id> | disable <provider-id> | enable <provider-id>\n.acie adapter review|test <provider-id>\n.acie routing status | inspect <capability-id> | simulate <capability-id>\n.acie commands list | inspect <id> | conflicts | test <command-id> | approve <command-id> [public|owner] | reject <command-id> <reason> | revoke <command-id>\n.acie workers\n.acie integrity | security | dependencies | compatibility\n.acie audit [limit]\n\nIntake source directory/ZIP dari VPS:\nnpm run acie:intake -- --source <folder-or-zip> --contributor-id <id> --name <name> --license <license> --attribution <text>`;

function summarizeCapability(item) { return `${item.id} · ${item.status} · evidence: ${(item.evidence || []).join(', ') || '-'}`; }

export default {
  name: 'acie', aliases: ['contribengine'], category: 'owner', menuCategory: 'owner', ownerOnly: true, privateOnly: true,
  description: 'Kelola Contribution Vault, capability intelligence, provider registry, routing, command drafts, worker, integrity, dan audit ACIE.',
  usage: '.acie [status|contribution|provider|routing|commands|workers|integrity|security|audit]',
  async execute({ m, args }) {
    const [sectionRaw = 'help', actionRaw = '', ...rest] = args;
    const section = String(sectionRaw).toLowerCase();
    const action = String(actionRaw).toLowerCase();

    if (['help', 'menu'].includes(section)) return m.reply(usage);
    if (['status', 'overview', 'statistics', 'stats'].includes(section)) {
      const overview = await getACIEOverview();
      const host = inspectRuntimeHost();
      return m.reply(`*ACIE STATUS*\nContributions: ${overview.contributions.total}\nOriginal files: ${overview.contributions.totalFiles}\nContributors: ${overview.contributions.contributors}\nVersions: ${overview.contributions.versions}\nLanguages: ${overview.contributions.languages}\nCapabilities: ${overview.contributions.capabilities}\n\nProviders: ${overview.providers.total}\nActive: ${overview.providers.active}\nDisabled: ${overview.providers.disabled}\nQuarantined: ${overview.providers.quarantined}\n\nCommand drafts: ${overview.commands.totalDrafts}\nCollisions: ${overview.commands.collisions}\nActive generated commands: ${overview.commands.active}\n\nExecutions: ${overview.execution.executions}\nSuccess: ${overview.execution.successes}\nFailed: ${overview.execution.failures}\nFallback: ${overview.execution.fallbacks}\n\nSandbox: ${host.sandbox.mode}\nSource execution: DISABLED BY DEFAULT`);
    }

    if (['contribution', 'contributions'].includes(section)) {
      const id = rest[0];
      if (['list', ''].includes(action)) {
        const items = await listContributions();
        return m.reply(items.length ? `*ACIE CONTRIBUTIONS · ${items.length}*\n\n${items.slice(0, 40).map(item => `${item.contributionId}\n${item.contributorId}/${item.name} · ${item.version}\n${item.language} · ${item.fileCount} files · ${item.capabilityCount} capabilities\nLicense: ${item.license}`).join('\n\n')}` : 'Contribution Vault masih kosong. Intake pertama dapat dilakukan melalui CLI VPS; lihat .acie help.');
      }
      if (['inspect', 'show'].includes(action)) {
        if (!id) return m.reply('Format: .acie contribution inspect <contribution-id>');
        const item = await findContribution(id);
        if (!item) return m.reply('Contribution tidak ditemukan.');
        const security = item.analysis?.security || {};
        return m.reply(`*CONTRIBUTION INSPECT*\nID: ${item.contributionId}\nNama: ${item.name}\nKontributor: ${item.contributorId}\nVersi: ${item.version}\nBahasa: ${item.manifest.languageDiscovery?.primaryLanguage || 'unknown'}\nRuntime: ${item.manifest.languageDiscovery?.runtime || 'unknown'}\nModule: ${item.manifest.languageDiscovery?.moduleSystem || 'unknown'}\nFile: ${item.manifest.originalFileCount}\nBytes: ${item.manifest.originalBytes}\nLicense: ${item.manifest.license}\nAttribution: ${item.manifest.attribution}\nIntegrity at intake: ${item.manifest.integrity}\nExecution: ${item.manifest.executionAuthorization}\nSecurity findings: ${security.findings?.length || 0}\nCritical: ${security.critical || 0} · High: ${security.high || 0}\nCapabilities:\n${(item.manifest.capabilities || []).map(summarizeCapability).join('\n') || '-'}\nDependencies:\n${(item.manifest.dependencies || []).slice(0, 25).map(dep => `${dep.name} ${dep.version} (${dep.manager})`).join('\n') || '-'}`);
      }
      if (['verify', 'integrity'].includes(action)) {
        if (!id) return m.reply('Format: .acie contribution verify <contribution-id>');
        const result = await verifyContribution(id);
        return m.reply(`Integrity: ${result.status.toUpperCase()}\nFile: ${result.actualFiles}/${result.expectedFiles}\nMismatch: ${result.mismatches.length}\n${result.mismatches.slice(0, 20).map(item => `${item.status}: ${item.path}`).join('\n') || 'SHA-256 semua file cocok.'}`);
      }
      if (['history', 'versions'].includes(action)) {
        if (!id) return m.reply('Format: .acie contribution history <contribution-id>');
        const item = await findContribution(id);
        if (!item) return m.reply('Contribution tidak ditemukan.');
        const versions = (await listContributionVersions()).filter(entry => entry.contributorId === item.contributorId && entry.name === item.name);
        return m.reply(`*VERSION HISTORY*\n${versions.map(entry => `${entry.version} · ${entry.receivedAt}\n${entry.contributionId}`).join('\n\n') || '-'}`);
      }
      if (['provenance', 'attribution'].includes(action)) {
        if (!id) return m.reply('Format: .acie contribution provenance <contribution-id>');
        const item = await findContribution(id);
        if (!item) return m.reply('Contribution tidak ditemukan.');
        const p = item.provenance || {};
        return m.reply(`*PROVENANCE*\nContribution: ${p.contributionId}\nContributor: ${p.contributorId}\nName: ${p.contributorName || 'PENDING'}\nProject: ${p.projectId}\nReceived: ${p.receivedAt}\nLicense: ${p.rights?.license || 'PENDING'}\nAttribution: ${p.rights?.attribution || 'PENDING'}\nRights status: ${p.rights?.status}\nPreservation: ${p.preservation?.method}\nSource executed: NO`);
      }
      return m.reply('Subcommand contribution: list, inspect, verify, history, provenance.');
    }

    if (['provider', 'providers'].includes(section)) {
      const id = rest[0];
      if (['list', ''].includes(action)) {
        const providers = await listProviders();
        return m.reply(providers.length ? `*ACIE PROVIDERS*\n\n${providers.map(item => `${item.providerId}\n${item.status} · ${item.language} · ${item.runtime}\nCapabilities: ${(item.capabilities || []).join(', ')}`).join('\n\n')}` : 'Belum ada provider terdaftar.');
      }
      if (action === 'inspect') {
        if (!id) return m.reply('Format: .acie provider inspect <provider-id>');
        const provider = await inspectProvider(id);
        return m.reply(provider ? clip(fmt(provider), 3500) : 'Provider tidak ditemukan.');
      }
      if (action === 'review') {
        const stage = rest[1];
        if (!id || !stage) return m.reply('Format: .acie provider review <provider-id> <license|attribution|sandbox|authorization>');
        try {
          const provider = await reviewProviderStage(id, stage, { actor: m.senderPn || m.sender });
          return m.reply(`Review ${stage} tercatat untuk ${provider.providerId}. Status provider tetap ${provider.status}; tahap validasi berikutnya belum otomatis dilewati.`);
        } catch (error) { return m.reply(`Review ditolak: ${error.message}`); }
      }
      if (action === 'test') {
        if (!id) return m.reply('Format: .acie provider test <provider-id> [capability-id]');
        try {
          const result = await testProviderAdapter(id, { actor: m.senderPn || m.sender, capability: rest[1] || null });
          return m.reply(`Adapter protocol test lulus.\nProvider: ${result.providerId}\nCapability: ${result.capability}\nOutput fields: ${result.outputFields.join(', ')}\nIntegrity: ${result.integrity}\nTrace: ${result.traceId}`);
        } catch (error) { return m.reply(`Adapter test gagal: ${error.message}`); }
      }
      if (action === 'disable' || action === 'enable') {
        if (!id) return m.reply(`Format: .acie provider ${action} <provider-id>`);
        try {
          const provider = await setProviderEnabled(id, action === 'enable', { actor: m.senderPn || m.sender });
          const loader = await import('../../core/plugin-loader.js');
          const sync = await loader.refreshGeneratedCommandPlugins();
          return m.reply(`Provider ${provider.providerId}: ${provider.status}. Generated command dimuat: ${sync.loaded}.`);
        } catch (error) { return m.reply(`Perubahan ditolak: ${error.message}`); }
      }
      if (['status', 'health', 'quota'].includes(action)) {
        const providers = await listProviders();
        return m.reply(providers.map(item => `${item.providerId} · ${item.health?.status || 'unknown'} · ${item.status} · quota ${item.health?.quotaStatus || 'not-reported'}`).join('\n') || 'Belum ada provider.');
      }
      return m.reply('Subcommand provider: list, inspect, status, health, enable, disable.');
    }

    if (section === 'adapter') {
      const id = rest[0];
      if (!id || !['review', 'test'].includes(action)) return m.reply('Format: .acie adapter review|test <provider-id> [capability-id]');
      try {
        if (action === 'review') {
          const provider = await reviewProviderStage(id, 'adapter', { actor: m.senderPn || m.sender });
          return m.reply(`Adapter descriptor ditinjau untuk ${provider.providerId}. Jalankan .acie provider review ${id} sandbox setelah runtime probe tersedia.`);
        }
        const result = await testProviderAdapter(id, { actor: m.senderPn || m.sender, capability: rest[1] || null });
        return m.reply(`Adapter protocol test lulus. Provider: ${result.providerId} · Capability: ${result.capability} · Trace: ${result.traceId}`);
      } catch (error) { return m.reply(`Adapter ${action} ditolak/gagal: ${error.message}`); }
    }

    if (['capabilities', 'capability'].includes(section)) {
      const capabilities = await listCapabilities();
      return m.reply(capabilities.length ? `*ACIE CAPABILITIES*\n${capabilities.map(item => `${item.id} · ${item.status}\nProviders: ${item.providers.join(', ')}`).join('\n\n')}` : 'Belum ada capability yang ditemukan.');
    }
    if (section === 'languages') {
      const items = await listContributions();
      const counts = new Map(); for (const item of items) counts.set(item.language, (counts.get(item.language) || 0) + 1);
      return m.reply(`*DISCOVERED LANGUAGES*\n${[...counts].map(([name, count]) => `${name}: ${count} contribution`).join('\n') || 'Belum ada bahasa terdeteksi.'}`);
    }
    if (section === 'runtime') {
      if (action === 'probe') {
        const result = await probeSandboxRuntime();
        return m.reply(`*ACIE SANDBOX PROBE*\nEngine: ${result.sandbox.engine || 'not configured'}\nConfigured: ${result.sandbox.configured ? 'yes' : 'no'}\nAvailable: ${result.sandbox.available ? 'yes' : 'no'}\nDigest-pinned images: ${result.sandbox.digestPinnedImages}\nReason: ${result.sandbox.probeReason || 'ready'}\nExecution: ${result.sandbox.executionEnabled ? 'eligible for further policy checks' : 'DENY'}`);
      }
      const result = inspectRuntimeHost();
      return m.reply(`*ACIE RUNTIME*\nNode: ${result.node}\nPlatform: ${result.platform}/${result.architecture}\nEngine: ${result.sandbox.engine || 'not configured'}\nConfigured: ${result.sandbox.configured ? 'yes' : 'no'}\nAvailable: ${result.sandbox.available ? 'yes' : 'no'}\nLast probe: ${result.sandbox.lastProbeAt || '-'}\nReason: ${result.sandbox.probeReason || '-'}`);
    }
    if (['workers', 'worker'].includes(section)) {
      const workers = listWorkers();
      return m.reply(`*ACIE WORKERS*\n${workers.map(item => `${item.role} · ${item.status}\nJobs: ${item.jobs} · Failures: ${item.failures}\nLast: ${item.lastRunAt || '-'}`).join('\n\n')}`);
    }
    if (['commands', 'command'].includes(section)) {
      const drafts = await listCommandDrafts();
      if (action === 'conflicts' || action === 'collision') {
        const conflicts = drafts.filter(item => item.collision?.detected && !item.collision?.resolved);
        const resolved = drafts.filter(item => item.collision?.detected && item.collision?.resolved);
        return m.reply(`*COMMAND COLLISION AUDIT*\nBelum terselesaikan: ${conflicts.length}\nOtomatis dinamespace: ${resolved.length}\n${[...conflicts, ...resolved].map(item => `${item.command} (preferred: ${item.preferredCommand || item.command}) · ${item.collision.resolved ? 'resolved' : 'blocked'} · ${item.collision.originalNames?.join(', ') || '-'}`).join('\n') || 'Tidak ada collision.'}`);
      }
      if (action === 'inspect') {
        const commandId = rest[0];
        const draft = drafts.find(item => item.commandId === commandId || item.command === commandId);
        return m.reply(draft ? clip(fmt(draft), 3200) : 'Command draft tidak ditemukan.');
      }
      if (action === 'test') {
        const commandId = rest[0];
        const draft = drafts.find(item => item.commandId === commandId || item.command === commandId);
        if (!draft) return m.reply('Command draft tidak ditemukan.');
        try {
          const result = await testProviderAdapter(draft.providerMapping, { actor: m.senderPn || m.sender, capability: draft.capability });
          return m.reply(`Protocol test command lulus.
Command: .${draft.command}
Capability: ${draft.capability}
Integrity: ${result.integrity}
Trace: ${result.traceId}`);
        } catch (error) { return m.reply(`Protocol test command gagal: ${error.message}`); }
      }
      if (action === 'sync') {
        const registrySync = await synchronizeCommandRegistries();
        const loader = await import('../../core/plugin-loader.js');
        const result = await loader.refreshGeneratedCommandPlugins();
        await writeGeneratedCommandCatalog(getACIEPaths().generatedCommands, await listCommandDrafts());
        return m.reply(`Generated command registry disinkronkan. Canonical: ${registrySync.canonicalCount} · Compatibility: ${registrySync.compatibilityCount} · Loaded: ${result.loaded} · Skipped: ${result.skipped}.`);
      }
      if (action === 'approve') {
        const commandId = rest[0];
        const permission = String(rest[1] || 'owner').toLowerCase();
        if (!commandId) return m.reply('Format: .acie commands approve <command-id> [public|owner]');
        try {
          const result = await approveCommandDraft(commandId, { actor: m.senderPn || m.sender, permission });
          return m.reply(`Command .${result.command.command} aktif dan tersinkron. Permission: ${permission}. Plugin loader memuat: ${result.sync.loaded}.`);
        } catch (error) { return m.reply(`Approval command ditolak: ${error.message}`); }
      }
      if (action === 'reject') {
        const commandId = rest[0];
        if (!commandId) return m.reply('Format: .acie commands reject <command-id> <reason>');
        try { const item = await rejectCommandDraft(commandId, { actor: m.senderPn || m.sender, reason: rest.slice(1).join(' ') || 'rejected-by-owner' }); return m.reply(`Command draft ${item.command} ditolak.`); }
        catch (error) { return m.reply(`Penolakan gagal: ${error.message}`); }
      }
      if (action === 'revoke') {
        const commandId = rest[0];
        if (!commandId) return m.reply('Format: .acie commands revoke <command-id>');
        try { const result = await revokeGeneratedCommand(commandId, { actor: m.senderPn || m.sender }); return m.reply(`Command ${result.command.command} dicabut. Generated plugins tersisa: ${result.sync.loaded}.`); }
        catch (error) { return m.reply(`Pencabutan gagal: ${error.message}`); }
      }
      const selected = drafts.slice(0, 50);
      return m.reply(selected.length ? `*GENERATED COMMAND REGISTRY*\n${selected.map(item => `${item.commandId}\n.${item.command} ${item.aliases.map(alias => `(${alias})`).join(' ')}\n${item.capability} · ${item.status} · permission ${item.permission}`).join('\n\n')}\n\nDraft tidak masuk menu sampai provider lolos gate, owner menyetujui permission, dan command diaktifkan.` : 'Belum ada command draft.');
    }
    if (['routing', 'route'].includes(section)) {
      if (!action || action === 'status') return m.reply(clip(fmt(getRoutingStats()), 3000));
      if (['inspect', 'simulate', 'priorities', 'fallback', 'history'].includes(action)) {
        const capability = rest[0];
        if (!capability) return m.reply(`Format: .acie routing ${action} <capability-id>`);
        const providers = await selectProviders(capability);
        return m.reply(`*ROUTING ${action.toUpperCase()}*\nCapability: ${capability}\nEligible providers: ${providers.length}\n${providers.map(item => `${item.providerId} · priority ${item.priority}`).join('\n') || 'Tidak ada provider yang aktif dan lolos security gate.'}`);
      }
    }
    if (['integrity', 'security', 'dependencies', 'compatibility'].includes(section)) {
      const contributions = await listContributions();
      const lines = [];
      for (const contribution of contributions.slice(0, 25)) {
        const full = await findContribution(contribution.contributionId);
        if (!full) continue;
        if (section === 'integrity') lines.push(`${full.contributionId}: ${(await verifyContribution(full.contributionId)).status}`);
        if (section === 'security') { const s = full.analysis?.security || {}; lines.push(`${full.contributionId}: critical ${s.critical || 0}, high ${s.high || 0}, medium ${s.medium || 0}, low ${s.low || 0}`); }
        if (section === 'dependencies') lines.push(`${full.contributionId}: ${(full.manifest.dependencies || []).map(item => `${item.name}@${item.version}`).join(', ') || 'none detected'}`);
        if (section === 'compatibility') lines.push(`${full.contributionId}: unverified; sandbox execution not configured`);
      }
      return m.reply(`*ACIE ${section.toUpperCase()}*\n${lines.join('\n') || 'Belum ada data kontribusi.'}`);
    }
    if (section === 'audit') {
      const limit = Math.max(1, Math.min(50, Number(action) || 20));
      const events = await readACIEAudit({ limit });
      return m.reply(events.length ? `*ACIE AUDIT · ${events.length}*\n${events.map(item => `${item.at} · ${item.event}\n${clip(fmt(item.details), 300)}`).join('\n\n')}` : 'Audit log masih kosong.');
    }
    return m.reply(usage);
  }
};
