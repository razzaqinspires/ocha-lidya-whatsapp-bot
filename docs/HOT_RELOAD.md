# Source Hot Reload

The source loader in `src/core/plugin-loader.js` monitors JavaScript files throughout `src/` recursively. It does not watch only command plugins.

- `src/plugins/**/*.js`: add/change/remove events update the live plugin registry. A failed replacement leaves the previous valid plugin registered.
- Other `src/**/*.js`: add/change/remove events request a controlled Node.js process restart. This refreshes ESM imports and dependent modules safely.
- JSON, Markdown, YAML, and other files: not imported by the JS loader, but observed by the repository-wide Git watcher for automatic commit/push if they are not excluded by `.gitignore`.
- `node_modules/` and `.git/`: excluded from source-loader and repository filesystem watching.
- `sessions/`, quarantined `sessions.*` backups, `data/`, `logs/`, cache/build/temp/artifact directories: excluded from repository-wide watching. These contain high-churn runtime files and must never consume one inotify watcher per auth/session file.
- `.env` is observed only for token refresh; `.env.*` secrets are excluded from watcher traversal except the explicitly trackable `.env.example` file.

Node.js ESM caches imported modules. Re-importing a core module under a new URL does not update references already held by other modules. Therefore core code is not represented as safely hot-swappable; a controlled restart is used instead. Plugin modules are isolated behind the plugin registry and can be replaced dynamically.

The controlled restart starts a replacement Node.js process and exits the old process. For production use, a process manager such as systemd or PM2 is still recommended to supervise unexpected crashes and restart failures.

## Watcher exhaustion and session privacy

The repository watcher must not recurse into Baileys multi-file auth state. Watching `sessions/ocha-lidya/` creates a watcher for every `pre-key`, `session`, `identity-key`, and `lid-mapping` file; under a long-lived session this can exhaust Linux `fs.inotify.max_user_watches` and emit `ENOSPC`. The runtime watch policy now excludes session directories and timestamped session backups before Chokidar descends into them. On an `ENOSPC` event, the affected watcher logs one compact diagnostic and closes rather than emitting an error storm.

The `408 / ECONNRESET` entries in the supplied 23:04 log begin before the first `ENOSPC` watcher error at 23:10:49. Therefore the watcher exhaustion does not explain the initial WebSocket disconnect. It is a separate defect that can add resource pressure after reconnect. The earlier 408 sequence is consistent with the TCP/WebSocket connection being reset by the network path or remote endpoint; the supplied log does not identify whether the cause was VPS networking, routing, WhatsApp edge, or another process. A `.owner` command is not shown as the cause.
