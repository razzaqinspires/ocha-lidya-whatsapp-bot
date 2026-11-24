# Source Preservation Policy

## Immutable original rule

A received contribution is an original artifact. ACIE must not format, rename, refactor, patch, transpile, rewrite, merge, delete or optimize files inside `original/`. The intake pipeline copies bytes and records SHA-256 hashes. Every later submission is a new `vN` directory.

## Intake behavior

- Preserve filenames, nested folder structure, hidden files and file bytes.
- Preserve a ZIP input byte-for-byte as `source-archive.zip`, then safely extract its content to `original/` for inventory and analysis.
- Reject symlinks, special filesystem objects, absolute paths, `..`, duplicate ZIP paths, unsupported entry types and resource-limit violations.
- Set read-only file/directory permissions as a best-effort host safeguard. Permission bits are not the integrity proof; the SHA-256 manifest and version-history anchors are used for discrepancy detection. A local administrator with write access to both the vault and its history can still rewrite local metadata; this is not a remote cryptographic signature or WORM storage.
- Compare the copied directory inventory and file hashes against the submitted directory at intake time.
- For ZIP input, verify the copied archive bytes before extraction and verify the preserved archive SHA-256 on later integrity checks.
- Anchor final manifest, provenance and analysis hashes in the version history after intake metadata is finalized.
- Verify every file after intake and whenever an owner requests `.acie contribution verify`.
- Never overwrite a prior version. Rollback is a future provider-configuration change only.

## Storage encryption boundary

Part 1 uses restrictive filesystem permissions but does not encrypt original files at rest within ACIE. Before receiving live credentials, the operator must place the vault on encrypted storage and protect off-device backups. This is an explicit release limitation, not a claim that file permissions provide encryption.

## Credentials embedded in contributions

Do not print values, copy them into environment variables, forward them to workers, or include them in audit/telemetry. Static scanning records only a finding ID, file, line and severity. The original copy remains unmodified as requested. If a credential is suspected exposed, contact the contributor and treat activation as blocked until the owner resolves the exposure without modifying the preserved artifact.

## Worker permissions

No ACIE worker has a write API for `original/`. Workers may read the vault for inventory/hash/static analysis and may write metadata, registry entries, adapter descriptors, command drafts, audit events and isolated workspaces. Any source modification must be done only by the contributor outside the vault, submitted as a new version.
