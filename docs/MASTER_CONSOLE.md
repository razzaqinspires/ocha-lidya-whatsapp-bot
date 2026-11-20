# Ocha Master Console

## Canonical runner controls

The runner switches are independent. There is no global `exec` gate in schema v11.

| Prefix | Runtime | Control | Meaning |
|---|---|---|---|
| `>` | JavaScript eval | `.master eval on/off` | Evaluate JavaScript |
| `=>` | JavaScript return | `.master eval on/off` | Return an expression value |
| `$` | CLI shell | `.master cli on/off` | Run a shell command |
| `>>` | Python | `.master python on/off` | Run Python |
| `>>>` | Go | `.master golang on/off` | Run Go |

`.master status` displays the canonical control panel. `.master exec on/off` remains as a temporary compatibility alias for `.master cli on/off`; it no longer enables a separate global switch. New installations and documentation must use `cli` only.

Every runner is owner-only and private-chat-only. Each runner has independent timeout/output limits. The JavaScript `vm` context is a convenience context, not a security boundary; eval remains disabled by default and must only be enabled for trusted owner operation.

## Console output

Each process invocation is reported with runtime name, command, exit code, success/failure, stdout, and stderr. Local application logs include start/completion records with chat type. The terminal output is deliberately separate from WhatsApp message content and does not use interactive-message payloads.


## v1.7.2 — Runtime context and workload confirmation

JavaScript eval (`>` / `=>`) receives live `sock`, `m` / `message`, `config`, `logger`, `db`, `fs`, `path`, `os`, `crypto`, `childProcess`, `process`, `Buffer`, `require`, and `importModule`. These are real host objects and APIs. Eval is owner-only but is not a sandbox; it can modify bot state and host files.

WorkloadTracker classifies all runner source. Low-risk code runs immediately. Suspicious code is reviewed by Ocha using a short, separate AI request. If Ocha explicitly returns `ALLOW` with low/medium severity, the command proceeds automatically. Otherwise Ocha returns an impact summary, risk level, and safer alternative; the owner must reply to the quoted warning with the exact one-time `CONFIRM CODE` or `CANCEL`. Confirmation expires after 120 seconds. If the assessment provider is unavailable, execution is denied. Critical host-wide operations such as root filesystem deletion, disk formatting/wiping, fork bombs, and host shutdown are blocked statically and cannot be overridden in chat. Scoped destructive operations such as `rm -rf ./*/` are escalated for AI review and explicit confirmation.

The AI review is advisory and can be wrong. Confirmation is an accident-prevention step, not a sandbox or guarantee of safety.
