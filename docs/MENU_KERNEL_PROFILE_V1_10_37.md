# Menu, Kernel, and Profile Canvas — v1.10.37

## Command menu

- `.menu` opens the native-flow category selector.
- `.menu general [page]` opens general commands.
- `.menu developer [page]` opens developer commands.
- `.menu owner [page]` is available to the verified owner.
- The command rows emit canonical command IDs only; argument placeholders are descriptive and are not inserted into a command selection. Commands that require arguments continue to show their normal usage response.
- The menu is sourced from the active plugin registry. The dispatcher remains responsible for command permissions, group policy, rental entitlements, quotas, cooldowns, and anti-spam.
- Clients without native-flow support receive a text fallback with the category shortcuts.

## Kernel

`.kernel` now sends an acknowledgement and current aggregate telemetry before asking Code Lab to publish the public route. If the shared TryCloudflare tunnel is ready, the command follows with a native URL button and a text URL. If publishing fails, the user receives an explicit status and the shortened gateway error. The public page remains read-only and excludes chat content, phone numbers, JIDs, and private account memories.

The WebView still requires `codeLab.enabled`, `codeLab.publicTunnelEnabled`, and a working `cloudflared` binary. The initial local status reply does not depend on the tunnel.

## Profile canvas

`src/ai/profile-card.js` now generates the 1080×1520 SVG card. It shows account display name, role, rank, level, XP progress, activity counts, streaks, familiarity, trust, next-role progress, and achievements. User-controlled fields are XML-escaped; percentages are clamped.

PNG output requires the optional `sharp` package. If Sharp is absent or cannot load, `.profile` still returns its complete text profile instead of failing.

## Target-host smoke test

1. Run `.menu` and open a category using the list button.
2. Select a no-argument command such as `.profile` or `.kernel` from the command list. Confirm the normal dispatcher handles the selected ID.
3. Run `.menu owner` from a verified owner account and confirm it is not exposed to ordinary users.
4. Run `.kernel`; the telemetry acknowledgement should arrive before any tunnel startup delay. Confirm the follow-up WebView button opens the live page.
5. Run `.profile` with Sharp installed and confirm the PNG image renders; uninstall/disable Sharp only in a test environment and confirm text fallback.
