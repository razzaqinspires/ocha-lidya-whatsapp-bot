/** Normalize user-visible text across text, media, poll, event and interactive replies. */
export function extractMessageText(message, type) {
  if (!message || !type) return '';
  const payload = message[type] && typeof message[type] === 'object' ? message[type] : message;
  if (type === 'conversation') return message.conversation || '';
  if (type === 'extendedTextMessage') return payload.text || '';
  if (['imageMessage', 'videoMessage', 'documentMessage', 'ptvMessage'].includes(type)) return payload.caption || '';
  if (type === 'eventMessage') {
    const start = payload.startTime ? new Date(Number(payload.startTime) * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '';
    return [payload.name, payload.description, start ? `Waktu: ${start}` : ''].filter(Boolean).join('\n');
  }
  if (/^pollCreationMessage/.test(type)) {
    const options = (payload.options || []).map((item, index) => `${index + 1}. ${item.optionName || item.name || ''}`).filter(Boolean);
    return [payload.name, ...options].filter(Boolean).join('\n');
  }
  if (type === 'interactiveResponseMessage') {
    const response = payload.nativeFlowResponseMessage;
    if (!response) return '';
    try {
      const params = typeof response.paramsJson === 'string' ? JSON.parse(response.paramsJson) : (response.paramsJson || {});
      return params.id || params.row_id || params.selected_id || params.selectedRowId || params.title || response.name || '';
    } catch { return response.name || ''; }
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
