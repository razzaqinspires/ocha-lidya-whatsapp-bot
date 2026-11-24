# ACIE Operations

## Startup

ACIE initializes from `src/index.js` after the JSONL database. If ACIE initialization fails, the bot logs a sanitized error and continues its standard runtime; ACIE failure must not stop WhatsApp startup. Generated command virtual plugins are merged into the existing plugin loader only if their command lifecycle and provider gates are valid.

## Intake on VPS

```bash
npm install --no-audit --no-fund
npm run acie:intake -- --source /srv/incoming/contribution.zip --contributor-id contributor-001 --contributor-name "Developer Name" --name module-name --project-id ocha-lidya-bot --license MIT --attribution "Contributor attribution"
```

Use absolute paths. The source path must be outside the repository. Intake is serialized, creates a new immutable version, runs static analysis and command drafting, and does not execute source. Do not manually edit the original directory after intake; submit corrections as a new version.

## Owner command surface

All administration is restricted to the verified owner in private chat:

- `.acie status|overview|statistics`
- `.acie contribution list|inspect|verify|history|provenance`
- `.acie provider list|inspect|review|test|enable|disable`
- `.acie adapter review|test <provider-id>`
- `.acie runtime status|probe`
- `.acie capabilities|languages|workers`
- `.acie routing status|inspect|simulate`
- `.acie commands list|inspect|conflicts|test|sync|approve|reject|revoke`
- `.acie integrity|security|dependencies|compatibility|audit`

## Recommended activation sequence

1. `.acie contribution list`
2. `.acie contribution inspect <contribution-id>`
3. `.acie contribution verify <contribution-id>`
4. Review static security findings, license and attribution outside automated analysis.
5. `.acie provider review <provider-id> license`
6. `.acie provider review <provider-id> attribution`
7. `.acie adapter review <provider-id>`
8. Configure a pinned runtime image and absolute Docker/Podman engine path in private `config/acie.runtime.json`.
9. `.acie runtime probe`
10. `.acie provider review <provider-id> sandbox`
11. `.acie provider review <provider-id> authorization`
12. `.acie adapter test <provider-id> <capability-id>` (or `.acie commands test <command-id>`)
13. `.acie provider enable <provider-id>`
14. `.acie commands approve <command-id> public|owner`
15. `.acie commands sync` if required; verify with `.menu` and `.acie commands list`.

A provider may contain more than one capability. Test each command/capability intended for activation and approve the corresponding command individually. Do not set public permission unless license, attribution, security and operational requirements have been reviewed.

## Disable, revoke and rollback

`.acie provider disable <provider-id>` removes its generated commands from runtime eligibility while retaining metadata and source. `.acie commands revoke <command-id>` removes only one virtual command. Rollback means selecting/reenabling a previously reviewed provider version; it never rewrites older source or changes its bytes.

## Backup

Back up `contributions/` securely, including vault, registry, metadata and audit. The directory contains third-party source and may include credentials preserved in the original contribution. ACIE does not encrypt vault contents itself: mount it on an encrypted host volume and encrypt off-device backups. Never commit private contribution data.

## Runtime configuration

Use `.acie runtime status` to inspect the current host gate and `.acie runtime probe` to check the configured container engine and every pinned image. Runtime config belongs in Git-ignored `config/acie.runtime.json`; use `config/acie.runtime.example.json` as a reference. Do not use floating image tags. The current network mode is `none`; internet-dependent providers cannot fetch public resources in this sandbox.

## Current operational boundary

The generic bridge supports CLI-style JSON-stdio entrypoints for Node.js, Python, Go, PHP, Java source launch and Bash. TypeScript and Rust remain discovery-only. Dependencies must already exist in a reviewed runtime image; ACIE does not install dependencies into the source vault. Generated WhatsApp command responses currently render safe text and HTTPS links; automatic media upload/local-file delivery needs a separate reviewed adapter. Production container execution and menu delivery must be validated on the target VPS.
