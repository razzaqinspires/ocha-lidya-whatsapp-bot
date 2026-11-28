# Nexora Project Library (v1.10.5)

## Purpose

Project Library is the durable source repository and task-memory layer for the natural-language Website Builder. It is separate from Code Lab preview sessions: a preview may expire, a tunnel hostname may change, or Ocha may restart without deleting the user's saved website source.

## User isolation

The project owner key is derived from the sender PN JID supplied by the WhatsApp message pipeline after Baileys sender resolution. Raw phone numbers are not used as directory names. A SHA-256-derived user key namespaces each user's repository, project metadata, active-project pointer, export preference, and version history.

Default local layout in v1.10.24 is integrated into the same per-user `roo` namespace as private AI memory and conversation history:

```text
data/roo/<sha256-normalized-user-id>/
  projects/<repository-slug>/
    index.html
    assets/...
    README.md
    .git/                    # local Git history where available
  .control/projects/         # per-user manifests and task memory
  .control/active/           # selected project pointers, hashed per chat
  .control/preferences/      # ZIP export preference
  .history/<project-id>/     # prior project snapshots
  .tmp/                      # temporary export archives
```

The default path now matches the User Vault's normalized SHA-256 identity key. Existing legacy repositories under `/root/ocha-project-library` (root service) or `$HOME/.local/share/ocha-lidya/projects` (non-root service) are copied into the new per-user root on first access without overwriting an existing destination. The legacy source is retained. An administrator can override the root with `paths.projectLibraryRoot` in `config/runtime.json` or the existing application-level `codeLab.projectLibraryRoot` setting. Directories/files use restrictive permissions. The user-facing assistant does not reveal the host path by default.

This is a **logical per-user filesystem workspace**, not a dedicated long-lived Docker/Podman container. Website generation writes static source files directly into the bounded library. Actual code execution remains in Code Lab's isolated, temporary runtime workers. Do not describe Project Library as a stronger OS/container security boundary.

## Project memory and revisions

Each project records:

- Project summary and architecture.
- Features, technical decisions, and next steps.
- The latest 24 user tasks with timestamps and version numbers.
- Current source file manifest with size and SHA-256 hash.
- Project version and update timestamps.
- Git commit identifier when local Git is available.
- Bounded ZIP snapshots of prior versions.

Updates are incremental. The model receives the selected repository context and returns a list of complete changed files plus explicit deletions. Files not named in the change list are retained. The repository is staged before replacement; an unsuccessful save restores the previous repository. A static reference audit checks common HTML/CSS/JavaScript local asset references before committing.

The selected project is scoped to the user's private chat. Users can keep multiple repositories and select one to continue. User A cannot list, select, update, or export User B's project by supplying a slug or project ID.

## ZIP policy

Default policy is `ask`: the assistant sends a ZIP only when the user explicitly requests an export. Each user can persist one of these modes:

- `ask`: manual requests only (default).
- `always`: send the updated repository ZIP after every successful create/update.
- `off`: disable automatic ZIP delivery. A manual `.project zip` or natural-language export request remains available.

The ZIP is assembled from the selected repository's validated file manifest and generated README only. It never includes the Project Library root, another user's directory, `.control`, `.history`, `.tmp`, `.git`, sessions, environment files, or runtime data. ZIP creation rechecks file type, symlinks, path boundaries, size, and common secret patterns before delivery. Temporary ZIP files are deleted after sending.

Project operations and ZIP delivery are private-chat-only to avoid disclosing a user's source or project memory to group participants.

## User commands

```text
.project help
.project list
.project status
.project storage
.project use <slug|id>
.project history
.project memory
.project zip [slug|id]
.project export ask
.project export always
.project export off
```

`.project export always` is a per-user preference, not a global owner setting. It persists across Ocha restarts.

## Limits and scheduling

- 40 repositories per user.
- 256 MiB storage per user, measured against source repositories, Git data, and retained snapshots.
- 80 source files per project.
- 512 KiB per file and 4 MiB current source per project.
- 12 retained ZIP snapshots per project, subject to the shared user quota.
- 16 MiB maximum delivered ZIP.
- Maximum four global concurrent website generations, with one active generation per user and a bounded per-user queue.

The limits are safeguards, not a promise of unlimited storage. The project library stores local source on the VPS; it is not replicated cloud object storage. Back up `/root/ocha-project-library` (or the configured library root) alongside the bot's other application data. Never send the whole library root to users.

## Website execution and production scope

Generated websites are static frontend projects. Login, payment, database, secure checkout, dynamic product inventory, server-side APIs, and production hosting require additional backend services and are not implied by a preview. Public previews use the shared temporary Cloudflare Quick Tunnel and remain bearer-link accessible until their session expires. A preview URL is not a production deployment.

## Recovery and integrity

- Writes are serialized within each user's library to protect project versions, quota checks, and active pointers.
- A staged repository is validated before it replaces the prior version.
- Version snapshots are separate from the source repository and excluded from exports.
- File hashes detect manual changes to working copies.
- Symbolic links, traversal paths, hidden folders, unsupported extensions, and obvious credential patterns are rejected.
- If the library is unavailable or a quota is exceeded, the build fails without intentionally deleting the previous committed repository.

The library is a local persistence layer, not an external backup service. Disk failure or loss of the VPS can still destroy the repository unless a separate backup is configured.
