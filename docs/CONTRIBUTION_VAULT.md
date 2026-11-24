# Contribution Vault

## Directory layout

```text
contributions/
├── vault/<contributor-id>/<contribution-name>/
│   ├── current.json
│   ├── history.json                # version and metadata integrity anchors
│   └── versions/vN/
│       ├── original/                 # preserved source bytes; read-only best effort
│       ├── source-archive.zip        # exact original archive, when ZIP was supplied
│       ├── manifest.json             # metadata and SHA-256 inventory
│       ├── provenance.json           # attribution and receipt record
│       └── analysis.json              # static-only findings
├── registry/{providers,capabilities,commands}.json
├── metadata/
├── dependency-locks/
├── execution-profiles/
├── compatibility/
├── audit/events.jsonl
└── quarantine/
```

`adapters/`, `generated-commands/` and `runtime-workspaces/` are sibling operational directories under the repository root. All are Git-ignored.

## Version lifecycle

The intake lock serializes version allocation. The source copy is re-hashed and compared with the submitted directory before it is committed. A staging folder is populated, source is hashed, metadata is written, original directories are made read-only best effort and the staging version is atomically renamed to `versions/vN`. `current.json` and `history.json` point to the newest version. Existing versions are not mutated.

## Manifest fields

The manifest includes contribution/contributor/project IDs, original file and directory inventory, byte counts, SHA-256 per file, source archive hash when applicable, language/runtime/module-system discovery, runtime requirements, dependencies, environment-variable names, entry-point candidates, bounded analysis coverage, capability candidates, license, attribution, integrity and execution authorization status. `history.json` anchors final manifest/provenance/analysis hashes for versions created by the hardened intake pipeline.

## Recovery

If intake fails before final rename, the staging directory is deleted and the source input remains untouched. If registry writes fail after a version is committed, the preserved version remains available for a subsequent metadata-registration retry; do not re-intake or overwrite it without first checking the version history.
