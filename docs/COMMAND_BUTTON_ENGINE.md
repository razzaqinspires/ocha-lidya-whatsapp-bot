# Adaptive Full-Button Command Engine — v1.10.21

## Purpose

The engine gives eligible command replies an interactive follow-up UI without replacing the serializer globally. The verified owner can enable it for the complete plugin registry with `.buttons full all`. A command alias uses the same plugin policy as its canonical command because the dispatcher resolves aliases to the plugin before installing the temporary reply adapter.

This is an adaptive policy, not a rule that every message must become a button. The engine can choose Quick Reply, Single Select, or the original text transport. That distinction is deliberate: code, diagnostics, long reports, progress updates, and command screens that already own their navigation should not be converted into fragile interactive payloads.

## Owner commands

```text
.buttons full all
.buttons full status
.buttons full audit
.buttons full off
.buttons full exclude list
.buttons full exclude add <command-or-alias>
.buttons full exclude remove <command-or-alias>

.buttons on
.buttons off
.buttons status
```

`.buttons full all` enables `ui.fullButton.enabled` with the adaptive strategy. `.buttons full audit` runs a dry inventory against the active plugin registry; it does not send test messages or modify plugin metadata. `.buttons full off` disables only automatic wrapping. Explicit UI owned by a plugin continues to work. The legacy `.buttons on/off/status` and aliases (`.button`, `.fullbutton`, `.commandbutton`, `.buttonmode`, `.uibuttons`) remain supported; `on/off` now map to the adaptive full-button switch.

The exclusion add/remove commands accept a canonical command or any registered alias. The engine persists the canonical plugin name, so all aliases share the same exclusion. System-level exemptions cannot be removed from chat.

## Decision policy

1. **Hard exemption** — commands that own a separate UI, media payload, contact card, or reply-session are never wrapped: `buttons`, `menu`, `sewa`, `yts`, `test`, `groupinfo`, `profile`, and `owner`.
2. **Plugin exemption** — a plugin can set `fullButton: false` or `ui.fullButton: 'exclude'` in its metadata. This is intended for explicit carousel, Native Flow, image-card, or custom navigation implementations.
3. **Owner exclusion** — `ui.fullButton.excludedCommands` stores extra canonical plugin names excluded by the owner.
4. **Content safety** — non-string replies, quoted/fake replies, calls with send options, code fences, stack traces, diagnostics, progress messages, outputs over `maxBodyChars`, and long structured output remain text.
5. **Action discovery** — explicit `plugin.ui.fullButton.actions` is preferred. Otherwise, the engine extracts only allow-listed read-only verbs from the first `<a|b|c>` usage group. Destructive or state-changing verbs such as `approve`, `reject`, `delete`, `remove`, `cancel`, `join`, `set`, `on`, `off`, `apply`, `run`, `zip`, and `export` are never inferred from usage text.
6. **Navigation fallback** — when usage metadata has fewer than two safe actions, the engine adds category-appropriate navigation actions (`menu`/`about`/`owner`, developer `runtime`, or owner `dbstatus`). Authorization is still re-evaluated normally when a user taps a command.
7. **Presentation choice** — one to three actions are Quick Reply buttons. Four to eight actions are grouped into one Single Select list. The original response body is preserved in the interactive message.
8. **Transport fallback** — exceptions thrown by the interactive sender call the original serializer `m.reply()` with its original text and quote arguments.

The current `groupadmin` plugin defines three explicit, read-only follow-ups: group info, saved rules, and the admin help screen. Project and owner tools can opt into safe usage verbs without creating a second command registry.

## Runtime scope and preservation

The dispatcher temporarily wraps `message.reply` only after authorization, anti-spam, cooldown, and tenant-quota checks have passed. The original method is restored in a `finally` path, including plugin exceptions. `m.freply()`/quoted replies and reply calls with options bypass the adapter. Direct `sock.sendMessage`, `m.sendInteractive`, `sock.carouselBuilder`, image/document/audio/video messages, polls, and contact cards are not intercepted.

No button ID grants permission. A tap re-enters the ordinary dispatcher as a new command message, where the current owner/admin/private/group and rental checks run again. Aliases are resolved by the normal plugin registry.

## Configuration

Schema v28 adds:

```js
ui: {
  buttonsEnabled: true, // legacy compatibility flag
  fullButton: {
    enabled: false, // opt-in; existing installs stay text-first after migration
    strategy: 'adaptive',
    maxBodyChars: 1800,
    excludedCommands: []
  }
}
```

`maxBodyChars` is validated from 300 to 3,500. The exclusion list contains canonical plugin names, not individual alias entries. The setting contains no secrets and is persisted through the existing JSONL configuration facade.

## Compatibility note

Native Flow rendering is not guaranteed by relay success alone. The feature stays opt-in, has explicit plugin exemptions, and falls back to text on a reported relay/serialization exception. A WhatsApp client may accept a relay but still render a Native Flow control differently or not at all; validate the target account and client versions after enabling the feature. `.buttons full audit` is the first step before live testing.
