# Two-Base Ocha Release Model

Every project release produces exactly two independent base source packages:

1. `ocha-lidya-bot` — Node.js/WhatsApp/Nexora/ACIE integration and the local private-core package under `.private/ocha-private-runtime/`. The complete operator ZIP is **not for public upload**.
2. `artificial-consciousness-component` — Python AC-Kernel NADI source, models, tests and API sidecar. It remains a separate project and repository.

The Ocha base contains only NADI's external loader, pinned commit, configuration, loopback HTTP client, health polling and lifecycle management. It does not contain AC Python source. The default NADI commit is `16c2fa6e1b500745f260bcf091284a6e18726883`, package version `2.1.0`, API contract `v1`.

When the two folders are siblings, set this optional local-source setting on the operator host:

```dotenv
OCHA_NADI_SOURCE_DIR=../artificial-consciousness-component
```

Otherwise Ocha uses its HTTPS GitHub downloader pinned to the same immutable commit. Python source is placed in the external component cache (default `~/.ocha/components/nadi/`), never in `src/`.

## One-command verification and two-base release

From the Ocha root, with the AC component at the sibling path, run the unified maintenance entrypoint:

```bash
npm run maintain:two-bases -- --ac-root ../artificial-consciousness-component --out ../two-base-release
```

This one script runs JavaScript syntax, Markdown link validation, private source SHA-256 verification, the publication firewall, a read-only ACIE dynamic registry/provider audit, the Ocha-to-NADI HTTP API v1 integration test, the full Ocha regression suite, AC Python compilation, AC core and extended tests, and a non-mutating Prettier check. It then builds both source packages and writes `ACIE_RUNTIME_AUDIT.json`, `TWO_BASE_QA_REPORT.json`, and `TWO_BASE_RELEASE_MANIFEST.json`. A missing Prettier binary is recorded as a warning; actual test, integrity, documentation or security failures stop the release. A `NO_RUNTIME_DATA` ACIE audit is also recorded as a limitation because a source ZIP does not contain live VPS state.

For packaging only, use `npm run release:two-bases -- --ac-root ../artificial-consciousness-component --out ../two-base-release`. The packaging script validates both package identities and the local private-runtime manifest, excludes `.env`, credentials, sessions, live databases, runtime state, `node_modules`, logs and ACIE dynamic registries, then creates two ZIPs and `TWO_BASE_RELEASE_MANIFEST.json` with SHA-256 checksums. The Ocha output intentionally includes `.private` so the local operator copy remains complete; that archive must never be sent to a public repository.

The AC component archive remains independent. No private Ocha serializer/helper source is copied into the AC component base.

## Git publication boundary

`.gitignore` ignores `.private/`, credentials and runtime state for future Git staging. Auto Git Sync and `security:publication` provide additional checks. `.gitignore` does not untrack already indexed files or erase old commits. The owner must inspect `git status`, `git ls-files`, and staged paths before publishing. Never rewrite public history without explicit approval.
