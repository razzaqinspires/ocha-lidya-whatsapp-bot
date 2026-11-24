# Baileys Repository Review & Rental Feature Roadmap

Review date: 2026-11-24
Target runtime: Ocha Lidya using `@whiskeysockets/baileys` `7.0.0-rc14`.

This document records public-source review notes and distinguishes implemented Ocha changes from ideas that still require separate design, testing, and deployment. External source code was not copied into this repository.

## Sources reviewed

### 1. Official Baileys project

Repository: <https://github.com/WhiskeySockets/Baileys>
Documentation: <https://baileys.wiki/docs/intro/>

The current repository README marks Baileys 7.0.0 as a breaking-change line and directs users to the migration guide. It describes Baileys as a WebSocket-based TypeScript library, points to its maintained example, and documents the event-driven socket model, authentication persistence, group metadata, group participant updates, and message operations.

Ocha is currently pinned to `@whiskeysockets/baileys` `7.0.0-rc14`. Do not copy code snippets from v6-era bots or assume that an API shape from another bot's vendored fork is interchangeable with this release candidate. Any Baileys API upgrade must be checked against the Ocha lockfile, the current migration guide, and tests for connection, PN/LID identity resolution, message events, and group metadata.

Relevant public guide sections: connection and pairing, save/restore auth state, event handling, group metadata caching, group participant changes, and WhatsApp ID handling.

### 2. X-Asena

Repository: <https://github.com/Neeraj-x0/X-Asena>
Files reviewed: <https://github.com/Neeraj-x0/X-Asena/blob/main/README.md> and <https://github.com/Neeraj-x0/X-Asena/blob/main/AUTH_STATE_IMPROVEMENTS.md>

The README describes a Node.js 20+ ESM bot, command registry, LID-aware group handling, per-group plugin toggles, audit log, role-based access control, feature flags, policy controls, job queue, metrics, backups, and SQLite/PostgreSQL-backed authentication. Its package currently declares `baileys` `7.0.0-rc13`, not Ocha's exact scoped package declaration.

The auth-state document describes per-key mutexes, bounded retry with exponential backoff, atomic upsert operations, buffer/protobuf serialization, audit timestamps, and failure classification. Those are useful reliability patterns for future persistence work; they are not evidence that the repository's implementation has been independently stress-tested, and Ocha should retain its own adapter/security review before adopting a database-backed Baileys auth store.

Potential relevance to rentals: audit every privileged billing mutation, preserve immutable invoice snapshots, serialize state transitions per tenant, and make retries idempotent.

### 3. BotWA (TypeScript)

Repository: <https://github.com/LT-SYAII/botwa>
Files reviewed: <https://github.com/LT-SYAII/botwa/blob/main/README.md>, <https://github.com/LT-SYAII/botwa/blob/main/index.ts>, and <https://github.com/LT-SYAII/botwa/blob/main/package.json>.

The README describes a modular plugin/command system, group participation tracking, role-based commands, file watching, and message history. The inspected event-handler source processes `messages.upsert`, contacts, group upserts/updates, and participant changes. Its package declares `baileys` `^6.7.20`; treat it as an architectural reference, not a drop-in Baileys 7 code source.

Potential relevance to rentals: react to group participant-change events and reconcile cached group membership/metadata; do not rely indefinitely on a stale participant count when validating a plan's member cap.

### 4. LoliBot-MD

Repository: <https://github.com/elrebelde21/LoliBot-MD>
Files reviewed: <https://github.com/elrebelde21/LoliBot-MD/blob/master/package.json> and <https://github.com/elrebelde21/LoliBot-MD>.

Its package directly declares `@whiskeysockets/baileys` `^7.0.0-rc11` and shows a broad ESM dependency/module ecosystem. This confirms a public bot example using the scoped Baileys package, but the dependency is older than Ocha's `rc14`; features and API usage must not be transplanted without compatibility checks.

## Design conclusions for Ocha rental

Ocha already has a stronger business-specific workflow than a generic bot sample: private checkout context, group-admin revalidation, invoice expiry, manual settlement verification, payment evidence isolation, a rental ledger/audit trail, idempotent approval recovery, tenant quota windows, plan snapshots, grace periods, support tickets, reminders, and verified reviews.

The most useful low-risk gap identified in this review was customer-side invoice visibility. This release implements:

- `.sewa invoice [id]` — show the latest invoice or a specified invoice created by the current WhatsApp requester for the currently selected group.
- `.sewa pesanan` — show up to ten newest invoices created by that requester for the selected group.
- Read-only lookup does not require current group-admin status, but is restricted to the private chat, the saved 12-hour group context, exact requester identity, and exact group JID.
- An order owned by another requester or attached to another group is returned as not found; the command does not disclose its existence or details.

## Recommended next increments — not implemented in this release

1. **Event-driven participant reconciliation:** use Baileys group participant-change notifications to mark group metadata dirty, then refresh via the existing metadata runtime before applying member-cap checks. Keep periodic reconciliation as a fallback in case events are missed.
2. **Renewal reminder preferences:** allow an authorized billing contact to opt into/out of reminder channels and frequency. Keep mandatory expiry/suspension notices clearly separated from marketing messages.
3. **Invoice status event timeline:** expose a customer-safe audit timeline for invoice-created, payment-reported, evidence-received, approved/rejected, expiry, and renewal events. Never expose internal owner notes or raw evidence paths.
4. **Payment-gateway integration:** only after a real gateway is selected; verify webhook signatures, amount, currency, invoice reference, replay protection, and idempotency before activation. A screenshot must never be treated as automatic settlement proof.
5. **Tenant self-service web panel:** read-only plan, usage, expiry, and invoice status behind short-lived signed links or WhatsApp identity verification. Never make a public URL the authority for invoice approval or role changes.
6. **Operational metrics and alerts:** monitor pending invoice age, payment verification turnaround, expired orders, quota exhaustion, renewal rate, and failed notifications. Alert owners without exposing unrelated customer data.

## Security and compatibility rules

- Keep invoice creation, payment reporting, evidence upload, and customer support in private chat. A group message may only redirect the requester to their private session.
- Verify the current sender against the invoice requester and selected group on every customer lookup or mutation. Never trust an invoice ID alone.
- Re-check current group admin rights for invoice creation and payment-changing operations; read-only invoice lookup is intentionally separate.
- Treat WhatsApp message events as at-least-once inputs: use message IDs/idempotency keys for future event-driven billing integrations, and do not create a second invoice from a duplicate command event.
- Cache group metadata with an explicit freshness policy; refresh before high-impact authorization or capacity decisions.
- Respect Baileys' PN/LID mapping behavior. Do not assume every user JID is a phone-number JID; use the project's current normalization/mapping helpers and test both representations.
- Do not implement stealth presence, bulk unsolicited messaging, anti-ban evasion, or account-behavior simulation. These do not improve rental correctness or user safety.

## Review scope and limitations

This was a targeted review of public README, package metadata, and selected source/documentation files, not a full audit of every file in every repository. Repository maintenance status, branch contents, dependency versions, and upstream Baileys behavior may change. Verify the exact commit and license before adapting any implementation. Feature recommendations above are architecture proposals unless explicitly listed under implemented changes.
