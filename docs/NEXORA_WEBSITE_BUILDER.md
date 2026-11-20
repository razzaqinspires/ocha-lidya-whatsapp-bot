# Nexora Website Builder (v1.10.5)

## Purpose

Nexora Website Builder converts a natural-language request into a static multi-file website, saves the source in a durable per-user Project Library, and publishes a separate temporary preview through the existing shared Code Lab gateway and Quick Tunnel. The source repository is no longer tied to the in-memory preview session or its TTL.

## Request flow

1. Website creation and project operations are accepted in a private WhatsApp chat only.
2. The message pipeline resolves the sender from Baileys PN metadata. Project Library derives a non-reversible per-user directory key from that canonical sender identity.
3. Nexora reads the active project pointer for that sender/chat. If the user asks for a new project, it creates a separate repository; otherwise follow-up requests target the selected repository.
4. The provider manager generates a strict JSON manifest. For a new project, it returns a file list. For an update, it returns complete changed files and explicit deletions; files not included in the change list are retained.
5. The validator enforces paths, extensions, file count and byte limits, index.html, secret-pattern screening, and basic local-reference checks across HTML, CSS, and JavaScript imports.
6. Project Library writes to a staging directory, snapshots the previous version, commits to a local Git repository when Git is available, checks the real per-user storage quota, then atomically installs metadata and source. Failed writes restore the previous repository.
7. Nexora separately requests a preview session. Preview failure or TTL expiry does not delete the permanent repository.
8. ZIP delivery follows each user's persisted `ask`, `always`, or `off` preference. Archives are built from the selected repository's explicit allowlist, never from `/root` or the Project Library parent.

## Project storage

The default root when running as root is `/root/ocha-project-library/<user-hash>/<repository-slug>/`. Metadata, per-chat active pointers, user ZIP preferences, version snapshots, and temporary archives are stored in separate internal directories outside the repository. The user-facing assistant reports a logical `private/<repository-slug>/` workspace label, not the complete host root.

This is a private filesystem workspace scoped by canonical WhatsApp sender, not an individual Docker/Podman container for each user. Static website projects do not start their own terminals, processes, or tunnels. Code execution remains in Code Lab's temporary isolated workers.

See `docs/PROJECT_LIBRARY.md` for quotas, layout, permissions, memory, Git/history, and recovery details.

## Project memory and iterative updates

Every repository keeps a project summary, architecture notes, features, decisions, next steps, the latest 24 task records, file hashes, and version metadata. The AI prompt treats existing source as untrusted data and asks the model to map the requested change to affected files, preserve unrelated features, maintain the existing design system, audit dependencies, and avoid guessing at files omitted from context. Common local asset references are validated before persistence. Invalid manifests and reference errors can be sent through one bounded repair attempt; an invalid repair is not saved.

A project can be continued after Ocha restarts by selecting it with `.project use <slug>`. Preview sessions are independent and may need a new URL after expiry or tunnel recreation.

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

`ask` is the default. `always` sends a ZIP after every successful build or update. `off` disables automatic exports but does not prohibit a manual ZIP request. Preferences are per user and persist across restarts. All commands are private-chat-only; group members cannot access another participant's repository or receive its ZIP.

## Limits and scheduling

- Up to 80 files per project, 512 KiB per file, and 4 MiB of current source per project.
- Up to 40 projects and 256 MiB combined source/Git/snapshot storage per user.
- Up to 12 retained snapshots per project, limited by the shared user quota.
- Maximum ZIP size 16 MiB.
- Website generation uses a fair bounded queue, up to four global concurrent builds, one active build per user, and up to two waiting builds per user.

## Supported project format

- Static HTML, CSS, browser JavaScript, SVG, JSON, TXT, Web Manifest, and XML.
- Relative, validated local paths only; no hidden folders, `.git`, `.env`, sessions, data, or node_modules.
- No npm/pip install, CDN, external scripts/fonts/images/APIs, tracking, or outbound network dependencies in preview.
- The preview CSP blocks outbound connections. The iframe is sandboxed without `allow-same-origin`.

## Backend limitation

The builder creates static frontend websites and interactive prototypes. Real authentication, payment processing, databases, private APIs, server-side rendering, production hosting, and persistent application workers are not implemented by the static builder. If requested, Nexora must label such behavior as a frontend demo or identify the additional backend work; it must not claim that a real backend exists.

## Cloudflare preview limitation

The public preview is a temporary bearer link served through the one shared Quick Tunnel. It can expire and its hostname can change when the tunnel is recreated. Quick Tunnel is for development/testing, not production hosting. No project repository depends on the preview hostname or tunnel process.

## Security and privacy

- Project data is namespaced by the canonical PN sender supplied by the WhatsApp message pipeline; display names and message claims are not identity.
- Repository files and internal metadata use restrictive local permissions.
- Users can only list, select, update, inspect, and export projects under their own user key.
- Project operations are rejected in group chats.
- Exports contain only validated files from one selected repository and a generated README. They exclude the library root, other users, Git metadata, internal metadata, snapshots, temporary files, environment files, sessions, and runtime data.
- Export rechecks symlinks and common credential patterns. Do not store credentials or personal secrets in frontend source.

## Validation

Unit/integration tests cover per-user isolation, active project selection, incremental updates, task memory, version snapshots, local-reference validation, queue fairness, ZIP allowlisting, traversal rejection, and preference isolation. A local mocked provider verifies the application flow; a real provider, WhatsApp private chat, disk quota, and live Quick Tunnel still need VPS verification.
