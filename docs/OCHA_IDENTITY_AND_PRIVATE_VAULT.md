# Ocha Identity Kernel and Private User Vault — maintained for v1.10.33

## Scope: operational identity, not consciousness

Ocha Lidya is one persistent application persona served by the Nexora runtime. The identity kernel defines the bot's declared name, role, organization, creator, capabilities, communication rules, and privacy contract. It is a versioned runtime model, not subjective awareness, sentience, independent will, biological emotion, AGI, or ASI. It cannot act outside the server, registry, and backend policy.

The persona is stable across chats, but each person's relationship profile, memories, conversation archive, and projects are private partitions. A shared identity does not imply shared memory.

## Character contract

- Calm, composed, context-aware, and honest about uncertainty.
- A new contact receives concise, reserved, respectful replies. Ocha does not use romantic names, pretend to know the person, or push for familiarity.
- Familiarity grows gradually through sustained, meaningful interaction over time. Level and trust can personalize tone only.
- A verified owner receives warmer, more attentive, reasonably affectionate language in a private chat only. The owner's group chats remain professional and non-intimate.
- Ocha never fabricates memories, actions, capabilities, or human feelings.
- A profile, XP total, rank, or relationship role never grants a command permission or access to another person's data.

The owner is verified by the WhatsApp identity resolved by the message pipeline against configured owner PN identity. Text claims, profile names, quoted content, and conversational history do not confer owner access.

## Per-user `roo` container

The default location is `data/roo/<sha256-normalized-whatsapp-id>/`. Raw phone numbers/JIDs are not used as directory names.

```text
data/roo/
  .master-key                     # 32-byte key, mode 0600
  <sha256-user-id>/                # directory mode 0700
    profile/snapshot.vault         # encrypted identity/XP/relationship profile
    memory/snapshot.vault          # encrypted explicitly saved facts
    conversations/                 # reserved for conversation-side material
    projects/                      # that user's website/project source
    index/conversation-YYYY-MM.vault
    journal/YYYY-MM.jsonl          # encrypted append-only events
    .control/                      # per-user project manifests and preferences
    .history/                      # that user's project revision archives
    .tmp/                          # that user's temporary export files
```

Private vault events use AES-256-GCM with a per-user key derived through HKDF-SHA256 from the root master key. Each journal row is sequenced and SHA-256 hash-chained. Search indexes are encrypted and rebuildable from authenticated journal data. Files use restrictive permissions (directories 0700, files 0600 where supported). The `projects` directory shares the exact normalized identity hash with the conversation vault.

`OCHA_ROO_ROOT` changes the root directory. `OCHA_ROO_MASTER_KEY` is an optional secret override, not a key obtained from GitHub, WhatsApp, or an AI provider. When it is unset/empty, the application creates a cryptographically random 32-byte key at `<OCHA_ROO_ROOT>/.master-key` (default `data/roo/.master-key`) on the first private-vault operation, with owner-only file permissions. This generated file is the master key; it should be backed up together with the entire `data/roo/` directory and kept out of Git, public archives, and shared chat.

For the normal installation, leave `OCHA_ROO_MASTER_KEY=` empty in `.env`. No manual setup is required. If a deployment deliberately wants to inject the key from a secret manager instead of relying on the local file, generate 32 random bytes as 64 hex characters:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copy that value into the private `.env` as `OCHA_ROO_MASTER_KEY=<64-hex-characters>` before the vault creates any encrypted records. Do not place it in `src/config.js` or the JSONL application config. Do not replace or rotate it after encrypted data exists unless you perform a separately designed, verified re-encryption migration: changing the key makes existing vault records unreadable. Losing the key makes encrypted data unrecoverable; exposing it compromises every vault encrypted under it.

## Complete archive versus model context

For new private DMs, user and assistant turns are appended to that user's encrypted journal. A one-time idempotent migration imports eligible old private `ai.turn` records into the corresponding user's vault, retaining original timestamps and excluding group/broadcast records. The old shared JSONL journal is not rewritten or destructively purged by this migration; it remains a legacy source until an administrator performs a separate retention/backup procedure.

The archive has no application-level cap on the number of conversation events or explicitly saved memory facts. It is monthly-sharded and limited only by available disk, filesystem health, backup capacity, and operational retention policy. No software can guarantee infinite storage.

The model does not receive the entire multi-year archive in every request. The active prompt is bounded by the selected provider's context window and runtime budget. v1.10.25 defaults to 96 recent turns and 96,000 input characters, with relevance-ranked historical retrieval sized dynamically to the configured prompt budget. Ocha uses recent turns and relevance-ranked historical excerpts, with the encrypted journal remaining the complete source of record. This keeps long-term retention separate from short-term reasoning context, reduces cost/latency, and avoids sending unrelated private history to the model.

Memory facts are stored only when the user explicitly asks to remember them. Passwords, tokens, financial credentials, and designated sensitive categories are rejected. `.memori` provides private commands for status, paginated facts, search, recent archive, export, and deletion. Exported transcripts are plaintext files: the user must protect them after download/share.

## Social progression: XP, level, rank, and role

XP is stored as an arbitrary-precision integer string, so progression does not stop at level 100 or JavaScript's safe integer limit. Level requirements follow `50 × L × (L - 1)` cumulative XP. Rank milestones are Iron (1), Bronze (5), Silver (10), Gold (20), Platinum (35), Diamond (50), Mythic (75), Astral (150), Celestial (250), Sovereign (500), Eternal (1000), Paragon (1500), Nova (2500), Cosmic (5000), Apex (10000), Transcendent (25000), Nexus (50000), and Singularity (100000), followed by dynamic Singularity tiers from level 1000000 onward. XP, level, and rank-tier progression use arbitrary precision with no configured ceiling; daily XP also has no cap.

XP is awarded for a valid first contact on an active Jakarta day and for unique, meaningful contributions. Repeated low-signal content does not keep earning XP. A 60-second award cooldown and durable message/content fingerprints reduce duplicate and farming behavior. There is no daily XP cap or level ceiling. Profile history is persisted without a fixed message-ID/fingerprint count cap; the 500-entry in-memory profile cache is only an evictable cache, not the durable record.

Relationship roles are based on interaction count, meaningful interactions, active days, tenure, and trust score: Pengunjung, Kenalan, Teman Ngobrol, Teman Akrab, Sahabat Digital, Mitra Tepercaya. The owner role is determined only by verified owner identity. These values shape tone, not access control.

Profile and memory writes are serialized per user to avoid lost updates when WhatsApp events arrive concurrently.

## Rental features and verified reputation

`.sewa bandingkan` compares published plans; `.sewa estimasi <anggota>` recommends a plan by declared group size; `.sewa fitur` and `.sewa faq` explain features and policy; `.sewa rating`/`.sewa testimoni` display verified review aggregates; `.sewa ulasan <1-5> [komentar]` accepts one review for an approved invoice; `.sewa masukan <pesan>`, `.sewa saran <pesan>`, `.sewa keluhan <pesan>`, and `.sewa konsultasi <pesan>` create owner-routed support tickets from the private checkout context; `.sewa upgrade <paket>` changes package; `.sewa perpanjang` renews the current package. Owner-only `.rentals support`, `.rentals reply <ticket-id> <pesan>`, and `.rentals close <ticket-id>` operate the support queue. These customer-submitted service tickets are service records, not AI memory and not cross-user conversation retrieval.

Reviews are tied to approved rental transactions and deduplicated per invoice. Do not buy, invent, auto-generate, or repeatedly submit ratings. Reputation should reflect verified customer experience.

## Resource and provider boundaries

AI provider context windows, output-token limits, request timeouts, WhatsApp message payload constraints, server disk capacity, and project resource quotas still exist. v1.10.25 expands the default working set to 96 recent turns and 96,000 input characters. Completion continuation is deadline-driven rather than capped by a fixed attempt count, and stops when the shared job deadline or progress guard is reached. It does not bypass upstream provider hard limits or permit unbounded requests that could exhaust a shared VPS. Project Builder file, repository, and archive quotas are resource-abuse controls and remain explicit.

## Calibration from Ocha Lidya conversation export

The current persona contract is based on the owner's written description: reserved with new contacts; warm and affectionate with the verified owner in private chat; professional in public/group contexts. Exact phrase cadence, vocabulary, humor, conflict style, and affectionate patterns must be calibrated from a user-provided export. The export has not yet been provided to this release, so no exact private dialogue traits are asserted here. Future calibration should extract style traits and owner-private interaction rules only; it must not copy private personal facts into a global persona or another user vault.


## Expanded runtime envelope (v1.10.25)

Schema v34 defaults to a 60-second provider timeout, a 180-second shared task deadline, 32,768 requested output tokens, 96 recent prompt turns, and 96,000 input characters. Provider continuation is deadline-driven with a no-progress guard rather than a fixed attempt count. Reply-chain ancestry is not cut off by a fixed depth. The encrypted per-user archive and total fact count have no application-level count ceiling; the active prompt still respects provider context windows, WhatsApp message limits, available memory, CPU, disk, and server deadlines.
