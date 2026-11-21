# Transactional Source Hot Reload

The source watcher treats a multi-file copy/replace as one update transaction rather than restarting once per changed file.

## Detection and stabilization

- Watches all regular files under `src/` and `scripts/`, plus `package.json`, `package-lock.json`, and `npm-shrinkwrap.json`. Plugin JavaScript modules are live-swappable; core source, plugin assets/manifests, and bootstrap scripts request a controlled restart.
- Uses a 4.2-second quiet window, Chokidar write-finish detection, and two file snapshots separated by a 700 ms stability check.
- Every filesystem event increments a batch revision. If a new file event arrives while a snapshot or syntax validation is running, the current attempt is abandoned and the complete batch is re-evaluated. New events are never cleared by an older flush.
- A five-minute maximum batch window prevents an endlessly active filesystem from postponing all maintenance forever. Changed JavaScript files pass `node --check`, shell scripts pass `bash -n`, and JSON files are parsed before commit.
- Invalid JavaScript is rejected; the active process and previous plugin registry remain available. Rejected batches are not released to Auto Git Sync.

## Applying changes

- `src/plugins/**/*.js` changes are imported into a shadow registry. The registry is swapped synchronously only after the new tree has been evaluated. A failed plugin retains its last known-good version; deleted plugins are removed.
- Changes to non-plugin files under `src/`, files under `scripts/`, plugin assets/manifests, and dependency manifests require a controlled process handoff. Node ESM imports and active runtime services cannot be safely replaced in-place.
- A batch containing core code starts exactly one replacement process. If package manifests changed, dependency reconciliation runs once before the replacement is launched.
- Auto Git Sync is paused while a source batch is being written and resumes only after validation/commit. Syntax-rejected source batches are not pushed.

## Single-instance and WhatsApp socket handoff

`data/runtime/ocha-main.lock` is created atomically with PID, Linux process start ticks, project root, and a random ownership token. A normal second `npm start` is rejected while the existing bot owns the lock. A controlled replacement waits specifically for the old PID and cannot open its WhatsApp socket until the previous process releases the lock. During the first upgrade from a legacy watcher that predates this lock, the new process recognizes its direct parent running this project’s `src/index.js` and waits for that parent to exit even if the old version never created a lock file. Stale locks are removed only after PID/start-time checks and an unchanged-file comparison.

The old process starts the replacement first, then:

1. waits for the child to spawn and begin waiting for the single-instance lock;
2. closes Code Lab sessions and the local preview listener;
3. transfers runtime ownership, then closes the current Baileys socket;
4. atomically releases its process lock;
5. exits, allowing the replacement to acquire the lock and create the only WhatsApp socket.

The replacement PID is verified before Code Lab begins closing anything. If the replacement cannot spawn or the handoff fails before lock release, it is terminated and the old process rolls back Code Lab ownership, rebinds the loopback gateway, and re-adopts the same tunnel only after the replacement is confirmed stopped. The lock token prevents one process from deleting another process's lock.

## Cloudflare and Code Lab continuity

The Quick Tunnel remains on-demand: no public tunnel is created before a preview is requested. Once started, a healthy `cloudflared` child runs detached with file-backed logs and an exclusive PID/start-time/token lease. A controlled core-source handoff transfers the owner PID in the lease and `owner.json`; the new process adopts the existing URL and PID instead of creating a second Quick Tunnel. The loopback gateway is briefly rebound by the replacement process, but the public hostname does not need to change.

The watchdog uses protocol v2 and follows the atomically updated `owner.json`. Protocol-v2 watchdogs survive a controlled process handoff; legacy watchdogs are verified and replaced before the new process takes ownership. The watchdog never kills a PID unless the process identity matches its recorded Cloudflare command. Temporary Code Lab sessions are cleaned during a core restart; the tunnel URL itself is preserved while the process remains healthy.

A first transition from a release that predates the handoff protocol cannot be guaranteed to preserve an already-running tunnel because that old process has no compatible ownership-transfer code loaded in memory. The first upgrade may therefore recreate a Quick Tunnel once, but the replacement still waits for the legacy parent to exit before creating a WhatsApp socket. Subsequent updates made while v1.10.12 or newer is active use the full handoff protocol.

## Host preflight

`npm start` runs the host preflight before Code Lab starts. The preflight cache is keyed by OS, architecture, configured images/runtime, and the presence of host CLI binaries. It does not rerun package installation during a normal controlled source handoff. If the `scripts/bootstrap/` implementation itself is part of the changed batch, the replacement is instructed to force one preflight run using the updated script. A successful host setup is checked again after 24 hours; degraded host capabilities are retried after six hours, and a failed bootstrap process is retried after one hour.

On supported Linux distributions, the preflight installs missing Git, Python 3, Go, Cloudflared, and Docker/Podman packages when the package manager and non-interactive administrative permissions are available. If Bash is missing, the Node preflight attempts to install it using the supported package manager before invoking the shell bootstrap. Unsupported package managers and denied host privileges are reported instead of bypassed.

Node.js 20.18+ and npm must already exist to invoke `npm start`; no npm lifecycle script can install the runtime required to execute npm itself. A VPS/container that denies namespace, cgroup, netlink, or storage capabilities cannot be made container-capable by the application. Python/Node Code Lab container execution remains fail-closed in that case, while WhatsApp and AI stay online.
