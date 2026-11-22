# Native Flow Serializer — v1.10.18

## Compatibility tiers

This registry describes payload validation/serialization support. It does not certify that every WhatsApp client, account type, or future protocol version renders the button.

| Tier | Registered types | Use in rental checkout |
|---|---|---|
| Stable | `quick_reply`, `single_select`, `cta_url`, `cta_copy`, `cta_call` | `single_select`, `quick_reply`, `cta_copy` |
| Observed | `send_location`, `cta_reminder`, `cta_cancel_reminder`, `address_message`, `cta_catalog` | Not required for payment checkout |
| Experimental | `galaxy_message`, `voice_call`, `call_permission_request`, `mpm`, `review_and_pay`, `order_details`, `payment_info` | Not used for static QRIS/manual transfer checkout |

## Serializer contract

- `normalizeNativeFlowButton()` recognizes each registered button name and preserves every supplied JSON property. It does not reconstruct experimental payloads or drop client-specific fields.
- Unknown types throw a clear validation error. They are never silently rewritten to `quick_reply`.
- Required fields are checked before relay. `single_select` validates non-empty sections and rows; each row needs `id` and `title`. `cta_url` accepts only HTTP/HTTPS URLs.
- `sock.sendInteractive()` and `sock.sendNativeFlow()` build the binary `biz`/`interactive` node and support `nativeFlowName`, `nativeFlowVersion`, `messageParamsJson`, `messageVersion`, `additionalNodes`, and a plain-text fallback.
- The owner's low-level raw `sock.relayMessage(chat, content, { additionalNodes })` call is not routed through `sendInteractive` and is not rewritten. The eval fixture can therefore keep its exact source and payload structure.

## Rental UX choice

The rental flow uses `single_select` to choose a plan or payment method, `quick_reply` for “I have paid”, and `cta_copy` to copy account or invoice details. These are the stable/most suitable choices for a short checkout. `review_and_pay`, MPM and `order_details` are deliberately not used for a manual bank-transfer/QRIS-static workflow because they represent commerce/payment flows that may depend on WhatsApp business commerce setup and account capability.

Every interactive menu has a text command fallback. A client that shows an unsupported interactive payload can still use `.sewa plan ...`, `.sewa pay ...`, and `.sewa paid ...`.

## Required production validation

Golden serialization tests check the exact registered parameter objects, but cannot prove client rendering or bank settlement. Before enabling an experimental type in production, capture a known-good payload from the target WhatsApp client and verify it on Android and iOS; Web/Desktop may behave differently. Do not infer a successful payment from receipt-button interaction or a screenshot.
