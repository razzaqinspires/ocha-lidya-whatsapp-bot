/** Normalize user-visible text across text, media, poll, event and interactive replies. */
function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function firstString(...values) {
  return values.find(value => typeof value === 'string' && value.trim())?.trim() || '';
}

/**
 * Read the response payload WhatsApp returns after a native-flow interaction.
 * Baileys models this as name + paramsJson; the JSON fields vary by action/client.
 * The original params are preserved instead of discarding unfamiliar fields.
 */
export function parseNativeFlowResponse(message) {
  const payload = message?.interactiveResponseMessage || message;
  const response = payload?.nativeFlowResponseMessage;
  if (!response || typeof response !== 'object') return null;

  const params = parseJsonObject(response.paramsJson);
  const nested = [params.response, params.data, params.payload, params.flow_response]
    .map(value => parseJsonObject(value));
  const candidates = [params, ...nested];
  const selectedRowId = firstString(...candidates.flatMap(item => [
    item.row_id, item.rowId, item.selectedRowId, item.selected_row_id
  ]));
  const selectedId = firstString(...candidates.flatMap(item => [
    item.id, item.selected_id, item.selectedId, item.button_id, item.buttonId,
    item.quick_reply_id, item.quickReplyId
  ]), selectedRowId);

  return {
    name: firstString(response.name),
    version: Number.isInteger(response.version) ? response.version : null,
    params,
    selectedId,
    selectedRowId,
    rawParamsJson: typeof response.paramsJson === 'string' ? response.paramsJson : ''
  };
}

/** Normalize user-visible text and preserve native-flow selections as command text. */
export function extractMessageText(message, type) {
  if (!message || !type) return '';
  const payload = message[type] && typeof message[type] === 'object' ? message[type] : message;
  if (type === 'conversation') return message.conversation || '';
  if (type === 'extendedTextMessage') return payload.text || '';
  if (['imageMessage', 'videoMessage', 'documentMessage', 'ptvMessage'].includes(type)) return payload.caption || '';
  if (type === 'interactiveMessage') {
    const header = payload.header || {};
    const mediaCaption = header.imageMessage?.caption || header.videoMessage?.caption || header.documentMessage?.caption || '';
    return [header.title, header.subtitle, payload.body?.text, mediaCaption].filter(Boolean).join('\n');
  }
  if (type === 'eventMessage') {
    const start = payload.startTime ? new Date(Number(payload.startTime) * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '';
    return [payload.name, payload.description, start ? `Waktu: ${start}` : ''].filter(Boolean).join('\n');
  }
  if (/^pollCreationMessage/.test(type)) {
    const options = (payload.options || []).map((item, index) => `${index + 1}. ${item.optionName || item.name || ''}`).filter(Boolean);
    return [payload.name, ...options].filter(Boolean).join('\n');
  }
  if (type === 'interactiveResponseMessage') {
    const response = parseNativeFlowResponse(payload);
    return response?.selectedId || response?.name || payload.body?.text || '';
  }
  if (type === 'templateButtonReplyMessage') return payload.selectedId || payload.selectedDisplayText || '';
  if (type === 'buttonsResponseMessage') return payload.selectedButtonId || payload.selectedDisplayText || '';
  if (type === 'listResponseMessage') return payload.singleSelectReply?.selectedRowId || payload.title || '';
  if (type === 'richResponseMessage') {
    const parts = [];
    for (const item of payload.submessages || []) {
      if (item.messageText) parts.push(item.messageText);
      if (item.tableMetadata?.title) parts.push(`[Tabel: ${item.tableMetadata.title}]`);
      for (const block of item.codeMetadata?.codeBlocks || []) if (block.codeContent) parts.push(block.codeContent);
    }
    return parts.join('\n');
  }
  return payload.text || payload.contentText || payload.hydratedContentText || '';
}
