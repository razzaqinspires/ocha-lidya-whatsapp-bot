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

## Menu design system and `.setmenu` — v1.10.58

The menu renderer remains registry-driven. Presentation settings are stored in `config.menu` by `src/config.js` and rendered by `src/core/menu-renderer.js`; native-flow delivery and the banner/text fallback are handled by `src/plugins/general/menu.js`.

Supported menu controls:

| Setting                     | Values                                                                                                                                                                             | Effect                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `template`                  | `corporate`, `minimal`, `terminal`, `elegant`, `aurora`, `classic`, `compact`, `minimalist`, `cyberpunk`, `fantasy`, `ocean`, `sunset`, `emerald`, `sakura`, `monochrome`, `royal` | Changes heading and border motif                                                                  |
| `font`                      | `normal`, `bolditalic`, `bold`, `sans`, `mono`, `superscript`, `double`, `smallcaps`, `fraktur`, `italic`, `script`, `circled`                                                     | Changes display typography; executable command identifiers remain plain ASCII                     |
| `order`                     | `category`, `az`, `za`                                                                                                                                                             | Groups by category or sorts all command names ascending/descending in the text renderer           |
| `spacing`                   | `0`–`3`                                                                                                                                                                            | Controls blank spacing between command rows in the text renderer                                  |
| `showDescriptions`          | `true` / `false`                                                                                                                                                                   | Shows or hides plugin descriptions                                                                |
| `topBorder`, `bottomBorder` | `true` / `false`                                                                                                                                                                   | Controls the top and bottom design lines                                                          |
| `pagination.enabled`        | `true` / `false`                                                                                                                                                                   | Enables pagination in the text fallback renderer; native Flow retains bounded category pagination |
| `pagination.pageSize`       | `10`–`200`                                                                                                                                                                         | Text fallback commands per page; native Flow shows at most seven command rows per page            |

`.setmenu` aliases remain `menuset` and `menuconfig`. The plugin retains `ownerOnly: true` and `privateOnly: true`, and independently verifies the configured owner from message sender metadata before updating the config event store. Supported direct forms are `.setmenu template <name>`, `.setmenu font <name>`, `.setmenu order <category|az|za>`, `.setmenu descriptions <on|off>`, `.setmenu pages <on|off>`, `.setmenu limit <10-200>`, `.setmenu spacing <0-3>`, `.setmenu border <top|bottom> <on|off>`, `.setmenu status`, and `.setmenu reset`.

The interactive native-flow list uses at most seven command rows plus navigation rows so the combined list stays within the existing WhatsApp row contract. It remains paginated whenever a category has more commands. The `pages` and `limit` settings govern the text fallback renderer; they do not disable native-flow navigation. Description visibility is also applied to native-flow row descriptions. Spacing is applied to the category text header/fallback; command names and selection IDs remain unmodified ASCII so they can be executed reliably. `.setmenu` changes presentation only; it does not add/remove commands or change command permissions.

This update adapted selected menu presentation concepts from the supplied Whiskay archive only. Whiskay's energy/profile/economy widgets, custom image uploads, canvas integration, quote experiments, data stores, dependencies and unrelated command handlers were not copied.
