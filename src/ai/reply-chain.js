const DEFAULT_MAX_CHARS = 24_000;

/**
 * Reply anchors retain the complete parent lineage. The model receives only a
 * recent tail that fits its prompt budget; reaching that prompt budget never
 * severs the stored thread or changes its parent pointer.
 */
export class AIReplyChainStore {
  constructor({ maxChars = DEFAULT_MAX_CHARS } = {}) {
    this.maxChars = Math.max(1_000, Math.min(200_000, Number(maxChars) || DEFAULT_MAX_CHARS));
    this.anchorsByMessage = new Map();
    this.anchorsByJob = new Map();
    this.turnsByJob = new Map();
  }

  addTurn(jobId, role, content) {
    if (!jobId || !['user', 'assistant'].includes(role) || typeof content !== 'string') return;
    let turns = this.turnsByJob.get(String(jobId));
    if (!turns) turns = [];
    if (!turns.some(turn => turn.role === role)) turns.push({ role, content });
    this.turnsByJob.set(String(jobId), turns);
  }

  addAnchor(anchor) {
    if (!anchor?.chat || !anchor?.messageId || !anchor?.jobId) return false;
    const normalized = {
      chat: String(anchor.chat),
      messageId: String(anchor.messageId),
      jobId: String(anchor.jobId),
      parentJobId: anchor.parentJobId ? String(anchor.parentJobId) : null,
      threadId: String(anchor.threadId || anchor.jobId),
      depth: Math.max(0, Number(anchor.depth) || 0),
      createdAt: anchor.createdAt || new Date().toISOString()
    };
    this.anchorsByMessage.set(`${normalized.chat}::${normalized.messageId}`, normalized);
    this.anchorsByJob.set(normalized.jobId, normalized);
    return true;
  }

  resolve(chat, messageId) {
    const anchor = this.anchorsByMessage.get(`${String(chat || '')}::${String(messageId || '')}`);
    if (!anchor) return { anchor: null, turns: [], depth: 0, threadId: null, truncated: false };

    const chain = [];
    const seen = new Set();
    let cursor = anchor;
    // The chain is finite because anchors are persisted message events. Cycle
    // detection is the safety guard; there is intentionally no reply-depth cap.
    while (cursor && !seen.has(cursor.jobId)) {
      seen.add(cursor.jobId);
      chain.push(cursor);
      cursor = cursor.parentJobId ? this.anchorsByJob.get(cursor.parentJobId) : null;
    }
    chain.reverse();

    const allTurns = [];
    for (const entry of chain) {
      for (const turn of this.turnsByJob.get(entry.jobId) || []) {
        const content = String(turn.content || '');
        if (content) allTurns.push({ role: turn.role, content, jobId: entry.jobId });
      }
    }

    // Keep the newest portion in chronological order. An oversized earliest
    // retained turn is clipped from its tail, not silently discarded.
    const selected = [];
    let usedChars = 0;
    for (let index = allTurns.length - 1; index >= 0; index--) {
      const turn = allTurns[index];
      const remaining = this.maxChars - usedChars;
      if (remaining <= 0) break;
      if (turn.content.length <= remaining) {
        selected.unshift(turn);
        usedChars += turn.content.length;
        continue;
      }
      selected.unshift({ ...turn, content: turn.content.slice(-remaining), clipped: true });
      usedChars += remaining;
      break;
    }

    return {
      anchor,
      turns: selected,
      jobIds: chain.map(entry => entry.jobId),
      depth: anchor.depth,
      threadId: anchor.threadId,
      truncated: selected.length < allTurns.length || selected.some(turn => turn.clipped)
    };
  }
}

export const AI_REPLY_CHAIN_LIMITS = Object.freeze({ maxChars: DEFAULT_MAX_CHARS, depthLimited: false });
