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

Every runner is owner-only. By default all runner syntax and the `.master` console are blocked in groups; the verified owner may enable the group gate from a private chat using `.master group on`, inspect it with `.master group status`, and turn it off with `.master group off`. Only the verified owner can use it after the group gate is enabled. Each runner has independent timeout/output limits. The JavaScript `vm` context is a convenience context, not a security boundary; eval remains disabled by default and must only be enabled for trusted owner operation.

## Group access and warning controls

- `.master group status|on|off` controls the owner-only Master console in WhatsApp groups. Default is `off`; change it from the owner's private chat.
- `.master warning off` skips confirmation prompts for suspicious workloads that are not statically hard-blocked. Those workloads continue without a prompt and are recorded in the audit log. Critical host-wide hard-block patterns are still denied. This mode deliberately removes an interactive safety checkpoint; use it only when the owner accepts that risk.
- `.master warning compact|detailed|on` restores warning/confirmation UI.
- `.master review off` disables AI semantic review only; it does not turn warning prompts off.
- `.master eval off` disables the JavaScript eval runner itself.

## Console output

Each process invocation is reported with runtime name, command, exit code, success/failure, stdout, and stderr. Local application logs include start/completion records with chat type. The terminal output is deliberately separate from WhatsApp message content and does not use interactive-message payloads.


## v1.7.2 — Runtime context and workload confirmation

JavaScript eval (`>` / `=>`) receives live `sock`, `m` / `message`, `config`, `logger`, `db`, `fs`, `path`, `os`, `crypto`, `childProcess`, `process`, `Buffer`, `require`, and `importModule`. These are real host objects and APIs. Eval is owner-only but is not a sandbox; it can modify bot state and host files.

WorkloadTracker classifies all runner source. Low-risk code runs immediately. Suspicious code is assessed by Ocha when AI semantic review is enabled. In compact/detailed warning modes, flagged workloads use a one-time owner confirmation flow (120-second expiry) unless the configured assessment policy explicitly auto-approves a bounded low-risk action. Since v1.10.47, `.master warning off` skips the confirmation prompt for non-hard-blocked suspicious workloads and continues execution while recording an audit event. Static hard-block patterns remain non-bypassable in every mode. Scoped destructive operations can still be blocked or escalated by local/AI policy. The exact current behavior is defined in **Group access and warning controls**.

The AI review is advisory and can be wrong. Confirmation is an accident-prevention step, not a sandbox or guarantee of safety.

## Konfirmasi owner ketika provider AI tidak tersedia

Riwayat perilaku sebelum v1.10.47: workload mencurigakan selalu meminta konfirmasi ketika AI review tidak tersedia. Perilaku saat ini mengikuti mode warning. Pada `compact`/`detailed`, konfirmasi dapat diminta; pada `off`, prompt dilewati untuk workload non-hard-blocked. Hard-block tetap berlaku.

Penting: pemeriksaan lokal bukan pengganti analisis AI penuh. JavaScript eval berjalan dalam proses bot dengan kapabilitas runtime yang tersedia; konfirmasi hanya mengizinkan eksekusi kode yang dipahami owner, bukan menjadikannya sandbox aman.


## v1.10.29 — owner-controlled workload warning and CTA Copy

The owner can control warning presentation independently from AI semantic assessment. `.master warning off` skips confirmation prompts for non-hard-blocked work and records an audit event. Hard-blocks remain non-bypassable. `.master review off` disables only AI semantic assessment. The current behavior is documented in **Group access and warning controls** above.

Warnings in compact and detailed modes are sent using a native-flow `cta_copy` button that copies the exact one-time `CONFIRM CODE` phrase, plus quick-reply buttons for explicit confirmation or cancellation. If native-flow sending fails, a text fallback is used. Confirmation stays bound to the owner sender, chat, code hash, warning message and 120-second TTL.

The workload classifier no longer treats every `sock.relayMessage()` or `sock.sendMessage()` call as inherently suspicious. A send call explicitly scoped to `m.chat` in the verified owner's private chat is considered a bounded current-chat action. Arbitrary recipients and group-context sends remain flagged. Other suspicious APIs, destructive patterns, and host-wide hard-blocks are not relaxed.
