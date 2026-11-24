/** Customer-facing order lookup helpers. Never return an order across requester or group boundaries. */
function normalizeJid(value) {
  return String(value || '').trim().replace(/:\d+(?=@)/, '').toLowerCase();
}

export function isCustomerOrder(order, groupJid, requesterJid) {
  if (!order || !groupJid || !requesterJid) return false;
  return String(order.groupJid || '').trim() === String(groupJid).trim()
    && normalizeJid(order.requestedBy) === normalizeJid(requesterJid);
}

export function listCustomerOrders(orders, groupJid, requesterJid, limit = 10) {
  if (!Array.isArray(orders) || !groupJid || !requesterJid) return [];
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(20, limit)) : 10;
  return orders
    .filter(order => isCustomerOrder(order, groupJid, requesterJid))
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
    .slice(0, safeLimit);
}

export function customerVisibleOrderStatus(order, now = Date.now()) {
  if (!order) return 'not_found';
  const status = String(order.status || '').toLowerCase();
  if (['pending', 'payment_reported'].includes(status) && Number.isFinite(Date.parse(order.expiresAt)) && Date.parse(order.expiresAt) <= now) {
    return 'expired';
  }
  return ['pending', 'payment_reported', 'approved', 'rejected', 'cancelled', 'expired'].includes(status)
    ? status
    : 'unknown';
}
