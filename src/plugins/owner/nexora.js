import { updateConfig, getConfig } from '../../core/config.js';
import { getAICapabilityStatus } from '../../ai/capability-manager.js';
import { getWebsiteBuildQueueStatus } from '../../ai/website-project.js';
import { getCodeLabStatus, startCodeLab, stopCodeLab, rescheduleCodeWorkers } from '../../runtime/code-lab.js';
import { runNexoraBootstrap } from '../../runtime/bootstrap-agent.js';

const onOff = value => ['on', 'off'].includes(String(value || '').toLowerCase());

function statusText() {
  const config = getConfig();
  const lab = getCodeLabStatus();
  const capabilities = getAICapabilityStatus();
  const builderQueue = getWebsiteBuildQueueStatus();
  return [
    '*NEXORA · GLOBAL CAPABILITY CONTROL*',
    `AI chat engine: ${config.ai.enabled ? 'ON' : 'OFF'}`,
    `Code Lab: ${config.codeLab.enabled ? 'ON' : 'OFF'}`,
    `AI auto-run: ${config.codeLab.aiExecutionEnabled ? 'ON' : 'OFF'}`,
    `Public preview tunnel: ${config.codeLab.publicTunnelEnabled ? 'ON' : 'OFF'}`,
    `Website Builder: ${config.codeLab.websiteBuilderEnabled ? 'ON' : 'OFF'}`,
    `Website Builder jobs: ${builderQueue.active}/${config.codeLab.websiteBuilderConcurrency} active · ${builderQueue.queued}/${config.codeLab.websiteBuilderQueueLimit} queued`,
    `Gateway: ${lab.gateway}`,
    `TryCloudflare: ${lab.tunnel}`,
    `cloudflared: ${lab.cloudflaredVersion || 'not verified'}`,
    `Container runtime: ${lab.runtimeReady ? 'READY' : 'NOT READY'}`,
    ...(lab.runtimeError ? [`Runtime detail: ${lab.runtimeError.slice(0, 240)}`] : []),
    ...(lab.tunnelError ? [`Tunnel detail: ${lab.tunnelError.slice(0, 240)}`] : []),
    `Workers: ${lab.activeWorkers}/${lab.maxConcurrent} running · ${lab.queued} queued`,
    `Live sessions: ${lab.activeSessions}/${lab.maxSessionsTotal} (websites ${lab.activeWebsiteSessions || 0})`,
    `Session reservations: ${lab.pendingReservations}`,
    `Sessions per user: ${config.codeLab.maxSessionsPerUser}`,
    `Session TTL: ${Math.round(lab.ttlMs / 60000)} minutes`,
    `Tunnel process: shared on-demand · idle shutdown ${Math.round((lab.tunnelIdleMs ?? 300000) / 60000)} min · PID ${lab.tunnelPid || 'none'} · generation ${lab.tunnelGeneration}`,
    `Preview HTTP load: ${lab.activeHttpRequests}/${lab.maxInFlightRequests} in-flight · retry cooldown ${lab.tunnelRetryInSeconds || 0}s`,
    '',
    '*REGISTERED CAPABILITIES*',
    ...capabilities.map(item => `• ${item.label}: ${item.enabled ? 'ENABLED' : 'DISABLED'}`),
    '',
    '*OWNER COMMANDS*',
    '.nexora all on/off · activate/deactivate all Nexora features',
    '.nexora code on/off · execution service',
    '.nexora auto-run on/off · natural-language execution and website auto-preview',
    '.nexora builder on/off · multi-file static website generator',
    '.nexora builder-workers 1-4 · simultaneous website generations',
    '.nexora tunnel on/off · one shared public tunnel',
    '.nexora workers 1-4 · simultaneous running jobs',
    '.nexora runtime docker/podman',
    '.nexora status'
  ].join('\n');
}

export default {
  name: 'nexora', aliases: ['capability', 'aitools'], category: 'owner', ownerOnly: true, privateOnly: true,
  description: 'Manage all Nexora capabilities and the global isolated Code Lab service',
  async execute({ m, args }) {
    const [action = 'status', value] = args;
    const command = String(action).toLowerCase();
    if (['status', 'help'].includes(command)) return m.reply(statusText());

    if (command === 'all') {
      if (!onOff(value)) return m.reply('Gunakan: .nexora all on atau .nexora all off');
      const enabled = String(value).toLowerCase() === 'on';
      await updateConfig(config => {
        config.ai.enabled = enabled;
        config.codeLab.enabled = enabled;
        config.codeLab.aiExecutionEnabled = enabled;
        config.codeLab.publicTunnelEnabled = enabled;
        config.codeLab.websiteBuilderEnabled = enabled;
      }, { actor: m.sender, reason: `Nexora all capabilities ${value}` });
      if (enabled) {
        try {
          await runNexoraBootstrap(getConfig().codeLab);
          const status = await startCodeLab();
          if (status.tunnel === 'error') {
            return m.reply(`Semua fitur Nexora diset ON, tetapi preview publik belum siap. Periksa cloudflared melalui .nexora status. ${status.tunnelError || ''}`.trim());
          }
          if (!status.runtimeReady) {
            return m.reply(`Semua fitur Nexora dan tunnel publik sudah ON. Namun Python/Node belum dapat dijalankan karena container runtime belum siap. HTML dan Website Builder statis tetap dapat digunakan. Detail: ${status.runtimeError || 'periksa Docker/Podman dan image runtime'}`);
          }
        } catch (error) {
          return m.reply(`Pengaturan semua fitur Nexora sudah ON, tetapi Code Lab gagal diinisialisasi: ${error.message}`);
        }
      } else {
        await stopCodeLab();
      }
      return m.reply(`Semua fitur Nexora global: ${enabled ? 'ON' : 'OFF'}. Kebijakan ini berlaku untuk seluruh pengguna Ocha Lidya.`);
    }

    if (command === 'builder-workers') {
      const workers = Number(value);
      if (!Number.isInteger(workers) || workers < 1 || workers > 4) return m.reply('Website Builder workers harus 1 sampai 4. Ini membatasi generasi website bersamaan, bukan Code Lab execution workers.');
      await updateConfig(config => { config.codeLab.websiteBuilderConcurrency = workers; }, { actor: m.sender, reason: `Nexora website builder concurrency ${workers}` });
      return m.reply(`Batas generasi website global diatur ke ${workers}. Permintaan berikutnya mengikuti antrean FIFO yang dibatasi.`);
    }

    if (['code', 'auto-run', 'tunnel', 'builder'].includes(command)) {
      if (!onOff(value)) return m.reply('Gunakan: .nexora code on/off | auto-run on/off | tunnel on/off | builder on/off');
      const enabled = String(value).toLowerCase() === 'on';
      if (command === 'builder') {
        await updateConfig(config => { config.codeLab.websiteBuilderEnabled = enabled; }, { actor: m.sender, reason: `Nexora website builder ${value}` });
      } else if (command === 'code') {
        await updateConfig(config => { config.codeLab.enabled = enabled; }, { actor: m.sender, reason: `Nexora Code Lab ${value}` });
        if (enabled) {
          try {
            await runNexoraBootstrap(getConfig().codeLab);
            const status = await startCodeLab();
            if (!status.runtimeReady) return m.reply(`Code Lab aktif, tetapi eksekusi Python/Node belum siap. Periksa Docker/Podman dan image runtime melalui .nexora status. ${status.runtimeError || ''}`.trim());
          } catch (error) { return m.reply(`Code Lab tersimpan ON, tetapi startup gagal: ${error.message}`); }
        } else await stopCodeLab();
      } else if (command === 'auto-run') {
        await updateConfig(config => { config.codeLab.aiExecutionEnabled = enabled; }, { actor: m.sender, reason: `Nexora auto code execution ${value}` });
      } else {
        await updateConfig(config => { config.codeLab.publicTunnelEnabled = enabled; }, { actor: m.sender, reason: `Nexora on-demand public tunnel ${value}` });
        if (enabled && getConfig().codeLab.enabled) {
          try { await runNexoraBootstrap(getConfig().codeLab); await startCodeLab(); }
          catch (error) { return m.reply(`Tunnel diset ON, tetapi gagal dimulai: ${error.message}`); }
        } else if (!enabled) {
          // A public URL cannot remain available without the tunnel. Revoke sessions,
          // stop workers and close the shared tunnel as one atomic feature shutdown.
          await stopCodeLab();
        }
      }
      return m.reply(`Nexora ${command}: ${enabled ? 'ON' : 'OFF'}. Pengaturan berlaku global untuk semua pengguna.`);
    }

    if (command === 'runtime') {
      const runtime = String(value || '').toLowerCase();
      if (!['docker', 'podman'].includes(runtime)) return m.reply('Runtime hanya boleh docker atau podman. Contoh: .nexora runtime podman');
      const current = getCodeLabStatus();
      if (current.activeSessions || current.activeWorkers || current.queued) return m.reply('Runtime tidak dapat diganti saat ada sesi/worker aktif. Hentikan Code Lab dahulu.');
      await stopCodeLab();
      await updateConfig(config => { config.codeLab.containerRuntime = runtime; }, { actor: m.sender, reason: `Nexora container runtime ${runtime}` });
      if (getConfig().codeLab.enabled) {
        try { await runNexoraBootstrap(getConfig().codeLab); await startCodeLab(); }
        catch (error) { return m.reply(`Runtime disimpan sebagai ${runtime}, tetapi Code Lab belum siap: ${error.message}`); }
      }
      return m.reply(`Container runtime diubah menjadi ${runtime}.`);
    }

    if (command === 'workers') {
      const workers = Number(value);
      if (!Number.isInteger(workers) || workers < 1 || workers > 4) return m.reply('Jumlah worker harus 1 sampai 4. Worker adalah jumlah program yang berjalan bersamaan, bukan jumlah sesi. Contoh: .nexora workers 2');
      await updateConfig(config => { config.codeLab.maxConcurrent = workers; }, { actor: m.sender, reason: `Nexora worker concurrency ${workers}` });
      rescheduleCodeWorkers();
      return m.reply(`Batas worker global diatur ke ${workers}. Maksimal ${workers} program berjalan bersamaan; permintaan berikutnya mengantre. Batas sesi tetap terpisah.`);
    }

    return m.reply('Subcommand tidak dikenal. Gunakan .nexora status atau .nexora all on/off.');
  }
};
