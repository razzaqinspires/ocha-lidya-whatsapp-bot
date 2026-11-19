# Group mute and message flow monitoring

## Global group mute

`features.groupsMuted` defaults to `true`. While enabled, Ocha Lidya does not dispatch group commands or group AI responses, including commands sent by the owner in a group. This is a response-policy gate, not a WhatsApp group-admin mute and not a metadata shutdown.

The `messages.upsert` pipeline still resolves the sender, indexes verified PN contacts, and ensures cached group metadata before the dispatcher applies the mute gate. The following event handlers also remain active while muted:

- `groups.upsert`
- `groups.update`
- `group-participants.update`
- contacts and PN/LID resolution

The owner controls the global setting from a private chat only:

- `.mute on` — silence all group interaction
- `.mute off` — enable group commands and AI again
- `.mute status` — report the current setting

Private chats remain active in both modes. Metadata synchronization and permanent contact indexing are not affected.

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
