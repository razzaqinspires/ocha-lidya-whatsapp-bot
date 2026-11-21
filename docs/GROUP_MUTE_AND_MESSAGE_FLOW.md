# Group mute and message flow (v1.10.15)

All WhatsApp groups default to MUTE (`features.groupsMuted: true`). The bot continues receiving messages and maintaining group metadata/contact indexes, but does not run normal commands or AI responses in muted groups.

The only exception is the owner control channel: a message authenticated as the configured owner may issue `.mute on`, `.mute off`, or `.mute status` inside that same muted group. No other command is allowed through. A non-owner who sends `.mute` is silently ignored, even when the group is active.

`.mute off` in a group activates only that group. `.mute on` in the same group mutes it again. Group-context commands cannot target another Group JID or change global state. The emergency global mute `.mute on all` remains available in private owner chat. Bulk activation with `.mute off all` is intentionally disabled; each group must be activated individually in its own context. A bare `.mute off` in private chat does not guess a target.

The group inventory is stored in `data/group-metadata.jsonl`. Per-group mute overrides and the global default are stored in the configuration journal. On every WhatsApp connection open, the bot reconciles the cached inventory with `groupFetchAllParticipating()`; subsequent refreshes are throttled to five minutes. `groups.upsert`, `groups.update`, and `group-participants.update` keep the inventory current between snapshots. Groups absent from a successful participating-groups snapshot are removed from the inventory and their mute overrides are cleared.

The response gate is applied only to conversational dispatch. It does not disable message ingestion, group metadata events, or verified contact indexing.
