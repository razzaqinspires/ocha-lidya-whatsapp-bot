# ACIE Security Model

## Default-deny controls

- Source code is never executed during intake or static analysis.
- Original contribution bytes remain in a versioned vault; adapters and generated virtual plugins live outside the original source.
- ZIP traversal, absolute paths, symlinks, special entries, duplicate paths and resource-limit violations are rejected.
- Intake and static-analysis work are bounded.
- Vault, registry, adapter, audit and runtime metadata use restrictive host permissions best effort.
- Provider status defaults to quarantined; owner authorization defaults false.
- Activation requires reviewed license, confirmed attribution, verified source integrity, adapter review, successful adapter and protocol test, approved sandbox, successful host probe, explicit owner authorization, verified output contract and zero critical/high static findings.
- `.acie` requires the existing verified-owner identity check and private chat.
- Sandbox execution uses digest-pinned containers, no network, read-only source/root, no inherited bot credentials, non-root user and bounded resources.
- Provider responses are field-allowlisted; HTTPS-only URLs and secret-like metadata/text are filtered before WhatsApp rendering.

## Storage encryption boundary

ACIE does not encrypt vault files itself. Original contribution bytes are stored in private directories with restrictive host permissions and are not cryptographically encrypted by ACIE. Before accepting contributions containing live credentials, mount `contributions/` on an encrypted host volume and use encrypted off-device backups. File mode `0400` is not encryption.

## Threats considered

Path traversal, symlink attacks, archive/decompression exhaustion, duplicate archive paths, malicious source import, dependency poisoning, command/alias collision, credential leakage, retry side effects, provider flapping, compromised output URLs and unaudited activation.

## Residual risks

Static pattern analysis cannot detect every malicious code path or secret. Capability detection is heuristic and not proof of functionality. Container isolation depends on the host engine and its configuration. The current generic runner has no network egress and does not provide isolated dependency installation; remote downloaders requiring public access cannot work yet. TypeScript and Rust need dedicated build adapters. Human license and attribution review are required. Host administrators can alter filesystem content, so use independent encrypted backups and hash verification.
