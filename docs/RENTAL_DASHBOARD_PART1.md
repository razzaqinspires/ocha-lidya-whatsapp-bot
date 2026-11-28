# Rental Dashboard & Website Verification — Part 1

## Scope

Part 1 implemented the account/security foundation and the read-only dashboard API. Part 2 now extends it with seven templates, persistent website publishing, a private editor, media posts/share cards, write-capable dashboard API routes, tenant command policy, queued group-member actions, and native Android dashboard source. See `docs/RENTAL_DASHBOARD_PART2.md`.

## Rental tenant owner panel

The existing `.gadmin` panel remains the WhatsApp-side tenant admin panel. It checks active rental entitlement and current WhatsApp group-admin status before allowing group rules, welcome messages, polls, and announcements. The renter can inspect group member count, plan limit, shared quota, and expiry using `.gadmin info`.

The dashboard API provides two independent key scopes:

- `rental:read`: `GET /v1/rental/overview` returns only the rental group bound to that key: plan, status, member count, member limit, quota, and expiry.
- `profile:read`: `GET /v1/profile` returns the profile belonging to the WhatsApp account that created the key.

Commands (private chat only):

- `.sewaapi` — show the two key types.
- `.sewaapi buat rental` — issue a rental information key for the currently selected group.
- `.sewaapi buat profile` — issue a profile key for the WhatsApp account.
- `.sewaapi list` — show key metadata, never the secret.
- `.sewaapi revoke <id>` — revoke a key immediately.

The raw key is shown only once. Only SHA-256 hashes are stored in the JSONL repository. API keys are prefixed `ocha_live_`, scope-separated, and rate-limited to 60 requests per minute per key. The API requires `x-api-key`; responses disable caching. In Part 2, write endpoints use a separate `rental:write` scope, idempotency receipts, a billing-contact check, and audit records. Quota changes are still not exposed.

## HTTP and TryCloudflare

The local API listens on `127.0.0.1:8788` by default. Optional quick tunnel:

```dotenv
{
  "rentalApi": {
    "host": "127.0.0.1",
    "port": 8788,
    "tunnel": true
  }
}
CLOUDFLARED_BIN=cloudflared
```

`cloudflared` must already be installed. A TryCloudflare URL is temporary and changes when the process restarts. Do not treat it as a permanent production domain. Never expose an admin endpoint or a raw API key in a public page, JavaScript bundle, URL query, or screenshot.

Test endpoints:

```bash
curl -H 'x-api-key: ocha_live_...' http://127.0.0.1:8788/v1/rental/overview
curl -H 'x-api-key: ocha_live_...' http://127.0.0.1:8788/v1/profile
```

## One-time website verification

`.website verify` creates a Rp10.000 verification invoice and sends the Razzaq Ventures QRIS. `.website paid <invoice>` reports payment; `.website bukti <invoice>` forwards an image evidence to the owner. A screenshot never grants access automatically. Owner reviews through `.webverify list`, `.webverify approve <invoice>`, or `.webverify reject <invoice> <reason>`.

Approval grants a blue verification badge and exactly one website slot. The Part 2 builder calls `claimWebsiteSlot()` at first successful publication, not during draft creation. This is separate from rental subscription and premium-user status.

## Existing rental payment-proof workflow (source audit)

The rental checkout already contains:

- `.sewa paid <invoice>` to report that payment was sent.
- `.sewa bukti <invoice>` to upload a JPG/PNG/WEBP image, max 5 MB, in private chat.
- Evidence is stored under `data/rental-evidence/` with restrictive permissions and forwarded to the configured owner.
- `.rentals approve <invoice>` / `.rentals reject <invoice> [reason]` for manual review.
- A screenshot is not treated as proof of settled funds; owner must check the bank/merchant statement.

The group redirect already asks customers to continue in private chat and warns against posting payment evidence in a group.

## Duplicate command/alias governance

`.commandaudit` scans canonical command names and aliases and persists collision reports. It never deletes source files. In this part it stages recommendations only. Autonomous source rewriting is not enabled: two commands may look textually similar but have different behavior, permissions, or external dependencies. Part 2 should add an approval-backed change proposal: read both complete files, compare behavior and call sites, propose a unique command name/alias, run tests and syntax checks, then atomically commit one patch while preserving the original source in the revision archive. WorkloadTracker must classify the proposed edit before applying it.

## Part 2 delivery

Part 2 is delivered in `v1.10.35`. Scope, endpoint contract, security controls, Android source and validation notes are documented in `docs/RENTAL_DASHBOARD_PART2.md`. The Android source project is included; a compiled APK is not claimed because Android SDK/Gradle compilation was not available in the build environment.
