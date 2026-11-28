import {
  getConsciousnessStatus,
  startConsciousnessRuntime,
  setConsciousnessEnabled,
  tickConsciousnessNow,
  consolidateConsciousnessMemory,
  verifyConsciousnessMemory,
  readConsciousnessStatus,
} from '../../runtime/consciousness-runtime.js';

function formatStatus(status) {
  const s = status.state || {};
  const pulse = s.nadi || {};
  const intero = s.intero || {};
  const neuro = s.neuro || {};
  const diri = s.diri || {};
  const affect = s.affect || {};
  const mood = affect.mood_profile || {};
  const metrics = s.metrics || {};
  const heartbeat = status.heartbeat || s.heartbeat || {};
  return [
    '╭─ OCHA NADI · EXTERNAL OPERATIONAL STATE ──',
    `│ Runtime       : ${status.ready ? 'READY' : status.running ? 'STARTING' : 'OFFLINE'}`,
    `│ Heartbeat     : ${status.enabled ? 'ON' : 'OFF'} · ${status.heartbeatMs} ms`,
    `│ Component     : ${status.componentVersion || 'not installed'} · ${status.componentSource || 'unknown source'}`,
    `│ Last beat     : ${heartbeat.last_beat_at || status.lastBeatAt || 'not yet'}`,
    `│ Ticks         : ${Number(heartbeat.ticks || metrics.total_ticks || status.heartbeatCount || 0)}`,
    `│ API           : ${status.baseUrl || 'not connected'}`,
    '├─ INTERNAL STATE',
    `│ Pulse         : ${Number(pulse.bpm || 0).toFixed(1)} bpm`,
    `│ Coherence     : ${Number(pulse.coherence || 0).toFixed(3)}`,
    `│ Energy        : ${Number(intero.energy || 0).toFixed(3)}`,
    `│ Thermal load  : ${Number(intero.thermal_load || 0).toFixed(3)}`,
    `│ Allostatic    : ${Number(intero.allostatic_load || 0).toFixed(3)}`,
    `│ Dopamine      : ${Number(neuro.dopamine || 0).toFixed(3)}`,
    `│ Serotonin     : ${Number(neuro.serotonin || 0).toFixed(3)}`,
    `│ Agency metric : ${Number(diri.agency_score || 0).toFixed(3)}`,
    `│ Error         : ${status.lastError || heartbeat.last_error || 'none'}`,
    '├─ BOUNDARIES',
    '│ Synthetic operational model; not sentience or subjective feeling.',
    '│ No random group outreach or repeated messages to silent users.',
    '╰────────────────────────────────────────',
  ].join('\n');
}

export default {
  name: 'nadi',
  aliases: ['heartbeat', 'selfstate'],
  category: 'owner',
  description: 'Kontrol NADI external component dan operational self-state Ocha',
  usage: '.nadi <status|on|off|pulse|sleep|verify>',
  ownerOnly: true,
  privateOnly: true,
  async execute({ m, args = [] }) {
    const action = String(args[0] || 'status').toLowerCase();
    if (action === 'status') {
      try {
        const live = getConsciousnessStatus();
        if (live.ready) {
          const result = await readConsciousnessStatus();
          return m.reply(formatStatus({ ...getConsciousnessStatus(), state: result }));
        }
        return m.reply(
          `${formatStatus(live)}\n\nKonfigurasi source NADI: source GitHub NADI sudah dikonfigurasi; jalankan ulang bot atau periksa konfigurasi OCHA_NADI_REF jika perlu mengganti versi.`,
        );
      } catch (error) {
        return m.reply(`NADI status tidak tersedia: ${error.message}`);
      }
    }
    if (['on', 'start', 'enable'].includes(action)) {
      const started = await startConsciousnessRuntime();
      if (!started.ready) {
        return m.reply(
          `NADI belum siap: ${started.lastError || 'external component offline'}. AI utama dan fungsi WhatsApp tetap berjalan.`,
        );
      }
      try {
        await setConsciousnessEnabled(true);
        return m.reply('NADI heartbeat diaktifkan. Komponen berjalan terpisah dan Ocha terhubung melalui HTTP lokal.');
      } catch (error) {
        return m.reply(`NADI gagal diaktifkan: ${error.message}`);
      }
    }
    if (['off', 'stop', 'disable'].includes(action)) {
      try {
        await setConsciousnessEnabled(false);
        return m.reply('NADI heartbeat dijeda. State terakhir tetap tersimpan; gunakan .nadi on untuk melanjutkan.');
      } catch (error) {
        return m.reply(`NADI gagal dijeda: ${error.message}`);
      }
    }
    if (['pulse', 'tick'].includes(action)) {
      try {
        const result = await tickConsciousnessNow();
        const tick = result.tick ?? result.metrics?.total_ticks ?? getConsciousnessStatus().heartbeatCount;
        return m.reply(
          `NADI pulse tercatat. Tick #${tick}; ${Number(result.pulse?.bpm || 0).toFixed(1)} bpm; coherence ${Number(result.pulse?.coherence || 0).toFixed(3)}.`,
        );
      } catch (error) {
        return m.reply(`Pulse gagal: ${error.message}`);
      }
    }
    if (action === 'sleep') {
      try {
        const result = await consolidateConsciousnessMemory();
        return m.reply(`Konsolidasi memori internal: ${result.status || 'selesai'}.`);
      } catch (error) {
        return m.reply(`Konsolidasi gagal: ${error.message}`);
      }
    }
    if (action === 'verify') {
      try {
        const result = await verifyConsciousnessMemory();
        return m.reply(`NADI memory chain: ${result.valid ? 'VALID' : 'INVALID'}\n${result.detail}`);
      } catch (error) {
        return m.reply(`Verifikasi gagal: ${error.message}`);
      }
    }
    return m.reply('NADI CONTROL\n.nadi status\n.nadi on\n.nadi off\n.nadi pulse\n.nadi sleep\n.nadi verify');
  },
};
