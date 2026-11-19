const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_CHARS = 12_000;

/**
 * Bounded, persisted-by-caller index for AI reply threads. It stores only AI
 * message anchors and their corresponding user/assistant turns; ordinary bot
 * command screens are intentionally kept out of this index.
 */
export class AIReplyChainStore {
  constructor({ maxDepth = DEFAULT_MAX_DEPTH, maxChars = DEFAULT_MAX_CHARS } = {}) {
    this.maxDepth = Math.max(1, Math.min(32, Number(maxDepth) || DEFAULT_MAX_DEPTH));
    this.maxChars = Math.max(1000, Math.min(50_000, Number(maxChars) || DEFAULT_MAX_CHARS));
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
    if (!anchor) return { anchor: null, turns: [], depth: 0, threadId: null };

    const chain = [];
    const seen = new Set();
    let cursor = anchor;
    while (cursor && chain.length < this.maxDepth && !seen.has(cursor.jobId)) {
      seen.add(cursor.jobId);
      chain.push(cursor);
      cursor = cursor.parentJobId ? this.anchorsByJob.get(cursor.parentJobId) : null;
    }
    chain.reverse();

    const turns = [];
    let usedChars = 0;
    for (const entry of chain) {
      const jobTurns = this.turnsByJob.get(entry.jobId) || [];
      for (const turn of jobTurns) {
        const content = String(turn.content || '');
        if (!content) continue;
        const remaining = this.maxChars - usedChars;
        if (remaining <= 0) break;
        const marker = '[truncated]';
        const clipped = content.length > remaining
          ? (remaining <= marker.length ? marker.slice(0, remaining) : `${content.slice(0, remaining - marker.length)}${marker}`)
          : content;
        turns.push({ role: turn.role, content: clipped, jobId: entry.jobId });
        usedChars += clipped.length;
      }
      if (usedChars >= this.maxChars) break;
    }

    return {
      anchor,
      turns,
      depth: anchor.depth,
      threadId: anchor.threadId,
      truncated: chain.length >= this.maxDepth || usedChars >= this.maxChars
    };
  }
}

export const AI_REPLY_CHAIN_LIMITS = Object.freeze({ maxDepth: DEFAULT_MAX_DEPTH, maxChars: DEFAULT_MAX_CHARS });
