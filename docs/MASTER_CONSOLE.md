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
