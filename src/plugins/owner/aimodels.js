import { getModelCatalogStatus, triggerModelCatalogRefresh, MODEL_ACCESS_POLICY } from '../../ai/model-catalog.js';

const formatTime = value => value ? new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : 'belum tersedia';
const accessLabel = policy => policy.freeModels.length ? 'FREE TIER TERDOKUMENTASI' : 'BERBAYAR / TIDAK ADA FREE INFERENCE YANG TERDOKUMENTASI';

function render(snapshot) {
  const rows = Object.keys(MODEL_ACCESS_POLICY).map(provider => {
    const state = snapshot.providers?.[provider] || {};
    const policy = MODEL_ACCESS_POLICY[provider];
    const models = (state.models || []).filter(model => model.supportsChat !== false).slice(0, 8).map(model => model.id);
    return [
      `${provider.toUpperCase()} — ${accessLabel(policy)}`,
      `  Katalog API: ${state.status || 'belum diperiksa'}${state.stale ? ' (cache lama)' : ''} · model terdaftar ${state.modelCount || 0}`,
      `  Model gratis yang cocok: ${(state.freeEligibleModels || []).join(', ') || 'tidak ada / belum terverifikasi'}`,
      `  Rekomendasi free: ${state.recommendedFreeModel || '-'}`,
      `  Rekomendasi paid: ${state.recommendedPaidModel || '-'}`,
      `  Model chat baru/belum diklasifikasikan: ${(state.unclassifiedChatModels || []).slice(0, 5).join(', ') || '-'}`,
      `  Sample katalog: ${models.join(', ') || '-'}`,
      state.error?.message ? `  Error: ${String(state.error.message).slice(0, 160)}` : ''
    ].filter(Boolean).join('\n');
  });
  return [
    '*NEXORA — MODEL CATALOG*',
    `Terakhir diperiksa: ${formatTime(snapshot.checkedAt)}`,
    `Jadwal berikutnya: ${formatTime(snapshot.scheduler?.nextRunAt || snapshot.nextCheckAt)} (setiap 24 jam)`,
    `Scheduler: ${snapshot.scheduler?.active ? 'ACTIVE' : 'INACTIVE'} (${snapshot.scheduler?.mode || 'belum diketahui'})`,
    `Detached worker: ${snapshot.scheduler?.workerActive ? `ACTIVE · PID ${snapshot.scheduler.workerPid}` : 'INACTIVE'} · heartbeat ${formatTime(snapshot.scheduler?.workerHeartbeatAt)}`,
    'Sumber: endpoint katalog resmi provider + daftar free-tier yang diverifikasi dari dokumentasi resmi.',
    'Catatan: katalog 200 OK membuktikan API key dapat membaca daftar model, bukan menjamin kuota inferensi masih tersedia.',
    '', ...rows,
    '', 'Gunakan `.aimodels refresh` untuk pemeriksaan sekarang.'
  ].join('\n');
}

export default {
  name: 'aimodels', aliases: ['modelcatalog', 'modelcheck'], category: 'owner', ownerOnly: true,
  description: 'Audit katalog model resmi, rekomendasi gratis/berbayar, dan jadwal pembaruan',
  async execute({ m, args }) {
    const action = String(args?.[0] || 'status').toLowerCase();
    if (!['status', 'refresh'].includes(action)) return m.reply('Gunakan: .aimodels status atau .aimodels refresh');
    try {
      const snapshot = action === 'refresh'
        ? await triggerModelCatalogRefresh('owner-manual-refresh')
        : await getModelCatalogStatus();
      return m.reply(render(snapshot));
    } catch (error) {
      return m.reply(`Pemeriksaan katalog gagal: ${String(error?.message || error).slice(0, 240)}\nSnapshot terakhir tidak sengaja dihapus.`);
    }
  }
};
