# Command Governance and AI Authoring — v1.10.17

## Global menu settings

The menu configuration is stored globally in `config.menu`, not in user profiles:

- `showDescriptions`: default `false`.
- `pagination.enabled`: default `false`.
- `pagination.pageSize`: default `50`, accepted range 10–200.

Owner commands:

```text
.setmenu descriptions on|off
.setmenu pages on|off
.setmenu limit 50
.setmenu status
```

All users receive the same settings. Pagination replies are bound to the sender and the exact menu message and expire after 15 minutes. Page numbers are recalculated from the live plugin registry when a page is requested.

## Adaptive cooldown

Enable with `.guard cooldown on`. The cooldown key is `(sender, chat, canonical command)`, so one command does not block another command or another user. The workload score combines command metadata and workload signals (network/search, media, repository/database, code execution, and AI/model activity). A bounded nonlinear curve maps the score to a 1.2–45 second cooldown. No per-plugin duration table is required.

A denied request emits one notice per remaining cooldown period; repeated attempts during that same period are silent. The owner can disable the global feature with `.guard cooldown off`. Cooldown applies globally, including owner commands, except the `.guard` control command itself so the setting remains recoverable.

## Anti-spam

Anti-spam is independent from cooldown and is enabled with `.guard antispam on`. It detects repeated identical commands within 3 seconds and bursts of at least four commands within 6 seconds. The first detected incident sends a one-time initial warning and is not counted as a strike. Subsequent violations are counted at most once per 30 seconds. Five counted warnings in the Asia/Jakarta calendar day trigger a temporary suspension.

Suspension durations escalate: 5 minutes, 15 minutes, 1 hour, 6 hours, then 24 hours. The ban level persists, while the daily warning counter resets at Jakarta midnight. A live suspension suppresses all bot interactions from that sender, including AI replies, until `bannedUntil`; it is not a permanent ban. Owner identity bypasses anti-spam sanctions to preserve administrative recovery.

Sanctions are stored as namespaced JSONL repository records (`command.guard.user`) and warmed at startup only when anti-spam is enabled. The in-memory cache avoids scanning the journal for each message.

## AI-assisted command creation

Owner-only private-chat command:

```text
.createcmd buat command kalkulator
.createcmd list
.createcmd show <draft-id>
.createcmd apply <draft-id>
```

Or reply to source code with `.createcmd <instruction>`, or pass source inline as `.createcmd => <source>`.

The authoring agent receives the active plugin inventory, metadata conventions, and the list of existing plugin directories. It chooses an existing folder; it cannot create a new category folder. It must produce a complete ESM plugin with `name`, `aliases`, `category`, `usage`, `description`, and `execute()` metadata. Owner-folder plugins must set `ownerOnly: true` and `privateOnly: true`.

For supplied source, the prompt requires preservation and the generated source must contain the original snippet byte-for-byte. If the model rewrites or omits it, the draft is rejected. Syntax errors are reported; source is never silently repaired.

Drafting does not execute code. Static import/policy checks, ESM syntax check, local WorkloadTracker analysis, and Ocha Workload Assessor review run before the draft is stored. If the AI assessor is unavailable, local conservative analysis is used. Critical workloads are rejected. Other drafts require explicit owner review with `.createcmd show` and installation with `.createcmd apply`.

Installation never overwrites an existing plugin or alias. The target must be an existing plugin folder. The generated source is syntax-checked again before atomic rename; the normal transactional plugin watcher then loads it from the live registry.
