# ACIE — Autonomous Contribution Integration & Orchestration Engine

**Release:** Ocha Lidya v1.10.45 · ACIE Part 3/3  
**Execution policy:** deny by default; original contribution source is immutable.

ACIE is an internal Ocha Lidya subsystem for receiving external contributions, preserving source bytes, analyzing languages and capabilities, validating external adapters, running eligible providers in isolated containers, routing among providers, and generating command descriptors. It does not replace the Ocha plugin loader or dispatcher.

## Delivered across Parts 1–3

- Private, versioned Contribution Vault with per-file SHA-256, archive integrity, provenance and attribution metadata.
- Directory/ZIP intake with path traversal, symlink, special-file, duplicate-entry and resource-limit defenses.
- Bounded static discovery for JavaScript/Node.js, CommonJS, ESM, TypeScript, Python, Go, PHP, Java, Rust and Bash.
- Capability candidates with evidence and unverified state until reviewed.
- External JSON-stdio adapter descriptors, Docker/Podman runner, digest-pinned image probe, read-only source mount, no network, no inherited bot credentials, resource/time limits and integrity verification.
- Provider governance stages, owner authorization, adapter protocol test, persistent health, circuit breaker and conservative fallback.
- Automatic command drafts, collision namespacing, dual-registry synchronization, virtual command plugins integrated into the existing plugin loader, and owner-controlled command approval/revocation.
- Response normalization with HTTPS-only links, bounded output, sensitive metadata filtering and attribution mapping.
- Owner-only `.acie` command surface, intake CLI, audit, worker status and operational documentation.

## Quick start intake

Run on the VPS with an absolute source path outside the repository:

```bash
npm install --no-audit --no-fund
npm run acie:intake -- \
  --source /srv/incoming/contribution.zip \
  --contributor-id friend-001 \
  --contributor-name "Developer Name" \
  --name pinterest-downloader \
  --project-id ocha-lidya-bot \
  --license MIT \
  --attribution "Provided by Developer Name with permission"
```

Intake preserves the original bundle and produces static analysis, capability candidates, provider metadata, an external adapter descriptor, dependency records and command drafts. It never imports, compiles, installs dependencies for or executes contributed source.

## Command activation workflow

Use the verified owner private chat:

```text
.acie contribution list
.acie contribution inspect <contribution-id>
.acie contribution verify <contribution-id>
.acie provider list
.acie provider review <provider-id> license
.acie provider review <provider-id> attribution
.acie adapter review <provider-id>
.acie runtime status
.acie runtime probe
.acie provider review <provider-id> sandbox
.acie provider review <provider-id> authorization
.acie adapter test <provider-id> [capability-id]
.acie provider enable <provider-id>
.acie commands list
.acie commands test <command-id>
.acie commands approve <command-id> public|owner
.acie commands sync
```

The sequence is a set of independent gates, not a shortcut. A provider must pass every activation policy check. A failed adapter re-test clears prior successful protocol markers. Only approved virtual commands become discoverable through Ocha's existing `.menu`, command catalog and dispatcher.

To retire an item use `.acie commands revoke <command-id>` and/or `.acie provider disable <provider-id>`. Original contribution bytes and historical versions remain unchanged.

## Storage

`contributions/`, `adapters/`, `generated-commands/`, `runtime-workspaces/` and `config/acie.runtime.json` are private, Git-ignored runtime paths. Never move contributed source into `src/plugins/`. The only active ACIE implementation in the static plugin tree is the owner-only `.acie` console; approved generated commands are virtual plugin descriptors.

## Limitations

The generic bridge supports CLI-style JSON-stdio entrypoints for Node.js, Python, Go, PHP, Java source launch and Bash. TypeScript and Rust remain static-discovery-only until dedicated build adapters are provided. Dependencies are not installed into original source; runtime images must be reviewed and prebuilt. The sandbox currently denies network egress, so remote downloader integrations cannot fetch public services. Generated commands currently return sanitized text and HTTPS links; arbitrary local media upload through WhatsApp needs a separate reviewed media-delivery bridge. Capability and security discovery are heuristic, not proof. License/attribution decisions require human review. Vault encryption-at-rest must be provided by an encrypted host volume and encrypted backups. Target VPS container execution and WhatsApp behavior must be verified before production activation.

## Documentation

See [Part 1 audit](ACIE_PART1_AUDIT.md), [Part 2 runtime isolation](ACIE_PART2_RUNTIME_ISOLATION.md), [Part 3 command integration](ACIE_PART3_COMMAND_INTEGRATION.md), [operations](OPERATIONS.md), [contribution guide](CONTRIBUTION_GUIDE.md), and [security model](SECURITY_MODEL.md).
