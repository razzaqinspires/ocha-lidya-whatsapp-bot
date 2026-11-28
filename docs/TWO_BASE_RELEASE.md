# Two-Base Ocha Release Model

Every project release produces exactly two independent base source packages:

1. `ocha-lidya-bot` — Node.js/WhatsApp/Nexora/ACIE integration and the local private-core package under `.private/ocha-private-runtime/`. The complete operator ZIP is **not for public upload**.
2. `artificial-consciousness-component` — Python AC-Kernel NADI source, models, tests and API sidecar. It remains a separate project and repository.

The Ocha public Git source contains only NADI's external loader, configuration, loopback HTTP client, health polling and lifecycle management. The Ocha operator bundle also co-locates the independent AC Python source under `.private/artificial-consciousness-component`; this folder has its own nested Git repository after `npm run ac:git:setup`, while the parent Ocha Git root ignores the complete `.private/` tree. The paired AC package is v2.1.1 and keeps API contract v1. Its supplied source ZIP had no Git metadata, so no upstream commit SHA is claimed for that snapshot. The Ocha loader selects the local nested source using `OCHA_NADI_SOURCE_DIR=.private/artificial-consciousness-component`; the immutable remote fallback pin remains available if the local path is not configured.

Set this local-source setting on the Ocha operator host:

```dotenv
OCHA_NADI_SOURCE_DIR=.private/artificial-consciousness-component
```

Otherwise Ocha uses its HTTPS GitHub downloader pinned to the existing immutable fallback commit. The local v2.1.1 snapshot is selected only when the sibling source path is configured and validated. Python source is placed in the external component cache (default `~/.ocha/components/nadi/`), never in `src/`.

## One-command verification and two-base release

From the Ocha root, with the AC source co-located under `.private/`, run the unified maintenance entrypoint:

```bash
npm run maintain:two-bases -- --ac-root .private/artificial-consciousness-component --out ../two-base-release
```

This one script runs JavaScript syntax, Markdown link validation, private source SHA-256 verification, the publication firewall, a read-only ACIE dynamic registry/provider audit, the Ocha-to-NADI HTTP API v1 integration test, the full Ocha regression suite, AC Python compilation, AC core and extended tests, and a non-mutating Prettier check. It then builds both source packages and writes `ACIE_RUNTIME_AUDIT.json`, `TWO_BASE_QA_REPORT.json`, and `TWO_BASE_RELEASE_MANIFEST.json`. A missing Prettier binary is recorded as a warning; actual test, integrity, documentation or security failures stop the release. A `NO_RUNTIME_DATA` ACIE audit is also recorded as a limitation because a source ZIP does not contain live VPS state.

For packaging only, use `npm run release:two-bases -- --ac-root .private/artificial-consciousness-component --out ../two-base-release`. The packaging script validates both package identities and the local private-runtime manifest, excludes `.env`, credentials, sessions, live databases, runtime state, `node_modules`, logs and ACIE dynamic registries, then creates two ZIPs and `TWO_BASE_RELEASE_MANIFEST.json` with SHA-256 checksums. The Ocha output intentionally includes selected `.private` AC and private-runtime source so the local operator copy remains complete; nested `.git`, `.env`, config secrets and runtime state are excluded. That archive must never be sent to a public repository.

The AC component archive remains independent. No private Ocha serializer/helper source is copied into the AC component base.

## Git publication boundary

`.gitignore` ignores `.private/`, credentials and runtime state for future Git staging. Auto Git Sync and `security:publication` provide additional checks. `.gitignore` does not untrack already indexed files or erase old commits. The owner must inspect `git status`, `git ls-files`, and staged paths before publishing. Never rewrite public history without explicit approval.

## Dual Git publication

Ocha startup can monitor and publish both roots: Ocha itself to `razzaqinspires/ocha-lidya-whatsapp-bot` using `GITHUB_PAT`, and the nested AC source to `razzaqinspires/artificial-consciousness-component` using `AC_GITHUB_PAT`. The parent Ocha repository never stages `.private/`; the AC repository has its own `.git` root and does not share the Ocha index. Run `npm run ac:git:setup` once to clone AC history before applying the supplied snapshot, then restart Ocha. The owner-private `.autopush` control is hidden from menus. See [`AUTO_PUSH_TWO_REPOSITORIES.md`](AUTO_PUSH_TWO_REPOSITORIES.md).
