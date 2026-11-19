# JSONL Event Database Design

## Guarantees
- Append-only records; no whole-database JSON rewrite.
- Per-record SHA-256 hash chain and monotonically increasing sequence numbers.
- Primary and local mirror journals.
- Startup validation and longest-valid-copy recovery.
- Corrupt journal copies retained in quarantine.
- Size-based ZIP segment archival and archive integrity verification.
- Streaming archive search without full extraction.

## Failure boundaries
The design is optimized for a single Node.js process on a local filesystem. It does not provide multi-process locking, distributed consensus, encryption at rest, or immunity to physical disk failure. Use a single bot process. Use encrypted off-device backups for disaster recovery.

## Recovery policy
If one journal validates and the other does not, restore from the valid copy. If both validate but one contains more records, restore from the longer copy. If both fail, fail closed and preserve both copies in quarantine. Never silently create a new empty journal after a detected corruption event.

## Archive lifecycle
A segment is copied and validated, zipped, and verified before the active journal is cleared. Archive metadata is appended to the archive catalogue. The archive retention limit is configurable. Search uses ZIP streaming and filters by record type, sequence range, or text.

## Future scaling path
For multi-instance deployments, concurrent writers, high-volume message history, or transactional query requirements, migrate to PostgreSQL or SQLite WAL with a compatibility adapter. Keep the event envelope (`seq`, `ts`, `type`, `payload`, `metadata`, `prevHash`, `hash`) stable to simplify migration.


## Configuration checkpoint
Configuration events are written to the primary and replica journals and also materialized as a one-line JSONL checkpoint at `data/control/config.snapshot.jsonl`. The checkpoint is hash-validated and is used only to preserve the latest configuration if its historical archive segment has been pruned. It does not replace the event history. Rebuilding the checkpoint from retained events is possible while those events remain available.


## Namespaced records
`src/core/repository.js` provides append-only entity operations. `putRecord(namespace, key, value)` appends `entity.put`; `deleteRecord(namespace, key)` appends `entity.delete`; `getRecord` and `listRecords` replay the relevant event history. Reads are currently linear scans. For larger deployments, preserve this API and replace its implementation with indexed SQLite/PostgreSQL storage.
