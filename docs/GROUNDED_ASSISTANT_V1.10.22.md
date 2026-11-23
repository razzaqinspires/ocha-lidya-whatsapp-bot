# Grounded Assistant & WhatsApp Response Pipeline — v1.10.22

## Purpose

This release improves the AI as a bounded, runtime-grounded assistant. It does not claim AGI or artificial superintelligence. Capability depends on the active plugin registry, configured providers, message serializer, persistent storage, and explicit backend policy.

## Runtime truth and feature awareness

Before a model response is generated, the engine builds a compact capability context from the live plugin registry and registered AI capabilities. It includes canonical command names, aliases, descriptions, usage, visibility, access class, and whether a command may be invoked through natural language. Owner sessions can inspect the owner-visible inventory; non-owner sessions do not receive owner/system/developer command metadata.

The runtime registry is authoritative. The assistant must not invent a command or pretend a missing game/media feature exists. If a user replies to a quoted command directory with “ini apa?”, the engine checks whether the quoted text contains multiple real registered commands and returns a deterministic explanation of the Ocha command directory.

## Safe command invocation

A natural-language command request must be explicit (for example, `tolong jalankan perintah ping`). The parser does not treat an ordinary mention of a command as execution consent. The name is resolved against the current plugin registry, and the plugin must explicitly set `aiCallable: true`.

Current low-risk natural-language allowlist:

- `.ping` (aliases `.speed`, `.latency`)
- `.about` (alias `.botinfo`)
- `.profile` (aliases `.me`, `.level`, `.xp`)

All other plugins remain direct-command-only unless reviewed and explicitly allowlisted. Owner/system/developer actions are never invoked through the AI conversation path. The user must run them directly; the backend still verifies the current WhatsApp sender.

Approved calls use `executeRegisteredPlugin`, the same backend gate as direct commands. It rechecks authenticated owner identity, plugin permissions, group/private restrictions, tenant quota, anti-spam, cooldown, and command-button adapter lifecycle. A prompt, quote, remembered fact, or model response cannot grant permission.

## Conversation memory

Two memory layers are separate:

1. Short conversation continuity: recent turns and quote/reply-chain anchors, bounded in memory and persisted to the JSONL history journal. The current default prompt window is 8 recent turns; the internal cache is bounded to 40 turns per conversation and a finite number of conversations.
2. Long-term user memory: a namespaced per-sender repository, up to 20 short facts, only after an explicit instruction such as `ingat bahwa ...` or `simpan ...`. It is available in private chats only. `ingatkan aku besok ...` is not treated as consent to store a persistent fact.

Secrets, authentication material, medical details, and other blocked sensitive categories are rejected. The user can inspect memory with `apa yang kamu ingat tentang aku?`, remove a matching fact with `lupakan ...`, or clear explicit memory with `hapus semua memori yang kamu ingat`. Clearing this memory does not delete the separate conversation journal, WhatsApp messages, backups, or operational logs.

## WhatsApp text rendering

The AI delivery pipeline translates common Markdown output into WhatsApp's supported text syntax before sending:

| Meaning | WhatsApp syntax |
|---|---|
| Bold | `*teks*` |
| Italic | `_teks_` |
| Strikethrough | `~teks~` |
| Monospace | one backtick around inline code |
| Code block | triple backticks around the block |
| List | `- item` or `* item` |
| Numbered list | `1. item` |
| Quote | `> teks` |

`**teks**` and `__teks__` are converted to WhatsApp's single-marker bold form; Markdown headings, links, and tables are normalized to readable text. Code sections are protected from emphasis conversion. Unmatched doubled markers are collapsed instead of leaking as raw Markdown.

Reference: WhatsApp Help Center, “Cara Memformat Pesan”.

## Truncation and delivery integrity

Provider adapters preserve their completion reason. When a provider reports an output cap, or the answer contains an unclosed code fence/JSON structure, the engine can attempt up to two bounded continuations. Continuation is routed only to the provider that produced the partial result to avoid re-running the full provider chain. If completion still appears incomplete, the bot closes an open code fence and explicitly marks the answer as potentially incomplete.

The WhatsApp renderer splits long output at paragraph/line boundaries, preserves code-fence structure across chunks, sends chunks sequentially, and persists reply anchors for every delivered chunk with a WhatsApp message ID. Restart recovery reuses the same completion inspection, formatting, validated UI delivery, and multi-anchor path as live responses. This improves integrity but cannot prove that a remote WhatsApp client displayed every chunk; live transport/device testing remains necessary.

## Adaptive message type

Text remains the default. The optional `[[OCHA_UI]]` directive is parsed and validated server-side. Supported AI response plans in this release are:

- `quick_reply`: 1–3 safe follow-up questions.
- `list`: 2–10 safe follow-up questions, rendered as a single-select list.
- `copy`: only a code that is already visibly present in the same answer.
- `url`: only an exact HTTPS destination supplied by the user in the current message.

Selections are sender-bound, chat-bound, short-lived reply sessions. The callback is a conversational follow-up, not a privileged action. Copy and URL CTAs use their native client actions and are not assumed to generate bot callbacks.

AI-selected arbitrary image, video, or carousel output is not enabled in this release. Those message types require a real registered media capability and a trusted backend-provided asset; the model cannot fabricate or choose a URL and cause the bot to download it. Existing dedicated plugins such as YouTube retain their own serializer/carousel path.

## Game state

No Tic-Tac-Toe or other game engine is installed in this project snapshot. A direct request to start a recognized game receives a deterministic unavailable response. If a legacy AI history contains an unsupported game request followed by a fabricated board, a short move/repair follow-up is guarded so the assistant does not continue a non-existent game state.

A future game implementation must be a real plugin with server-side state keyed by chat and sender, validated legal moves, turn ownership, win/draw checks, expiry, and atomic updates. Prompt-only game simulation is not an acceptable substitute.

## Configuration migration

Schema v29 updates shipped AI defaults to:

- `maxOutputTokens`: 900
- `historyMessages`: 8
- `maxInputChars`: 5000
- `coalesceMs`: 100

The migration changes only known prior shipped defaults (180/220 tokens, 3/4 history turns, 3500 input characters, 80 ms coalescing). Other owner overrides remain unchanged.

## Validation boundaries

Automated tests cover formatting, splitting, completion inspection, command-intent parsing, game-state guards, memory consent/sanitization, UI plan validation, and schema migration. These tests do not substitute for live WhatsApp rendering, Native Flow tap callbacks, or provider-specific continuation behavior. Do not describe the assistant as ASI; this release is a safer and more capable application architecture, not a change to the fundamental nature of the model.
