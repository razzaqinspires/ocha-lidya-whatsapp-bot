import {
  appendUserVaultEvent, loadUserVaultSnapshot, readUserVaultEvents, saveUserVaultSnapshot
} from './user-vault.js';

const PRIVATE_JID = /^(?:\d{8,20})@(s\.whatsapp\.net|lid)$/i;
const MIGRATION_VERSION = 1;
const locks = new Map();

function cleanJid(value) {
  return String(value || '').trim().replace(/:\d+(?=@)/, '');
}

function isPrivateJid(value) {
  return PRIVATE_JID.test(cleanJid(value));
}

async function withLock(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  const marker = current.catch(() => {});
  locks.set(key, marker);
  try { return await current; }
  finally { if (locks.get(key) === marker) locks.delete(key); }
}

/**
 * One-time, idempotent migration of legacy private-DM AI turns from the shared
 * event journal into the sender's encrypted roo vault. Group events are never
 * migrated into a private user's archive.
 */
export async function migrateLegacyPrivateAIHistory(rows = []) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const payload = row?.payload || {};
    const chat = cleanJid(payload.chat);
    const sender = cleanJid(payload.sender);
    const role = String(payload.role || '');
    const content = typeof payload.content === 'string' ? payload.content : '';
    if (!isPrivateJid(chat) || !isPrivateJid(sender) || chat !== sender || !['user', 'assistant'].includes(role) || !content.trim()) continue;
    // The sender identity is the vault owner. A private-DM legacy row must be
    // addressed to the same normalized PN/LID; ambiguous identities fail closed.
    // Group, broadcast, status, newsletter, and cross-chat rows are excluded.
    const list = grouped.get(sender) || [];
    list.push({ row, payload, role, content });
    grouped.set(sender, list);
  }

  let migratedUsers = 0;
  let migratedTurns = 0;
  for (const [userId, records] of grouped) {
    await withLock(userId, async () => {
      const identity = await loadUserVaultSnapshot(userId, 'identity') || {};
      const priorMigration = identity.legacyPrivateHistoryMigration;
      if (priorMigration?.version === MIGRATION_VERSION && priorMigration.complete === true) return;

      const existingEvents = await readUserVaultEvents(userId, { types: 'conversation.turn' });
      const importedSeqs = new Set(existingEvents
        .map(event => event.payload?.legacySourceSeq)
        .filter(value => Number.isSafeInteger(value)));
      let userMigrated = 0;
      const ordered = records.sort((a, b) => Number(a.row.seq || 0) - Number(b.row.seq || 0));
      for (const item of ordered) {
        const legacySeq = Number(item.row.seq);
        if (!Number.isSafeInteger(legacySeq) || legacySeq < 1 || importedSeqs.has(legacySeq)) continue;
        const originalCreatedAt = item.row.ts || item.row.createdAt || item.payload.createdAt || null;
        await appendUserVaultEvent(userId, 'conversation.turn', {
          role: item.role,
          content: item.content,
          jobId: item.payload.jobId || `legacy-${legacySeq}`,
          chatScope: 'private',
          legacySourceSeq: legacySeq,
          originalCreatedAt: originalCreatedAt && Number.isFinite(Date.parse(originalCreatedAt))
            ? new Date(originalCreatedAt).toISOString() : null,
          migratedFrom: 'global-ai-turn-journal'
        });
        importedSeqs.add(legacySeq);
        userMigrated++;
      }
      const highestSeq = ordered.reduce((max, item) => Math.max(max, Number(item.row.seq) || 0), 0);
      await saveUserVaultSnapshot(userId, 'identity', {
        ...identity,
        legacyPrivateHistoryMigration: {
          version: MIGRATION_VERSION,
          complete: true,
          source: 'global-ai-turn-journal',
          throughSequence: highestSeq,
          migratedTurns: (Number(priorMigration?.migratedTurns) || 0) + userMigrated,
          completedAt: new Date().toISOString()
        }
      });
      migratedUsers++;
      migratedTurns += userMigrated;
    });
  }
  return { users: migratedUsers, turns: migratedTurns, examinedUsers: grouped.size };
}
