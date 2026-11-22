export const PAYMENT_METHODS = Object.freeze({
  qris: { id: 'qris', name: 'QRIS', kind: 'static-qris', receiver: 'RAZZAQ VENTURES', note: 'Scan QRIS dan masukkan nominal sesuai invoice.' },
  ovo: { id: 'ovo', name: 'OVO', kind: 'ewallet', receiver: 'ARIFI RAZZAQ', account: '083193905842' },
  gopay: { id: 'gopay', name: 'GoPay', kind: 'ewallet', receiver: 'ARIFI RAZZAQ', account: '083193905842' },
  dana: { id: 'dana', name: 'DANA', kind: 'ewallet', receiver: 'ARIFI RAZZAQ', account: '083193905842' },
  seabank: { id: 'seabank', name: 'SeaBank', kind: 'bank', receiver: 'ARIFI RAZZAQ', account: '901250543509' }
});

export function normalizePaymentMethod(value) {
  const method = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return Object.hasOwn(PAYMENT_METHODS, method) ? method : '';
}
