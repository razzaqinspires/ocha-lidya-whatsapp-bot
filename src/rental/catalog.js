export const DEFAULT_PLANS = Object.freeze({
  mini: {
    id: 'mini', name: 'Mini', price: 5000, durationDays: 30,
    dailyQuota: 120, maxMembers: 50, graceHours: 48,
    highlights: [
      '1 grup WhatsApp', 'Maksimal 50 anggota grup',
      'Semua anggota dapat menggunakan fitur bot',
      'Kuota bersama 120 unit per 24 jam',
      'Panel admin grup: aturan, sambutan anggota baru, dan polling',
      'Masa aktif 30 hari dan pengingat perpanjangan'
    ]
  },
  standard: {
    id: 'standard', name: 'Standard', price: 10000, durationDays: 30,
    dailyQuota: 350, maxMembers: 200, graceHours: 48,
    highlights: [
      '1 grup WhatsApp', 'Maksimal 200 anggota grup',
      'Semua anggota dapat menggunakan fitur bot',
      'Kuota bersama 350 unit per 24 jam',
      'Panel admin grup: aturan, sambutan anggota baru, dan polling',
      'Masa aktif 30 hari dan pengingat perpanjangan'
    ]
  },
  pro: {
    id: 'pro', name: 'Pro', price: 20000, durationDays: 30,
    dailyQuota: 1000, maxMembers: 1000, graceHours: 48,
    highlights: [
      '1 grup WhatsApp', 'Maksimal 1.000 anggota grup',
      'Semua anggota dapat menggunakan fitur bot',
      'Kuota bersama 1.000 unit per 24 jam',
      'Panel admin grup: aturan, sambutan anggota baru, dan polling',
      'Masa aktif 30 hari dan pengingat perpanjangan'
    ]
  }
});

export const BILLING_EXEMPT_COMMANDS = new Set([
  'sewa', 'rent', 'paketsewa', 'paket', 'bayar', 'owner', 'menu', 'ping', 'about', 'groupinfo', 'kernel'
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
