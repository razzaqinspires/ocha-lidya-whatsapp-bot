export const DEFAULT_PLANS = Object.freeze({
  mini: {
    id: 'mini', name: 'Mini', price: 5000, durationDays: 30,
    dailyQuota: 120, maxGroups: 1, graceHours: 48,
    highlights: ['Semua command tersedia', 'Kuota bersama 120 unit / 24 jam', 'Masa aktif 30 hari', 'Pengingat masa aktif']
  },
  standard: {
    id: 'standard', name: 'Standard', price: 10000, durationDays: 30,
    dailyQuota: 350, maxGroups: 1, graceHours: 48,
    highlights: ['Semua command tersedia', 'Kuota bersama 350 unit / 24 jam', 'Masa aktif 30 hari', 'Prioritas antrean standar']
  },
  pro: {
    id: 'pro', name: 'Pro', price: 20000, durationDays: 30,
    dailyQuota: 1000, maxGroups: 1, graceHours: 48,
    highlights: ['Semua command tersedia', 'Kuota bersama 1.000 unit / 24 jam', 'Masa aktif 30 hari', 'Prioritas antrean lebih tinggi']
  }
});

export const BILLING_EXEMPT_COMMANDS = new Set([
  'sewa', 'rent', 'paket', 'bayar', 'owner', 'menu', 'ping', 'about', 'groupinfo'
]);

export function normalizePlanId(value) {
  const input = String(value || '').trim().toLowerCase();
  if (['mini', 'hemat', 'basic', 'starter'].includes(input)) return 'mini';
  if (['standard', 'standar', 'reguler', 'regular'].includes(input)) return 'standard';
  if (['pro', 'premium', 'plus'].includes(input)) return 'pro';
  return '';
}

export function formatRupiah(value) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
}
