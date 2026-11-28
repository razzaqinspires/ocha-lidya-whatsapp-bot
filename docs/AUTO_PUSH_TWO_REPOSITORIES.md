# Dual-Repository Automatic Git Push — Ocha v1.10.57

## Decision and repository boundaries

The operator workspace contains two independent Git roots:

```text
ocha-lidya-bot/                         # Git root 1
├── .git/                               # Ocha history
├── src/
├── scripts/
└── .private/                           # ignored by the Ocha root Git repository
    ├── ocha-private-runtime/
    ├── project/
    ├── automation/                     # local control/configuration only
    └── artificial-consciousness-component/  # Git root 2
        ├── .git/                       # AC history, independent remote
        ├── ac/
        ├── tests/
        └── pyproject.toml
```

Repository 1 is fixed to `razzaqinspires/ocha-lidya-whatsapp-bot`, branch `main`, authenticated by the shared `GITHUB_PAT`. Repository 2 is fixed to `razzaqinspires/artificial-consciousness-component`, branch `main`, authenticated by that same `GITHUB_PAT`. The root Ocha watcher and publication firewall exclude `.private/`; the AC watcher starts at the nested AC root and never stages outside it. The nested `.git` directory is excluded from both operator ZIPs.

**Critical:** `.gitignore` does not untrack files already committed in Ocha history. Before enabling publication on an existing Ocha clone, inspect `git ls-files -- .private`. If it lists private paths, stop and review them. Use `git rm -r --cached -- .private` only after confirming the intended removal from the Ocha repository index; this leaves local files in place but stages deletions in Ocha. Old GitHub commits, forks and clones are not erased by this action.

## Startup and background behavior

`npm start` starts both watchers after plugin and store initialization. Each lane performs a startup reconciliation, then debounces filesystem changes for approximately 2.2 seconds before auditing and staging. The watchers run inside the Ocha Node.js process; they are not detached OS daemons and do not run while Ocha is stopped. A controlled source-update handoff calls `flush()` for both enabled lanes before restarting the process.

Both targets default to enabled when the private config is first created. This is an enabled policy, not proof of remote readiness: a lane pushes only when its local repository is a valid independent Git checkout, the branch and `origin` match the fixed allowlist, and its own token is available. A missing token, ZIP-extracted folder without Git metadata, or invalid remote does not delete local changes. Failed pushes are retained locally and retried at the next startup or source change. No force-push is used. Diverged history fails closed and requires manual reconciliation.

Persistent enable/disable state is stored in `.private/automation/auto-push.json` with directory mode `0700` and file mode `0600` where supported. The file contains only target enable flags and fixed repository metadata; it never stores tokens. If its JSON/schema is corrupt, the file is quarantined and both publication lanes are forced OFF so Ocha startup continues safely.

## Environment credentials

The only credential required by these two lanes is the shared `GITHUB_PAT` in `.env`. The non-secret local AC source path is configured separately in `config/runtime.json`:

```json
{
  "nadi": {
    "sourceDir": ".private/artificial-consciousness-component"
  }
}
```

Recommended fine-grained token scope: grant **Contents: read and write** (and repository metadata read) only for the two named repositories. A single shared token now authenticates both lanes; do not grant unrelated organization-wide access. Tokens are supplied to Git through a temporary `GIT_ASKPASS` script in the OS temporary directory; they are not written into remote URLs, source files, configuration JSON, commit messages or logs. The temporary helper is removed after the operation.

The AC repository must be private on GitHub when its source is intended to remain confidential. Encryption of the Git payload is not a substitute for repository access control: a client that must execute the decrypted source necessarily needs access to the plaintext. Keep the code in the private repository and protect credentials with least privilege.

## One-time AC nested-repository setup

Extract the Ocha operator archive. It contains the AC source under `.private/artificial-consciousness-component` but intentionally does not contain Git metadata. Ensure `GITHUB_PAT` in the local `.env` has access to both repositories, then run:

```bash
npm run ac:git:setup
```

The setup routine does not blindly run `git init` over an existing remote history. It checks the canonical remote and branch, clones `main` into a temporary location, compares package versions, backs up the original source snapshot, applies a higher-version snapshot to the cloned worktree, then atomically promotes the clone into the nested path. If the remote is newer, a same-version tree differs, a different remote branch exists, authentication fails, or validation is inconclusive, setup aborts and retains the original snapshot. An empty remote may be initialized with `main`; the first automatic sync creates the initial commit.

After successful setup, restart with `npm start`. The AC watcher requires that `.private/artificial-consciousness-component` resolves to its own Git top-level directory and has the exact `origin` remote and `main` branch. If Git queries resolve to the parent Ocha root, the nested AC watcher remains disabled until setup is completed.

For Ocha, preserve the existing `.git` history by running the source from a clone of the canonical Ocha repository. `npm run git:setup` remains available for compatibility, but it refuses to create a new orphan history when the existing GitHub `main` branch already has commits. Do not force-push a ZIP-extracted snapshot to a non-empty remote.

## Owner-private controls

The command descriptor is `src/plugins/owner/autopush.js`:

| Command                        | Effect                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `.autopush status`             | Shows both lanes, token availability (boolean only), branch, readiness and pending-change count |
| `.autopush on ocha\|ac\|all`   | Enables selected lane(s) and persists the setting                                               |
| `.autopush off ocha\|ac\|all`  | Pauses selected lane(s); local source and commits remain                                        |
| `.autopush push ocha\|ac\|all` | Requests an immediate audited push for selected lane(s)                                         |
| `.autopush setup`              | Prints one-time setup instructions                                                              |

Aliases `gitpush` and `autogit` remain available for compatibility. The descriptor has `ownerOnly: true`, `privateOnly: true` and `menu: false`: it is not shown in `.menu`, cannot be called by non-owners, and cannot be called from a group. The v1.10.60 static source audit found 48 command descriptors, 89 aliases, 137 normalized identifiers and zero collisions (49 JavaScript plugin files scanned).

## Existing script compatibility

The previous scripts remain in `package.json` unchanged: `npm run git:setup` and `npm run git:watch`. The second lane and diagnostic helpers are additive:

```bash
npm run ac:git:setup
npm run ac:git:watch
npm run git:status
npm run git:push:ocha
npm run git:push:ac
npm run git:push
```

`git:status` and the manual push scripts use the dual-lane service without launching filesystem watchers in the short-lived CLI process. The legacy `git:watch` remains an Ocha-only watcher, as before; `npm start` is the standard way to run both lanes together.

## Staging and publication safeguards

- Ocha uses path-scoped `git add -A -- <path>` and aborts if private paths are staged or tracked in the Ocha root index (`git ls-files -- .private` is checked before any commit). The AC path is ignored before Ocha watcher traversal and by `.gitignore`.
- AC stages only paths relative to its own repository root. It rejects symlinks, special files, secret matches, ignored runtime state and paths escaping the nested root.
- Excluded AC material includes `.git`, `.env*` except `.env.example`, `ac_config.json`, local configuration, `data/`, `logs/`, NADI state/ledger files, database files, caches, virtual environments, build artifacts and binary archives.
- Both lanes validate the exact allowlisted HTTPS remote and branch. They do not rewrite remotes, merge divergent histories automatically, or force-push.
- The Ocha operator ZIP includes private source for local deployment convenience but must never be uploaded to the public Ocha GitHub repository. Release packaging excludes nested `.git` metadata and operator secrets/configuration. The standalone AC ZIP is a separate artifact.

## Operational limitations

- A GitHub push is only confirmed after the remote reports success. A watcher being `READY` does not prove that credentials or network connectivity work.
- Auto-push runs only while the Node.js process is alive. Use systemd/PM2 or the existing host process manager to keep Ocha running; this implementation itself does not create an OS service.
- Commit identity (`user.name` and `user.email`) must be configured in both Git roots.
- A source ZIP has no Git history. The AC setup bootstraps from the remote with history preservation; an Ocha ZIP must be applied to a proper Ocha clone before normal auto-push can be used.
- No GitHub push is performed during offline source-package creation. The operator host must execute setup and push with its own scoped tokens.
