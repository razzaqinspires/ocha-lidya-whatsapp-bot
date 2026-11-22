import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_FLOW_REGISTRY, normalizeNativeFlowButton } from '../src/lib/native-flow-registry.js';

const fixtures = [
  ['quick_reply', { display_text: 'Quick Reply', id: 'test:quick' }],
  ['single_select', { title: 'Choose', sections: [{ title: 'Section', rows: [{ id: 'a', title: 'Option A' }] }] }],
  ['cta_url', { display_text: 'Open URL', url: 'https://example.com', merchant_url: 'https://example.com', webview_interaction: true }],
  ['cta_call', { display_text: 'Call', phone_number: '6281234567890' }],
  ['cta_copy', { display_text: 'Copy', copy_code: 'OCHA-01' }],
  ['send_location', { display_text: 'Send location' }],
  ['cta_reminder', { display_text: 'Reminder', id: 'remind:1' }],
  ['cta_cancel_reminder', { display_text: 'Cancel reminder', id: 'remind:1' }],
  ['galaxy_message', { flow_message_version: '3', flow_token: 'token', flow_id: '123456', flow_cta: 'Open', flow_action: 'navigate', flow_action_payload: { screen: 'HOME' } }],
  ['cta_catalog', { business_phone_number: '6281234567890', catalog_product_id: 'SKU-01' }],
  ['address_message', { display_text: 'Address', id: 'address:1', country: 'ID', values: { name: 'Test' } }],
  ['voice_call', { display_text: 'Voice call', ttl_minutes: 10 }],
  ['call_permission_request', { has_multiple_buttons: true }],
  ['mpm', { product_list_info: { title: 'Catalog', product_sections: [] } }],
  ['review_and_pay', { currency: 'IDR', total_amount: { value: 500000, offset: 100 }, reference_id: 'INV-1', order: { status: 'pending', items: [] } }],
  ['order_details', { reference_id: 'ORD-1', order: { status: 'pending', items: [] } }],
  ['payment_info', { currency: 'IDR', total_amount: { value: 500000, offset: 100 }, reference_id: 'PAY-1', order: { status: 'pending', items: [] } }]
];

test('native-flow registry keeps all observed sample button types losslessly', () => {
  for (const [name, params] of fixtures) {
    const normalized = normalizeNativeFlowButton({ name, buttonParamsJson: JSON.stringify(params) });
    assert.equal(normalized.name, name);
    assert.deepEqual(JSON.parse(normalized.buttonParamsJson), params);
    assert.equal(normalized.tier, NATIVE_FLOW_REGISTRY[name].tier);
  }
});

test('native-flow serializer refuses unknown types instead of silently changing them to quick_reply', () => {
  assert.throws(() => normalizeNativeFlowButton({ name: 'made_up_flow', buttonParamsJson: '{}' }), /belum terdaftar/);
});

test('single-select and URL parameters are validated before relay', () => {
  assert.throws(() => normalizeNativeFlowButton({ name: 'single_select', buttonParamsJson: JSON.stringify({ title: 'Empty', sections: [] }) }), /sections yang tidak kosong/);
  assert.throws(() => normalizeNativeFlowButton({ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Open', url: 'javascript:alert(1)' }) }), /HTTP atau HTTPS/);
});
