import test from 'node:test';
import assert from 'node:assert/strict';
import { customerVisibleOrderStatus, isCustomerOrder, listCustomerOrders } from '../src/rental/customer-portal.js';

const ownOlder = { id: 'RV-OLDER', groupJid: '123456789@g.us', requestedBy: '628123456789@s.whatsapp.net', createdAt: '2026-11-20T10:00:00.000Z', status: 'pending', expiresAt: '2026-11-24T10:00:00.000Z' };
const ownNewer = { ...ownOlder, id: 'RV-NEWER', createdAt: '2026-11-21T10:00:00.000Z' };
const anotherCustomer = { ...ownNewer, id: 'RV-OTHER-CUSTOMER', requestedBy: '628987654321@s.whatsapp.net' };
const anotherGroup = { ...ownNewer, id: 'RV-OTHER-GROUP', groupJid: '987654321@g.us' };

test('customer portal only matches the originating requester and selected group', () => {
  assert.equal(isCustomerOrder(ownOlder, '123456789@g.us', '628123456789:7@s.whatsapp.net'), true);
  assert.equal(isCustomerOrder(anotherCustomer, '123456789@g.us', '628123456789@s.whatsapp.net'), false);
  assert.equal(isCustomerOrder(anotherGroup, '123456789@g.us', '628123456789@s.whatsapp.net'), false);
});

test('customer order history is newest-first and never crosses tenant or requester scope', () => {
  const history = listCustomerOrders([ownOlder, anotherCustomer, anotherGroup, ownNewer], '123456789@g.us', '628123456789@s.whatsapp.net', 10);
  assert.deepEqual(history.map(item => item.id), ['RV-NEWER', 'RV-OLDER']);
});

test('customer-visible invoice status accounts for expiry without mutating the order', () => {
  assert.equal(customerVisibleOrderStatus(ownOlder, Date.parse('2026-11-24T11:00:00.000Z')), 'expired');
  assert.equal(customerVisibleOrderStatus({ ...ownOlder, status: 'payment_reported' }, Date.parse('2026-11-24T09:00:00.000Z')), 'payment_reported');
  assert.equal(customerVisibleOrderStatus({ ...ownOlder, status: 'approved' }, Date.parse('2026-11-25T09:00:00.000Z')), 'approved');
});
