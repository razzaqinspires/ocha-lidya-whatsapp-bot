# Ocha v1.10.57 paired release report

**Paired bases:** Ocha Lidya Bot v1.10.57 + Artificial Consciousness Component v2.1.1  
**Scope:** independent Ocha/AC Git publishing lanes, owner-private controls, source preservation, release filters and AC repository hygiene.

## Architecture delivered

The operator workspace layout is:

```text
ocha-lidya-bot/
├── .git/                                  # Ocha repository history
├── src/                                   # Node.js application
└── .private/
    ├── automation/                        # local push config and setup backups; not packaged
    └── artificial-consciousness-component/ # AC source with its own nested .git/ after setup
```

The parent Ocha Git index must never track `.private/`. The Ocha lane watches the Ocha root but excludes `.private/`; it checks `git ls-files -- .private` before a commit and blocks publication if any private path is already tracked. The AC lane watches only the nested AC root and uses a separate repository, branch and credential.

## Targets and credentials

| Lane | Repository                                          | Branch | Environment token |
| ---- | --------------------------------------------------- | ------ | ----------------- |
| Ocha | `razzaqinspires/ocha-lidya-whatsapp-bot`            | `main` | `GITHUB_PAT`      |
| AC   | `razzaqinspires/artificial-consciousness-component` | `main` | `AC_GITHUB_PAT`   |

Both target flags default to enabled when the local config is first created. The flags persist under `.private/automation/auto-push.json` with restrictive file/directory permissions. Token values are not written into that JSON, remote URLs, commit messages or logs. A malformed config is moved to a timestamped quarantine file and both lanes are disabled rather than failing Ocha startup or silently re-enabling a publisher.

## Commands

Previous scripts remain: `npm run git:setup` and `npm run git:watch`. Added scripts include `npm run ac:git:setup`, `npm run ac:git:watch`, `npm run git:status`, `npm run git:push`, `npm run git:push:ocha`, and `npm run git:push:ac`.

The WhatsApp control is `.autopush` with aliases `.gitpush` and `.autogit`. It is `ownerOnly`, `privateOnly`, and `menu: false`; status, enable/disable, manual push, and setup instructions are available only to the verified owner in a private chat. No PAT value is exposed.

## First-time setup sequence

1. Use a real clone of the Ocha repository for Ocha auto-push. Do not create an orphan local history from a ZIP when the remote already contains commits.
2. Extract the paired source so the AC source is at `.private/artificial-consciousness-component`.
3. Put separate fine-grained PATs into `.env`: `GITHUB_PAT` for the Ocha repository and `AC_GITHUB_PAT` for the AC repository. Scope each token to its one matching repository with Contents read/write access.
4. Run `npm run git:setup` only when the Ocha clone needs canonical origin/branch validation.
5. Run `npm run ac:git:setup`. It clones the canonical AC remote first, preserves its history, compares the version/tree, retains a snapshot backup, and installs the local snapshot only when the comparison permits it.
6. Start Ocha with `npm start`. Both independent watchers run inside this Node process when their local Git roots are valid.
7. Verify `.autopush status` and check the returned push result. `READY` is only local repository readiness; a successful push is reported only after GitHub confirms it.

## Security controls

- Ocha `.private/` is ignored as a whole; any existing tracked `.private` path blocks automatic Ocha commits until reviewed and removed from the index.
- AC path policy excludes `.git`, `.env` except `.env.example`, runtime config, `.ssh`, `.aws`, secrets/credentials/certificates/private-key folders, service-account files, key/certificate formats, SQLite/DB files, NADI ledgers/runtime state, caches, virtual environments, build outputs and archives.
- AC watcher rejects symlinks and non-regular files, stages only relative to nested AC root, scans eligible text for secret patterns, and validates exact origin/branch.
- Both lanes refuse divergent history and never force-push.
- Both release archives exclude nested Git metadata and live secrets. The Ocha operator ZIP contains selected private source for installation convenience and is confidential; it must never be uploaded to public Ocha GitHub or public release storage.
- Git encryption is not used. A private repository and least-privilege GitHub access are the intended confidentiality controls.

## Validation

Focused tests executed in this workspace:

- Auto-push configuration: default two lanes, persistence, target allowlist and corrupt-config fail-closed recovery.
- AC Git policy: fixed target/branch, correct parent-root detection, and sensitive path exclusions.
- Release policy: AC source is included only in the private operator bundle; nested `.git`, secret files and `.private/automation` are excluded.
- Watch policy: Ocha watcher excludes `.private/` and automation config.
- Command inventory: `.autopush` and its aliases are collision-free, hidden from menus, owner-only and private-chat-only.

Latest focused execution after the final staging-policy refinement: **23 tests passed, 0 failed**. Owner security regression also confirms `AC_GITHUB_PAT` is exposed as configured/not configured only, never as a value; coverage includes AC Git policy, auto-push config, command inventory, NADI integration, release policy, owner security and watcher policy.

Full direct `node --test` execution: **412 passed, 1 failed, 1 skipped (414 total)**. The single failure is `test/env-inventory.test.js`, which cannot load the declared `acorn@8.15.0` package because dependencies are not installed in this extracted workspace (`ERR_MODULE_NOT_FOUND`). The one skip is the existing optional peer-dependent test. This is an environment/dependency blocker, not a passing result. The source change adds `AC_GITHUB_PAT` as a secret and `.env.example` includes a separate empty placeholder; aggregate counts in `docs/ENVIRONMENT_VARIABLES.md` are explicitly marked provisional until `npm run env:sync` succeeds after `npm install`.

Other checks: syntax **305 JavaScript files passed**; documentation validation **84 Markdown files passed**; publication audit **492 files inspected, 410 public / 82 private excluded, no public private-source fingerprint or credential-pattern findings**; NADI local integration **1/1 passed**. AC: `py_compile` passed, `selftest.py` **6/6**, `test_prime.py` **10/10**. These do not establish live remote authentication or push success.

Full `npm test` lifecycle/bootstrap, full dependency installation, live Git clone/push, authenticated Ocha and AC repository reconciliation, live WhatsApp transport and VPS process supervision have not been verified in this workspace.

## Artifact verification

The final operator package contains 479 entries and includes the selected AC source beneath `.private/artificial-consciousness-component`; it excludes nested `.git` metadata, `.private/automation`, and any real `.env` file. The separate AC package contains 35 entries and excludes `.git`, `__pycache__`, and live `.env` material. Both archives pass `unzip -t`. SHA-256 values are recorded in the release `SHA256SUMS.txt` file.

## Source provenance and remote status

The local source archive does not contain `.git` metadata. No Git commit SHA, successful GitHub write, or public repository update is claimed. A connector inspection fetched the public Ocha `main` package file at version 1.10.53 (package blob SHA `c2f311550a7c4ec535981950a4880912172b2583`). AC repository file metadata was unavailable via the connector. Before using the new push system, reconcile both local bases with authenticated clones and review the diffs; do not force-push the v1.10.57 snapshot over newer remote history.

## Next maintenance

See [`NEXT_UPDATE_ROADMAP.md`](NEXT_UPDATE_ROADMAP.md). The AC mathematical/runtime base remains v2.1.1 in this operational release; continue its scientific and numerical maintenance separately.
