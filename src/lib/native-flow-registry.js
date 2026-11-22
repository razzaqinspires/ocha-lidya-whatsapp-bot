/**
 * Native-flow allowlist and lossless parameter normalization.
 * The registry describes support confidence, not a promise that every client renders each type.
 */
export const NATIVE_FLOW_REGISTRY = Object.freeze({
  quick_reply: { tier: 'stable', required: ['display_text', 'id'] },
  single_select: { tier: 'stable', required: ['title', 'sections'] },
  cta_url: { tier: 'stable', required: ['display_text', 'url'] },
  cta_copy: { tier: 'stable', required: ['display_text', 'copy_code'] },
  cta_call: { tier: 'stable', required: ['display_text', 'phone_number'] },
  send_location: { tier: 'observed', required: [] },
  cta_reminder: { tier: 'observed', required: [] },
  cta_cancel_reminder: { tier: 'observed', required: [] },
  address_message: { tier: 'observed', required: [] },
  cta_catalog: { tier: 'observed', required: [] },
  galaxy_message: { tier: 'experimental', required: ['flow_message_version', 'flow_token', 'flow_id', 'flow_cta', 'flow_action'] },
  voice_call: { tier: 'experimental', required: ['display_text'] },
  call_permission_request: { tier: 'experimental', required: ['has_multiple_buttons'] },
  mpm: { tier: 'experimental', required: ['product_list_info'] },
  review_and_pay: { tier: 'experimental', required: ['currency', 'total_amount', 'reference_id', 'order'] },
  order_details: { tier: 'experimental', required: ['reference_id', 'order'] },
  payment_info: { tier: 'experimental', required: ['currency', 'total_amount', 'reference_id', 'order'] }
});

function parseParams(button) {
  const raw = button?.buttonParamsJson ?? button?.params ?? {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); }
    catch { throw new TypeError(`buttonParamsJson untuk ${button?.name || button?.type || 'button'} bukan JSON valid.`); }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('buttonParamsJson harus berupa object atau JSON object.');
  return structuredClone(raw);
}

export function normalizeNativeFlowButton(button, index = 0) {
  if (!button || typeof button !== 'object') throw new TypeError(`Native-flow button #${index + 1} tidak valid.`);
  let name = String(button.name || button.type || 'quick_reply').trim().toLowerCase();
  if (['url', 'open_webview'].includes(name)) name = 'cta_url';
  if (['list'].includes(name)) name = 'single_select';
  if (['call'].includes(name)) name = 'cta_call';
  if (['copy'].includes(name)) name = 'cta_copy';
  const spec = NATIVE_FLOW_REGISTRY[name];
  if (!spec) throw new TypeError(`Native-flow type "${name}" belum terdaftar. Tidak akan diubah diam-diam menjadi quick_reply.`);

  let params;
  const hasExplicitJson = button.buttonParamsJson !== undefined || button.params !== undefined;
  if (hasExplicitJson) params = parseParams(button);
  else {
    params = { ...(button.options || {}) };
    if (button.title !== undefined && params.display_text === undefined) params.display_text = button.title;
    if (button.display_text !== undefined) params.display_text = button.display_text;
    if (button.id !== undefined) params.id = button.id;
    if (button.url !== undefined) params.url = button.url;
    if (button.link !== undefined) params.url = button.link;
    if (button.merchant_url !== undefined) params.merchant_url = button.merchant_url;
    if (button.copy_code !== undefined) params.copy_code = button.copy_code;
    if (button.phone_number !== undefined) params.phone_number = button.phone_number;
    if (button.sections !== undefined) params.sections = button.sections;
    if (button.title !== undefined && name === 'single_select') params.title = button.title;
  }

  for (const field of spec.required) {
    if (params[field] === undefined || params[field] === null || params[field] === '') {
      throw new TypeError(`Native-flow ${name} memerlukan field "${field}".`);
    }
  }
  if (name === 'single_select') {
    if (!Array.isArray(params.sections) || !params.sections.length) throw new TypeError('single_select memerlukan sections yang tidak kosong.');
    for (const section of params.sections) {
      if (!Array.isArray(section?.rows) || !section.rows.length) throw new TypeError('Setiap section single_select harus memiliki rows.');
      for (const row of section.rows) if (!row?.id || !row?.title) throw new TypeError('Setiap row single_select memerlukan id dan title.');
    }
  }
  if (name === 'cta_url') {
    try { const url = new URL(params.url); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
    catch { throw new TypeError('cta_url hanya menerima URL HTTP atau HTTPS yang valid.'); }
  }
  // Preserve every vendor/client-specific field. Do not reconstruct experimental payloads.
  return { name, buttonParamsJson: JSON.stringify(params), params, tier: spec.tier };
}

export function getNativeFlowCapabilities() {
  return Object.entries(NATIVE_FLOW_REGISTRY).map(([name, spec]) => ({ name, tier: spec.tier, required: [...spec.required] }));
}
