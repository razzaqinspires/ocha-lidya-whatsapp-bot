# Source Hot Reload

The source loader in `src/core/plugin-loader.js` monitors JavaScript files throughout `src/` recursively. It does not watch only command plugins.

- `src/plugins/**/*.js`: add/change/remove events update the live plugin registry. A failed replacement leaves the previous valid plugin registered.
- Other `src/**/*.js`: add/change/remove events request a controlled Node.js process restart. This refreshes ESM imports and dependent modules safely.
- JSON, Markdown, YAML, and other files: not imported by the JS loader, but observed by the repository-wide Git watcher for automatic commit/push if they are not excluded by `.gitignore`.
- `node_modules/` and `.git/`: excluded from source-loader and repository filesystem watching.

Node.js ESM caches imported modules. Re-importing a core module under a new URL does not update references already held by other modules. Therefore core code is not represented as safely hot-swappable; a controlled restart is used instead. Plugin modules are isolated behind the plugin registry and can be replaced dynamically.

The controlled restart starts a replacement Node.js process and exits the old process. For production use, a process manager such as systemd or PM2 is still recommended to supervise unexpected crashes and restart failures.
