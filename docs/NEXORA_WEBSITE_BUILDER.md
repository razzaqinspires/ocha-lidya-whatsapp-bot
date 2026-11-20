# Nexora Website Builder (v1.9.0)

## Purpose

Nexora Website Builder turns a natural-language website request into a complete, multi-file static frontend project and publishes a temporary preview through the existing shared Code Lab gateway and its single persistent TryCloudflare process.

## Request flow

1. The AI engine detects a website creation request in a private chat or an explicitly addressed/replied group conversation.
2. The existing provider manager selects configured API keys and providers using its existing health, retry, and failover policies.
3. Nexora asks the selected model for a strict JSON project manifest.
4. The manifest validator enforces the file count, extension allowlist, path safety, per-file size, total size, and `index.html` requirement.
5. If the same sender and chat already have a live website project, the builder includes its current files as revision context and atomically updates that session; otherwise it creates a new short-lived in-memory session.
6. The shared gateway serves the project under a tokenized URL. A revision preserves the same preview URL and increments the project version. The website is rendered inside a sandboxed iframe without `allow-same-origin`.
7. The session expires within the configured TTL (maximum 60 minutes) and its in-memory files and token are cleared.

## Supported project format

- Static HTML, CSS, browser JavaScript, SVG, JSON, TXT, Web Manifest, and XML.
- Up to 20 files.
- Up to 64 KiB per file and 256 KiB total.
- `index.html` must exist at the project root.
- No npm/pip install, CDN, external script, external font, external API, database, server-side runtime, analytics, tracking, or service worker.
- The preview CSP disables network connections (`connect-src 'none'`) and form submissions. The iframe sandbox omits `allow-same-origin`.

## Backend limitation

This release creates static frontend websites and interactive prototypes. Real authentication, payments, databases, private APIs, server-side rendering, and persistent production hosting are not implemented by this builder. If a user asks for those, Nexora must label the generated result as a frontend demo and must not claim that backend services exist.

## Owner controls

- `.nexora builder on/off` enables or disables the Website Builder globally.
- `.nexora builder-workers 1-4` controls simultaneous AI website generations.
- The default generation queue is bounded to eight waiting jobs; overflow is rejected with a retry message.
- `.nexora auto-run on/off` controls automatic generation-to-preview execution.
- `.nexora tunnel on/off` controls the one shared public tunnel.
- `.nexora all on/off` toggles AI, Code Lab, auto-run, tunnel, and Website Builder together.
- `.nexora status` displays the registered capability state.

All controls are owner-only and global across bot users.

## Resource behavior

Website projects are served from bounded in-memory file maps. They do not create one process, terminal, tab, tunnel, or container per file. Static site sessions consume no Code Lab execution worker. Website generation uses a separate bounded in-process queue (default two concurrent generations and eight waiting jobs); it does not spawn background terminals or per-job daemons. They share the existing global session cap and per-user session cap. The configured TTL is capped at 60 minutes.

## Security notes

- Paths are validated and traversal/hidden paths are rejected.
- File types are allowlisted and content is served with `nosniff`.
- The project iframe is sandboxed without same-origin privileges.
- CSP blocks outbound connections, external scripts/styles/fonts/images, object embeds, and form submissions.
- Preview URLs are bearer links: anyone who obtains the URL can view the preview until expiration.
- Do not place credentials, personal data, or secrets in generated websites.

## Validation

The unit tests validate intent detection, manifest parsing, path traversal rejection, extension restrictions, file-size limits, and the generation prompt. They do not prove that a real external AI provider will always return valid JSON, nor do they replace VPS tests with Docker/Podman and a live Quick Tunnel.
