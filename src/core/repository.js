import { appendRecord, getRecords } from './database.js';

const validPart = value => typeof value === 'string' && value.length > 0 && value.length <= 160;

/**
 * Append-only namespaced key/value repository.
 * Values are event payloads; updates append a new version instead of mutating old records.
 */
export async function putRecord(namespace, key, value, metadata = {}) {
  if (!validPart(namespace) || !validPart(key)) throw new TypeError('namespace and key must be non-empty strings up to 160 characters');
  return appendRecord('entity.put', { namespace, key, value }, metadata);
}

export async function deleteRecord(namespace, key, metadata = {}) {
  if (!validPart(namespace) || !validPart(key)) throw new TypeError('namespace and key must be non-empty strings up to 160 characters');
  return appendRecord('entity.delete', { namespace, key }, metadata);
}

export async function getRecord(namespace, key) {
  const events = await getRecords({ predicate: record =>
    ['entity.put','entity.delete'].includes(record.type) &&
    record.payload?.namespace === namespace &&
    record.payload?.key === key
  });
  const latest = events.at(-1);
  if (!latest || latest.type === 'entity.delete') return null;
  return structuredClone(latest.payload.value);
}

export async function listRecords(namespace) {
  const events = await getRecords({ predicate: record =>
    ['entity.put','entity.delete'].includes(record.type) &&
    record.payload?.namespace === namespace
  });
  const state = new Map();
  for (const event of events) {
    const { key, value } = event.payload;
    if (event.type === 'entity.delete') state.delete(key);
    else state.set(key, structuredClone(value));
  }
  return Object.fromEntries(state);
}
