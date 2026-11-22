# Ocha Rental Platform — 100-Feature Capability Catalog

Version baseline: v1.10.18

This catalog deliberately separates **implemented in this release** from **roadmap**. A roadmap item is not exposed as a working command and must not be marketed as delivered until code, authorization, persistence, and tests exist.

## Commercial model currently implemented

| Plan | Price | Term | Shared quota / rolling 24h | Groups |
|---|---:|---:|---:|---:|
| Mini | Rp5.000 | 30 days | 120 weighted units | 1 |
| Standard | Rp10.000 | 30 days | 350 weighted units | 1 |
| Pro | Rp20.000 | 30 days | 1.000 weighted units | 1 |

The amounts are the owner's initial price settings, not a claim about market-wide pricing. All ordinary commands remain available while the subscription is active; they consume different quota weights. Current default weights: routine command 1, AI/media 3, web/search/project 5, code execution 12. Billing/status/help controls are exempt. Quota is shared by all participants in the tenant group and resets on a rolling 24-hour schedule anchored to activation.

Subscription term is 30 days. The current grace period is 48 hours. During grace, billing and renewal controls remain available but ordinary bot interactions are blocked. After grace, the tenant is suspended and group interaction is muted. Expiration is evaluated by the internal Node.js scheduler started by `npm start`.

## Implemented capabilities

### Catalog, tenant and order lifecycle
1. Three configurable rental tiers (Mini, Standard, Pro).
2. Owner-editable plan prices.
3. Owner-editable plan quota limits.
4. Thirty-day default subscription term.
5. Group-JID tenant identity.
6. Group owner/admin authorization for order creation.
7. One active pending invoice per group.
8. Invoice reuse when the same plan is selected again.
9. Unique invoice identifiers.
10. Twelve-hour invoice expiration.
11. Immutable plan price snapshot on each invoice.
12. Immutable plan quota and term snapshot on each invoice.
13. Pending-order listing for owner.
14. Invoice detail lookup for owner.
15. Customer invoice cancellation.
16. Owner rejection of payment reports.
17. Owner approval of verified payment.
18. Idempotent repeated approval.
19. Append-only rental audit events for principal order actions.
20. Manual tenant activation by owner.
21. Manual tenant suspension by owner.
22. Owner extension of an existing subscription.
23. Renewal time appended to a still-valid or in-grace subscription.
24. Tenant state reporting (active, grace, suspended).
25. Aggregate tenant and approved-revenue summary.

### Checkout and payment
26. Interactive package selector using `single_select`.
27. Text fallback for package selection.
28. Interactive payment-method selector.
29. Static QRIS image delivery from the project asset.
30. OVO transfer instructions.
31. GoPay transfer instructions.
32. DANA transfer instructions.
33. SeaBank transfer instructions.
34. Copy-to-clipboard button for account details where supported.
35. Quick-reply action to report payment.
36. Customer payment-report state.
37. Private owner notification for reported payment.
38. Explicit manual verification gate before activation.
39. QRIS screenshot is not treated as proof of settlement.
40. Invoice payment deadline and payment-method audit.

### Quota and enforcement
41. Shared quota at group/tenant scope.
42. Per-command workload-weighted quota consumption.
43. Routine command weight.
44. AI/media workload weight.
45. Web/search/project workload weight.
46. Code execution workload weight.
47. Exempt billing and essential status commands.
48. Rolling 24-hour quota window.
49. Persistent quota usage record.
50. Per-command usage breakdown.
51. Remaining quota reporting.
52. Quota reset countdown.
53. Atomic in-process tenant lock for quota writes.
54. Grace-period interaction gate.
55. Automatic mute after grace expires.

### Autonomous operations and serializer
56. Rental lifecycle scheduler starts automatically from `npm start`.
57. Scheduler recovery after process restart.
58. Sixty-second lifecycle reconciliation loop.
59. Pending invoice expiration reconciliation.
60. Active-to-grace transition.
61. Grace-to-suspended transition.
62. Automatic quota rollover persistence.
63. 72-hour expiry reminder.
64. 24-hour expiry reminder.
65. Grace-period start reminder.
66. Reminder deduplication marks.
67. Retry of reminder delivery failures.
68. Per-group operation serialization for payment/order mutations.
69. `quick_reply` native-flow registry entry.
70. `single_select` native-flow registry entry.
71. `cta_url` native-flow registry entry.
72. `cta_copy` native-flow registry entry.
73. `cta_call` native-flow registry entry.
74. Observed native-flow entries for location, reminder, address and catalog payloads.
75. Experimental native-flow entries for Galaxy/Flow, voice-call, call-permission and commerce payloads.
76. Lossless preservation of unknown vendor-specific fields for registered payload types.
77. Validation of required native-flow fields.
78. HTTP/HTTPS validation for CTA URLs.
79. Text fallback when interactive relay fails.
80. Raw `sock.relayMessage()` remains available and is not rewritten by `sendInteractive`.

## Roadmap — not yet implemented

### Billing automation and payment reconciliation
81. Dynamic QRIS generation through an authorized payment gateway.
82. Signed payment webhook receiver.
83. Webhook signature verification and replay protection.
84. Automatic transaction reconciliation against provider settlement records.
85. Refund and reversal workflow.
86. Partial payment and underpayment handling.
87. Overpayment and duplicate-transfer handling.
88. Automated payment receipt PDF.
89. Customer-uploaded evidence inbox with review queue (evidence is not proof of settlement).
90. Automated overdue-payment reminders and invoice resend.

### Subscription and tenant controls
91. Multi-group packages per customer account.
92. Customer account linking across several groups.
93. Tenant-level admins separate from WhatsApp group admins.
94. Plan upgrades and downgrades with proration.
95. Pause/resume subscription with remaining-term retention.
96. Promo codes, coupons and referral attribution.
97. Trial period and one-time trial abuse controls.
98. Tenant self-service dashboard.
99. Customer data export and deletion request workflow.
100. Revenue analytics, cohort retention and churn reporting.

## Payment safety notes

The QRIS asset is a static merchant-presented code. The visible artwork identifies the merchant as RAZZAQ VENTURES and displays NMID `ID102654115459` and category label `A01`. The QR payload itself is not treated as a machine-verified bank settlement record. Customer `.sewa paid <invoice>` only changes the order to `payment_reported`; only an owner checking the actual incoming transaction can run `.rentals approve <invoice>`.

The configured transfer instructions are:

- OVO / GoPay / DANA: `0831-9390-5842`, recipient ARIFI RAZZAQ.
- SeaBank: `901250543509`, recipient ARIFI RAZZAQ.

No PIN, OTP, CVV, or bank login credential is requested or stored. Do not enable automatic activation based on an image or text screenshot. To automate settlement, add a licensed/authorized payment gateway, use its server-side transaction query or signed webhook, and persist its unique provider transaction ID with a unique constraint before marking an order paid.

## Native-flow compatibility policy

The registry is a payload serializer/validation layer, not a guarantee that every WhatsApp client or account supports every experimental interaction. Stable entries are the preferred experience. Experimental entries are passed through only when their required structure validates; a plain-text fallback must remain available. The owner's raw `sock.relayMessage()` example is an independent low-level path and is intentionally not rewritten by the new `sendInteractive` helper.
