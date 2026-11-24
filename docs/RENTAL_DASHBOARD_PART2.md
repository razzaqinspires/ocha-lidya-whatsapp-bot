# Rental Dashboard & Website Builder — Part 2 (v1.10.35)

## 1. Scope delivered

Part 2 extends the Part 1 security foundation. It adds the seven website templates, persistent tenant/verified-account sites, a private browser editor, text/image/video posts, PNG share-card generation, write-capable rental API routes, tenant command access policy, a queued WhatsApp group-membership worker, and the native Android dashboard source project.

The existing Nexora Code Lab gateway is reused. This avoids starting a second Cloudflare Quick Tunnel for the dashboard and published sites. Public access still depends on Code Lab being enabled and its shared TryCloudflare gateway being available.

## 2. Seven website templates

| ID | Template | Typical use |
|---|---|---|
| `business` | Business Profile | Professional services, local businesses, UMKM |
| `portfolio` | Creative Portfolio | Designers, photographers, developers, artists |
| `agency` | Digital Agency | Studios, website builders, service agencies |
| `storefront` | Product Storefront | Product catalogues and brands |
| `creator` | Creator Link | Creators, influencers and social profiles |
| `restaurant` | Restaurant & Cafe | Restaurants, cafes and food businesses |
| `event` | Event & Campaign | Events, communities and campaigns |

Templates use responsive, server-rendered HTML. Text values are HTML-escaped. The page editor supports title, tagline, description, about, CTA, WhatsApp, email, Instagram, location, primary/secondary colors, and up to six custom sections.

## 3. Website commands

All website management commands are private-chat-only:

```text
.website templates
.website create business razzaq-profile
.website list
.website editor razzaq-profile
.website edit razzaq-profile title Razzaq Ventures
.website section razzaq-profile Layanan | Konsultasi dan pengembangan digital
.website post razzaq-profile Caption posting
.website share razzaq-profile POST-ID
.website publish razzaq-profile
.website status
.website guide
```

For media posts, send the media as an image/video message with the command in its caption:

```text
.website post razzaq-profile Caption untuk foto
.website post razzaq-profile Caption untuk video
```

Accepted media: JPG, PNG or WEBP up to 10 MB each; MP4 up to 20 MB each; 50 MB total stored media per website. Maximum 100 posts. Each site is limited to six custom sections. Media is stored under `data/websites/assets/<site-id>/` with restrictive directory/file permissions.

`.website share <slug> <post-id>` generates a 1:1 PNG card. It uses `sharp`; `sharp` is declared as an optional dependency. Install it on the target host (`npm install`) if PNG card generation is required. Video posts create a caption-first card rather than a video frame.

### Website entitlement

- An active rental group can own one website. Management is limited to the rental billing contact. An inactive rental suspends editing and publishing, but does not delete the stored site.
- A non-renter must complete `.website verify` (Rp10.000 one-time payment), report payment, and receive manual owner approval through `.webverify approve <invoice>`. A screenshot alone does not grant entitlement.
- The verified-account slot is consumed at first successful publication, not at draft creation. One account receives one website slot. A failed draft can be edited before publication.
- Slugs are globally unique. A site's current public URL includes a random 256-bit token. Only the token hash is stored. Publishing again rotates the public token and makes the prior URL invalid; send the new URL to visitors.

### Editor session security

`.website editor <slug>` creates a 24-hour session URL. Its one-time secret is passed in the URL fragment and removed from browser history by the editor page. The editor API requires a Bearer token, an unexpired stored hash, and a same-origin check when the Origin header is present. Do not share editor links. Public pages have no editor controls or write endpoints.

## 4. Shared TryCloudflare gateway

The following routes are served through the existing Code Lab gateway:

- `/w/<slug>/<token>` — published website.
- `/editor/<slug>#<session-token>` — private editor page.
- `/editor-api/<slug>` — private editor API.
- `/api/v1/...` — renter dashboard API.

Use `.sewaapi gateway` in private chat to request the current base URL. The URL is ephemeral and can change after a bot restart or tunnel recovery. The application sets the shared gateway to keep running while public access is requested. It does not turn the public Quick Tunnel hostname into a guaranteed stable production domain.

The local API also continues to listen on loopback (default `127.0.0.1:8787`). Keep `OCHA_RENTAL_API_TUNNEL=0` when using the shared gateway. The dedicated API tunnel is an optional legacy/isolated mode, not required by Part 2.

## 5. Rental API contract

Create a `rental` key with `.sewaapi buat rental`. It has `rental:read` and `rental:write` scopes and is tied to the selected rental group. The API accepts the key in the `x-api-key` header. The raw value is shown once; SHA-256 only is stored. Each key is limited to 60 requests/minute. Mutating routes require an `Idempotency-Key` header with 8–100 safe characters; a repeated key with an identical request replays its recorded response, while a different payload returns HTTP 409.

| Method | Shared gateway route | Purpose |
|---|---|---|
| GET | `/api/v1/rental/overview` | Package, status, member count/limit, quota, expiry |
| PATCH | `/api/v1/rental/member-limit` | Change the tenant's internal allowed member limit |
| POST | `/api/v1/rental/membership/actions` | Queue `remove`, `promote` or `demote` for a group member |
| GET | `/api/v1/rental/membership/actions` | Read recent membership-action results |
| GET | `/api/v1/rental/commands` | Read command allowlist/denylist policy |
| PATCH | `/api/v1/rental/commands` | Update command allowlist/denylist policy |
| GET | `/api/v1/profile` | Read the profile of the WhatsApp account bound to a profile key |

A profile key is created with `.sewaapi buat profile` and has only `profile:read` scope. It does not have write access.

### Security and behavior of mutation endpoints

- Write endpoints require an active tenant and the API key owner must match the tenant's `billingContact`. A valid key belonging to a different group member is not sufficient for write access.
- The member limit is an application entitlement, not a command to alter WhatsApp's own platform-wide group capacity. The limit cannot be raised above the maximum of the purchased rental plan or lowered below current participant count. A plan upgrade is required for a higher ceiling.
- Member changes are queued, not executed inside the HTTP request. The bot worker rechecks active rental status, retrieves fresh group metadata, confirms the bot is an admin and verifies the target. It protects the group creator and the owner's own key account. Results are written to the membership-action journal and audit log.
- The group-membership worker processes a maximum of eight pending actions per scheduled cycle and at most one action per group in that cycle. This reduces bursts of admin mutations.
- Command policy uses `denylist` (commands listed are blocked) or `allowlist` (only listed non-reserved commands are enabled). Core commands such as `menu`, `help`, `sewa`, `gadmin`, `sewaapi`, and `profile` are protected from tenant policy changes.
- All write operations have tenant checks and audit records. The API layer does not accept a caller-supplied group ID to select a different tenant; the group comes from the authenticated key.

Example requests:

```bash
BASE='https://CURRENT-SHARED-GATEWAY.trycloudflare.com'
KEY='ocha_live_REPLACE_WITH_YOUR_KEY'

curl -H "x-api-key: $KEY" "$BASE/api/v1/rental/overview"

curl -X PATCH "$BASE/api/v1/rental/member-limit" \
  -H "x-api-key: $KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: member-limit-20261124-01' \
  -d '{"member_limit":150}'

curl -X POST "$BASE/api/v1/rental/membership/actions" \
  -H "x-api-key: $KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: member-action-20261124-01' \
  -d '{"action":"promote","target_jid":"62812xxxxxxx@s.whatsapp.net"}'

curl -X PATCH "$BASE/api/v1/rental/commands" \
  -H "x-api-key: $KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: commands-policy-20261124-01' \
  -d '{"mode":"denylist","commands":["download","sticker"]}'
```

Do not embed API keys in a browser website bundle, public mobile app repository, WhatsApp group, screenshot, analytics event, or query string.

## 6. Native Android dashboard source

`apps/android-dashboard/` contains a native Java Android app source project. It supports secure-HTTPS API connection, rental overview, internal member-limit changes, queued membership actions, command allowlist/denylist updates, recent action history, and an in-app setup guide. The key is held in the active screen field and is not written into app preferences or a local database.

Build on a host with Android Studio or Gradle and Android SDK 35:

```bash
cd apps/android-dashboard
gradle assembleDebug
```

Expected output after a successful build:

```text
app/build/outputs/apk/debug/app-debug.apk
```

This repository update contains Android source and Gradle project files, not a prebuilt APK. The current authoring environment did not have a confirmed Android SDK/Gradle toolchain, so APK compilation and device installation have not been verified. The app uses the shared ephemeral TryCloudflare URL; request the current URL from `.sewaapi gateway` after a bot/tunnel restart.

## 7. Data persistence and backup

Website records and audit entries are persisted in the existing JSONL database (`website.site`, `website.audit`, `website.editor-session`). Media bytes are separate files beneath `data/websites/assets/`; include this directory in host backups together with the existing database journal. Do not publish or commit `data/`, API key secrets, evidence images, or editor session records.

## 8. Validation

Part 2 includes tests for:

- Seven template render variants, responsive markup and HTML escaping.
- Verified-account one-time slot claim at publish time.
- Random public token validation, public page response and MP4 media route.
- Editor session authentication and rejection of a cross-origin request.
- Tenant command allowlist/denylist and protected system commands.
- Dashboard API scope, tenant-owner check, idempotent write replay/conflict, and read paths.
- Existing website project and shared TryCloudflare preview gateway regression coverage.

A test pass does not replace validation against the live WhatsApp account, production rental group, live Cloudflare tunnel, actual payment settlement, or Android device. Those require the target VPS/account/device.
