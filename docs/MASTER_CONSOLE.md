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

## Konfirmasi owner ketika provider AI tidak tersedia

Workload yang terdeteksi mencurigakan selalu membutuhkan konfirmasi eksplisit, termasuk ketika AI assessor memberi rekomendasi ALLOW. Jika provider utama Groq gagal atau limit habis, Ocha tidak berpindah provider. Ocha menggunakan pemeriksaan heuristik lokal sebagai informasi sementara dan tetap meminta owner membalas pesan peringatan dengan `CONFIRM <kode>` atau `CANCEL` dalam 120 detik. Konfirmasi terikat pada chat, pengirim, pesan peringatan, runtime, hash kode, dan hanya dapat dipakai sekali. Jalur ini tidak membuka hard-block untuk perintah destruktif tingkat OS/disk. Konfirmasi eksekusi berisiko hanya tersedia di chat pribadi.

Penting: pemeriksaan lokal bukan pengganti analisis AI penuh. JavaScript eval berjalan dalam proses bot dengan kapabilitas runtime yang tersedia; konfirmasi hanya mengizinkan eksekusi kode yang dipahami owner, bukan menjadikannya sandbox aman.


## v1.10.29 — owner-controlled workload warning and CTA Copy

The owner can control workload warning delivery and AI semantic assessment independently:

- `.master warning status` — inspect the warning mode.
- `.master warning on` / `.master warning true` — enable compact warning cards with CTA Copy and action buttons.
- `.master warning compact` — show a concise risk summary.
- `.master warning detailed` — show impact and safer-alternative details.
- `.master warning off` / `.master warning false` — suppress all non-critical workload warning messages. Suspicious workloads are still blocked silently and recorded; this is not an execution bypass.
- `.master review status|on|off|true|false` — toggle the AI semantic assessor independently. Turning it off does not disable local heuristics, mandatory confirmation for flagged work, or critical hard-blocks.
- `.master eval off` — disables the JavaScript runner itself.

There is no static “eval template” switch. The warning text is generated at runtime. `.master review off` disables the AI assessment request; `.master warning off` suppresses its notification. Neither setting grants implicit execution approval.

Warnings in compact and detailed modes are sent using a native-flow `cta_copy` button that copies the exact one-time `CONFIRM CODE` phrase, plus quick-reply buttons for explicit confirmation or cancellation. If native-flow sending fails, a text fallback is used. Confirmation stays bound to the owner sender, chat, code hash, warning message and 120-second TTL.

The workload classifier no longer treats every `sock.relayMessage()` or `sock.sendMessage()` call as inherently suspicious. A send call explicitly scoped to `m.chat` in the verified owner's private chat is considered a bounded current-chat action. Arbitrary recipients and group-context sends remain flagged. Other suspicious APIs, destructive patterns, and host-wide hard-blocks are not relaxed.
