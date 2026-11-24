# Chokidar installation and watcher behavior

Ocha Lidya uses `chokidar@4.0.3` as the primary filesystem watcher for plugin hot reload and Auto Git Sync. The exact version is pinned in `package.json` to keep the runtime compatible with the project's Node.js `>=20.18.0` engine range.

## Install on the target host

From the repository root:

```bash
npm install --no-audit --no-fund
npm ls chokidar
```

To install or repair only this package explicitly:

```bash
npm install --save-exact chokidar@4.0.3 --no-audit --no-fund
npm ls chokidar
```

A successful install should show `chokidar@4.0.3` in the dependency tree. Keep the generated `package-lock.json` under version control so future deployments can use `npm ci`.

## Offline fallback

If `chokidar` cannot be resolved, `src/core/file-watcher.js` falls back to Node.js `fs.watch`. The fallback is designed for the existing `.on('all')`, `.on('ready')`, `.on('error')`, and `.close()` integration. It excludes paths passed by the existing ignore policies and normalizes file creation, modification, and removal events.

When `chokidar` is the only missing dependency, the `prestart`/`predev` preflight no longer prevents Ocha from starting. It logs the install command and uses the native watcher temporarily. This fallback does not replace Chokidar's full cross-platform event normalization; install the pinned package for normal production operation. Missing non-watcher dependencies remain fatal.

Look for the process warning code `OCHA_WATCHER_FALLBACK` to identify fallback mode. Once the package is installed, restart Ocha; the adapter automatically selects Chokidar without changing configuration.
