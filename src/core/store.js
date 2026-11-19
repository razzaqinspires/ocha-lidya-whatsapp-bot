export { putRecord, deleteRecord, getRecord, listRecords } from './repository.js';
import { appendRecord, getRecords } from './database.js';

/** Compatibility event API; events are durable JSONL records, not mutable JSON state. */
export async function recordEvent(type, payload, metadata) {
  return appendRecord(type, payload, metadata);
}
export async function getEventHistory(filter = {}) {
  return getRecords(filter);
}
export async function loadStore() {
  return { backend: 'jsonl-event-database', durable: true };
}
export async function saveStore() {
  // Intentionally no-op: every event is persisted and fsync'd on append.
  return true;
}
