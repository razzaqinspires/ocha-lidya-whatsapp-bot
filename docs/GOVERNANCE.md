# ACIE Governance

Every contribution records contributor/project identity, received time, original inventory, checksum, license declaration, attribution, version and execution authorization state. Missing information is marked pending; it is not fabricated. Every update becomes a new version and does not overwrite earlier content.

License metadata is a declaration, not legal verification. ACIE does not determine copyright ownership, resolve license compatibility or grant redistribution rights. An owner must review permission and attribution obligations. License review and attribution confirmation are separate recorded stages.

Provider review is staged: license, attribution, adapter descriptor, sandbox, owner execution authorization, adapter protocol test and provider enable. Provider activation is denied until every policy gate passes. A failed protocol retest clears previous success flags. High/critical static findings block activation.

Command drafts are not active commands. They become virtual plugin entries only after an owner approves `public` or `owner` permission, the provider is active, capability mapping matches, and provider policy passes. Owner-only generated commands are private-chat-only. Reject/revoke changes the registry and plugin visibility, never original source bytes.

Provider enable/disable and command approve/reject/revoke operations are owner-only. Disable is an operational safety control; re-enable requires all gates to pass again. No contribution is automatically activated at intake.

A contributor-supplied secret is preserved in the original artifact as requested but must not be surfaced or forwarded. Embedded credentials should be treated as a critical finding and must block execution until reviewed. ACIE does not copy credential values to telemetry or provider responses.
