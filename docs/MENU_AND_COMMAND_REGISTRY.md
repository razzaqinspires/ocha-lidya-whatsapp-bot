# Live Command Menu

`.menu` is rendered from `listPlugins()` in `src/core/plugin-loader.js`. The menu does not maintain a second hard-coded command inventory. Every loaded plugin is represented once by its canonical `name`; aliases remain accepted by the dispatcher but are not repeated as separate commands.

## Plugin metadata

A plugin can provide optional `usage` metadata to display its argument form:

```js
export default {
  name: 'example',
  aliases: ['ex'],
  category: 'owner',
  ownerOnly: true,
  usage: '<action> [value]',
  async execute({ m, args }) {
    // ...
  },
};
```

Set `menu: false` only for internal plugins that should not be exposed in the user-facing command directory. The renderer groups commands by the plugin's `menuCategory` (when provided), otherwise `category`. The default labels are GENERAL, DEVELOPER, and OWNER / SYSTEM.

The registry itself is refreshed atomically on startup, manual `.reload`, and transactional plugin-tree hot reload. A command added or removed from the plugin tree is reflected in the next `.menu` request after the registry refresh commits. There is no separate menu cache to update.

The master console syntax is not a plugin and is appended as a dedicated section: `=>`, `$`, `>>`, and `>>>`.

## Menu banner

The branded artwork is stored at `assets/menu-banner.jpg`. The menu sends it before the text command directory. If the asset is unavailable or WhatsApp image transport fails, the plugin falls back to the text menu.

## Optional private command descriptors

The owner-only `.test` Message Test Lab is deliberately not stored in the public `src/plugins/` directory. When `@razzaqventures/ocha-private-runtime` is available, `src/core/plugin-loader.js` asks the package for its plugin descriptors and adds only plugins that declare both `ownerOnly: true` and `privateOnly: true`. The loader checks each canonical command and alias against the existing candidate registry; collisions are skipped and logged without overwriting a public command. The command is absent in public-compatible mode.

Run `npm run private-runtime:status` to inspect package resolution and use `.commandaudit scan` on the actual connected process to confirm the resulting live registry. Static command inventory: 47 public source plugin descriptors were present at this snapshot; `.autopush` is a hidden owner-private descriptor and does not contribute to the rendered menu. Canonical names and aliases were collision-audited together; no collision was found.; the optional private `.test` descriptor is excluded from those counts.

## Owner-private dual auto-push control — v1.10.57

The `.autopush` plugin (aliases `.gitpush`, `.autogit`) controls two separate Git targets. It is registered with `ownerOnly: true`, `privateOnly: true`, and `menu: false`, so it does not appear in `.menu` and is unavailable in group chats. Supported operations are `.autopush status`, `.autopush on|off <ocha|ac|all>`, `.autopush push <ocha|ac|all>`, and `.autopush setup`. The command is a control surface only; it never displays or accepts the PAT value. Target state is stored under ignored `.private/automation/auto-push.json`. Collision audit for the v1.10.57 source tree: 47 plugin files with canonical names/aliases enumerated; no collisions.
