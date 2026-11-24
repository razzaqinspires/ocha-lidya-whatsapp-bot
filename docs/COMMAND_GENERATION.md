# Automatic Command Generation

## Discovery and draft

For each statically discovered capability that maps to a supported platform/action, ACIE creates a complete command draft: identifier, aliases, category, description, syntax, parameters, examples, permission placeholder, cooldown/rate limit, provider mapping, capability, output contract, error behavior and collision report. These are proposed interfaces, not proof that the implementation works.

## Collision detection

Intake scans the existing plugin tree without importing contributed code. It checks canonical names and aliases against existing Ocha commands and previously generated drafts. A collision is resolved by dropping conflicting aliases or using an `acie-` namespaced command name with a bounded suffix. ACIE never overwrites a source plugin. If a unique name cannot be allocated, the command stays `blocked-collision`.

## Registry lifecycle

`generated-commands/index.json` is the canonical lifecycle registry. `contributions/registry/commands.json` is a compatibility mirror. Both are updated with exclusive locks. Drafts remain invisible to the public menu and plugin dispatcher.

Lifecycle states: `draft-pending-validation`, `draft-pending-review`, `blocked-collision`, `active`, `rejected`, and `revoked`. Only active records approved for `public` or `owner` permission can be considered by the runtime plugin factory.

## Existing plugin-loader integration

ACIE does not introduce another dispatcher. `src/core/plugin-loader.js` merges eligible virtual plugin descriptors into the existing registry on startup/hot reload and exposes `refreshGeneratedCommandPlugins()` for approval, enable/disable and revoke operations. Menu, help and command catalog discover those virtual plugins through the existing `listPlugins()` API. Owner permission commands are private-chat-only. All normal dispatcher controls remain in force.

## Provider and command approval sequence

1. Review license and attribution.
2. Review external adapter descriptor.
3. Configure and probe a digest-pinned isolated runtime.
4. Approve sandbox and owner execution authorization.
5. Run `.acie adapter test <provider-id> [capability-id]` or `.acie commands test <command-id>`.
6. Enable the provider.
7. Approve the draft: `.acie commands approve <command-id> public|owner`.
8. Synchronize if needed: `.acie commands sync`.

A successful adapter test records protocol/output-contract evidence in both adapter and provider registry. A failed re-test clears prior success flags. Provider activation additionally checks protocol-test success, sandbox availability, integrity, license, attribution and absence of critical/high findings.

## Response mapping

Generated virtual plugins invoke the ACIE router and render the normalized provider result. HTTPS URL/media links are allowed; local filesystem paths and non-HTTPS media references are not exposed. Credential-like metadata keys and common secret strings are redacted. Current WhatsApp response delivery is text/link only; media upload is not inferred from a URL field.

## No command fabrication

Unsupported capability actions do not create drafts. Heuristic discoveries remain unverified and require review. Command approval does not upgrade capability evidence; the provider must pass adapter protocol testing and the runtime gate independently.
