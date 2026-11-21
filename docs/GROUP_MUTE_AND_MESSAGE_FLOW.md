# Group mute and message flow monitoring

## Global and per-group interaction mute

`features.groupsMuted` defaults to `true` and is the global default. Specific group JIDs can override that default through `features.groupMuteOverrides`. A new group joined using `.joingc` is explicitly recorded as muted, and `features.lastJoinedGroupId` remembers that target across restarts.

Owner-only commands are accepted in the owner's private chat:

- `.joingc <https://chat.whatsapp.com/INVITE_CODE>` — validates a direct HTTPS invitation link on `chat.whatsapp.com`, checks invite metadata when supported by the socket, joins the group, updates cached metadata, and leaves interaction muted by default.
- `.mute off` — enables interaction only in the most recently joined group when a last-joined target exists. If no target exists, it preserves the legacy behavior and turns global mute off.
- `.mute on` — mutes the most recently joined group; if there is no last-joined target, it preserves the legacy global behavior.
- `.mute off <GROUP_JID>` / `.mute on <GROUP_JID>` — explicitly enable or mute one group.
- `.mute off all` / `.mute on all` — change the global default and clear per-group overrides.
- `.mute status` — reports the global default and last-joined group state.

In the owner's private chat, `.groupinfo` lists cached groups with each group's `AKTIF` or `MUTE` state and summary counts; opening a group's detail shows whether its state comes from the global default or an explicit override. Non-owners in a group can inspect only that current group, even if they provide another Group JID. The owner list reads the local metadata cache and does not issue repeated network fetches for already cached groups.

The message pipeline still resolves the sender, indexes verified PN contacts, and ensures cached group metadata before the dispatcher applies the mute gate. The following event handlers remain active regardless of interaction mute:

- `groups.upsert`
- `groups.update`
- `group-participants.update`
- contacts and PN/LID resolution

When the bot is removed from a group, its cached group metadata and associated per-group mute override are deleted. Private chats remain active in all modes.

## Message-flow console

The runtime monitor observes outgoing messages created through the Baileys socket wrapper and receipt events. It labels destinations as `PRIVATE` or `GROUP`, uses compact message IDs, and displays:

- `✓ SENT` — Baileys accepted the outbound send and returned a message key
- `✓✓ DELIVERED` — delivery status/receipt received
- `✓✓ READ` — read receipt received
- `✓✓ PLAYED` — played receipt received (typically voice/audio)
- `BOT REPLIED` (magenta accent) — a bot message was sent in reply to the inbound message; this is a separate response marker, not a third WhatsApp checkmark. Before delivery receipts arrive, the underlying tick still shows `✓ SENT`.

For direct chats, status updates are read from `messages.update` (Baileys documented status values: 1 sent, 2 received, 3 read, 4 played). For groups, delivery/read counts are aggregated from `message-receipt.update` per participant. The monitor prints updated console lines as new receipt events arrive.

**Important limitation:** an unofficial linked-device library cannot recolor or add a third tick to the WhatsApp client UI. WhatsApp controls the actual tick display. Ocha's colored `BOT REPLIED` marker exists only in the local application console. Group receipt events can arrive per participant and may not be complete when the bot process is offline.

The monitor stores no message bodies. It keeps bounded in-memory indexes (maximum 5,000 incoming/outgoing records, with TTL pruning) and pending early receipts (maximum 1,500). This avoids unbounded growth and avoids duplicating chat content into another database.
