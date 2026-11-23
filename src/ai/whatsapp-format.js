const DEFAULT_CHUNK_LIMIT = 3500;

function stash(values, value) {
  const token = `\u0000OCHA${values.length}\u0000`;
  values.push(value);
  return token;
}

/** Convert common Markdown output into WhatsApp's actual text-markup syntax. */
export function formatAITextForWhatsApp(input) {
  let text = String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u202f\u2007]/g, ' ')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '');
  const protectedParts = [];

  // Preserve fenced code, remove Markdown language labels, and close an
  // accidentally unfinished fence instead of leaking malformed formatting.
  text = text.replace(/```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g, (_match, language, code) => {
    const cleanCode = String(code || '').replace(/\s+$/u, '');
    return stash(protectedParts, `\`\`\`\n${cleanCode}\n\`\`\``);
  });

  // Protect inline code from emphasis transformations.
  text = text.replace(/`([^`\n]+)`/g, (_match, code) => stash(protectedParts, `\`${code}\``));

  // Markdown links are not a WhatsApp formatting primitive. Keep the actual
  // destination visible and clickable instead of leaving [label](url) syntax.
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, '$1: $2');

  // Markdown heading levels have no WhatsApp equivalent; render as bold lines.
  text = text.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, '*$1*');
  text = text.replace(/^\s*([-*_]){3,}\s*$/gm, '');

  // Translate Markdown's double emphasis markers to WhatsApp's single markers.
  text = text.replace(/\*\*([\s\S]+?)\*\*/g, '*$1*');
  text = text.replace(/__([\s\S]+?)__/g, '*$1*');
  text = text.replace(/~~([\s\S]+?)~~/g, '~$1~');
  // Collapse any remaining unsupported doubled markers so literal Markdown
  // never leaks into WhatsApp even when the model emits an unmatched pair.
  text = text.replace(/\*\*/g, '*').replace(/__/g, '_').replace(/~~/g, '~');

  // Unsupported HTML-style emphasis is reduced to its readable text.
  text = text.replace(/<\/?(?:strong|b)\s*>/gi, '*')
    .replace(/<\/?(?:em|i)\s*>/gi, '_')
    .replace(/<\/?u\s*>/gi, '');

  // Markdown tables have no native WhatsApp table renderer. Convert each row
  // into a compact readable line, omitting separator rows.
  text = text.replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, '');
  text = text.replace(/^\s*\|(.+)\|\s*$/gm, (_match, row) =>
    row.split('|').map(cell => cell.trim()).filter(Boolean).join('  ·  ')
  );

  text = text.replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text.replace(/\u0000OCHA(\d+)\u0000/g, (_match, index) => protectedParts[Number(index)] ?? '');
}

function splitLongLine(line, limit) {
  const parts = [];
  let rest = line;
  while (rest.length > limit) {
    let at = rest.lastIndexOf(' ', limit);
    if (at < Math.floor(limit * 0.55)) at = limit;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\s+/, '');
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Split long answers at line/paragraph boundaries and keep code fences valid. */
export function splitWhatsAppText(input, maxChars = DEFAULT_CHUNK_LIMIT) {
  const text = String(input ?? '').trim();
  const limit = Math.max(500, Math.min(6000, Number(maxChars) || DEFAULT_CHUNK_LIMIT));
  if (!text) return [];
  if (text.length <= limit) return [text];

  const chunks = [];
  let current = '';
  let activeFence = null;
  const lines = text.split('\n');

  const appendLine = rawLine => {
    const openingOverhead = activeFence !== null ? activeFence.length + 4 : 0;
    const lineParts = splitLongLine(rawLine, Math.max(100, limit - openingOverhead - (activeFence !== null ? 4 : 0)));
    for (const part of lineParts) {
      const candidate = current ? `${current}\n${part}` : part;
      const closingReserve = activeFence !== null && !/^\s*\`\`\`/.test(part) ? 4 : 0;
      if (candidate.length + closingReserve > limit && current) {
        if (activeFence !== null) current = `${current}\n\`\`\``;
        chunks.push(current);
        current = activeFence !== null ? `\`\`\`${activeFence}\n${part}` : part;
      } else {
        current = candidate;
      }
      if (/^\s*```/.test(part)) {
        if (activeFence === null) activeFence = part.trim().slice(3).trim();
        else activeFence = null;
      }
    }
  };

  for (const line of lines) appendLine(line);
  if (current) {
    if (activeFence !== null && !/```\s*$/.test(current)) current += '\n```';
    chunks.push(current);
  }
  return chunks.filter(Boolean);
}

export function inspectAICompletion(text, finishReason = '') {
  const value = String(text || '').trim();
  const reason = String(finishReason || '').toLowerCase();
  const truncatedByProvider = ['length', 'max_tokens', 'max_tokens_reached', 'max_output_tokens', 'max_tokens_exceeded'].includes(reason);
  const fences = (value.match(/```/g) || []).length;
  const unclosedFence = fences % 2 === 1;
  const looksLikeOpenJson = /^\s*[{[]/.test(value) && !/[}\]]\s*$/.test(value);
  return {
    valid: Boolean(value),
    truncated: truncatedByProvider || unclosedFence || looksLikeOpenJson,
    reasons: [truncatedByProvider ? 'provider_output_limit' : '', unclosedFence ? 'unclosed_code_fence' : '', looksLikeOpenJson ? 'unclosed_json' : ''].filter(Boolean)
  };
}
